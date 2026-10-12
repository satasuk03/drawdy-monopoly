// Sync layer tests: envelope parsing, authority election, intent ordering and
// application, and the GameSession runtime (with fake IO and a fake clock).
// Uses the real engine and the classic board.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getBoard } from "../src/boards/index";
import { applyAction, createGame } from "../src/engine/index";
import type { Action, ApplyResult, GameState } from "../src/engine/types";
import {
    applyIntents,
    authorityCandidates,
    electAuthority,
    FAILOVER_MS,
    pendingIntents,
    type ApplyActionFn,
} from "../src/sync/authority";
import {
    frameElementId,
    intentElementId,
    isRenderElementId,
    META_KEY,
    newEnvelope,
    parseEnvelope,
    parseIntentRecord,
    shortHash,
    type GameEnvelope,
    type IntentRecord,
} from "../src/sync/envelope";
import { GameSession, UNRESPONSIVE_MS, type Clock, type SessionIO } from "../src/sync/session";

const board = getBoard("classic")!;
const GAME = "bt-test";

function lobby(creator = "alice"): GameState {
    return createGame({ gameId: GAME, board, creatorUserId: creator, seed: 42 });
}

function join(userId: string, i: number): Action {
    return { type: "join", userId, name: `P${i}`, color: ["#ff0000", "#00ff00", "#0000ff", "#ffaa00"][i]!, token: board.tokens[i]!.id };
}

/** A started game with the given users seated in order. */
function started(users: string[], creator = users[0]!): GameState {
    let s = lobby(creator);
    users.forEach((u, i) => {
        const r = applyAction(board, s, join(u, i), { userId: u, isCreator: u === creator });
        assert.ok(r.ok, !r.ok ? r.error : "");
        s = r.state;
    });
    const r = applyAction(board, s, { type: "start" }, { userId: creator, isCreator: true });
    assert.ok(r.ok, !r.ok ? r.error : "");
    return r.state;
}

function env(state: GameState, authority: string, version = 1): GameEnvelope {
    return { ...newEnvelope(state, authority, { frame: frameElementId(GAME), origin: { x: 0, y: 0 } }), version };
}

function rec(userId: string, intents: { seq: number; action: Action; t?: number }[]): IntentRecord {
    return { kind: "intent", v: 1, gameId: GAME, userId, intents };
}

const roll = (seat: number): Action => ({ type: "roll", seat });

// ---------------------------------------------------------------------------
// envelope

test("ids are deterministic and namespaced", () => {
    assert.equal(shortHash("alice"), shortHash("alice"));
    assert.notEqual(shortHash("alice"), shortHash("bob"));
    assert.equal(intentElementId(GAME, "alice"), intentElementId(GAME, "alice"));
    assert.ok(isRenderElementId(GAME, `${GAME}:chip:1`));
    assert.ok(!isRenderElementId(GAME, frameElementId(GAME)));
    assert.ok(!isRenderElementId(GAME, intentElementId(GAME, "alice")));
    assert.ok(!isRenderElementId(GAME, "other:chip:1"));
});

test("parseEnvelope round-trips a valid envelope, from meta or meta.tycoon", () => {
    const e = env(lobby(), "alice");
    const json = JSON.parse(JSON.stringify(e));
    assert.deepEqual(parseEnvelope(json), e);
    assert.deepEqual(parseEnvelope({ [META_KEY]: json, other: 1 }), e);
});

test("parseEnvelope rejects malformed meta", () => {
    const good = JSON.parse(JSON.stringify(env(started(["alice", "bob"]), "alice")));
    const bad: unknown[] = [
        null,
        undefined,
        "game",
        42,
        [],
        {},
        { ...good, kind: "intent" },
        { ...good, v: 2 },
        { ...good, version: -1 },
        { ...good, version: 1.5 },
        { ...good, version: "3" },
        { ...good, authorityUserId: "" },
        { ...good, state: null },
        { ...good, state: { ...good.state, schema: 2 } },
        { ...good, state: { ...good.state, phase: { kind: "dancing" } } },
        { ...good, state: { ...good.state, players: "x" } },
        { ...good, state: { ...good.state, players: [{ ...good.state.players[0], position: 40 }] } },
        { ...good, state: { ...good.state, dice: [1] } },
        { ...good, state: { ...good.state, ownership: { x: { owner: 0, houses: 0, mortgaged: false } } } },
        { ...good, ids: { frame: 1, origin: { x: 0, y: 0 } } },
        { ...good, ids: { frame: "f", origin: { x: "0", y: 0 } } },
    ];
    for (const b of bad) assert.equal(parseEnvelope(b), null, JSON.stringify(b)?.slice(0, 80));
});

test("parseEnvelope drops bad acks/errors entries but keeps the envelope", () => {
    const good = JSON.parse(JSON.stringify(env(lobby(), "alice")));
    const parsed = parseEnvelope({
        ...good,
        acks: { a: 3, b: -1, c: "4", d: 1.5 },
        errors: { a: { seq: 2, message: "no" }, b: { seq: "x", message: "no" }, c: "boom" },
    });
    assert.ok(parsed);
    assert.deepEqual(parsed.acks, { a: 3 });
    assert.deepEqual(parsed.errors, { a: { seq: 2, message: "no" } });
});

test("parseIntentRecord filters, dedupes and sorts intents", () => {
    const r = parseIntentRecord({
        [META_KEY]: {
            kind: "intent",
            gameId: GAME,
            userId: "bob",
            intents: [
                { seq: 3, action: roll(1) },
                { seq: 1, action: roll(1), t: 5 },
                { seq: 1, action: { type: "end-turn", seat: 1 } }, // duplicate seq
                { seq: 0, action: roll(1) },
                { seq: 2, action: "roll" },
                { seq: 4, action: { type: "" } },
                null,
                { seq: 5 },
            ],
        },
    });
    assert.ok(r);
    assert.deepEqual(
        r.intents.map((i) => i.seq),
        [1, 3]
    );
    assert.equal(r.intents[0]!.t, 5);
    assert.equal(parseIntentRecord({ [META_KEY]: { kind: "intent", gameId: GAME } }), null);
    assert.equal(parseIntentRecord({ [META_KEY]: { kind: "game" } }), null);
    assert.deepEqual(parseIntentRecord({ [META_KEY]: { kind: "intent", gameId: GAME, userId: "x", intents: 7 } })?.intents, []);
});

// ---------------------------------------------------------------------------
// election

test("authority keeps the job while present or briefly absent", () => {
    const e = env(started(["alice", "bob", "carol"]), "alice");
    assert.equal(electAuthority(e, ["alice", "bob"], null, 1000), "alice");
    assert.equal(electAuthority(e, ["bob", "carol"], null, 1000), "alice"); // absence not yet noticed
    assert.equal(electAuthority(e, ["bob", "carol"], 1000, 1000 + FAILOVER_MS - 1), "alice");
});

test("failover goes to the first present non-bankrupt seat, then creator", () => {
    const s = started(["alice", "bob", "carol"]);
    const e = env(s, "alice");
    const t = 1000 + FAILOVER_MS;
    assert.equal(electAuthority(e, ["carol", "bob"], 1000, t), "bob");
    assert.equal(electAuthority(e, ["carol"], 1000, t), "carol");

    const bankrupt = { ...s, players: s.players.map((p) => (p.userId === "bob" ? { ...p, bankrupt: true } : p)) };
    assert.equal(electAuthority(env(bankrupt, "alice"), ["bob", "carol"], 1000, t), "carol");
    // Bankrupt seats are a last resort.
    assert.equal(electAuthority(env(bankrupt, "alice"), ["bob", "dave"], 1000, t), "bob");

    // Creator (not seated) comes after seated players.
    const s2 = started(["bob", "carol"], "bob");
    const withCreator = { ...s2, creatorUserId: "zed" };
    assert.deepEqual(authorityCandidates(withCreator), ["bob", "carol", "zed"]);
    assert.equal(electAuthority(env(withCreator, "bob"), ["zed"], 1000, t), "zed");
});

test("no present candidate → no change (spectators never take over)", () => {
    const e = env(started(["alice", "bob"]), "alice");
    assert.equal(electAuthority(e, ["mallory"], 0, 10 * FAILOVER_MS), "alice");
    assert.equal(electAuthority(e, [], 0, 10 * FAILOVER_MS), "alice");
});

// ---------------------------------------------------------------------------
// intents

test("pendingIntents: only unacked, per-user seq order, cross-user by time", () => {
    const e = { ...env(lobby(), "alice"), acks: { bob: 1 } };
    const list = pendingIntents(e, [
        rec("bob", [
            { seq: 1, action: roll(1), t: 1 },
            { seq: 2, action: roll(1), t: 50 },
            { seq: 3, action: roll(1), t: 10 }, // clock went backwards: still after seq 2
        ]),
        rec("carol", [
            { seq: 1, action: roll(2), t: 20 },
            { seq: 2, action: roll(2), t: 60 },
        ]),
        { ...rec("dave", [{ seq: 1, action: roll(3), t: 0 }]), gameId: "other-game" },
    ]);
    assert.deepEqual(
        list.map((p) => `${p.userId}#${p.intent.seq}`),
        ["carol#1", "bob#2", "bob#3", "carol#2"]
    );
});

test("applyIntents applies in order, acks everything, records rejections, bumps version once", () => {
    const e0 = env(lobby("alice"), "alice", 7);
    const intents = pendingIntents(e0, [
        rec("bob", [{ seq: 1, action: join("bob", 1), t: 1 }]),
        rec("carol", [
            { seq: 1, action: join("carol", 1), t: 2 }, // same token as bob → rejected
            { seq: 2, action: join("carol", 2), t: 3 },
        ]),
    ]);
    const res = applyIntents(board, e0, intents, applyAction);
    assert.equal(res.envelope.version, 8);
    assert.equal(res.applied, 2);
    assert.equal(res.rejected.length, 1);
    assert.deepEqual(res.envelope.acks, { bob: 1, carol: 2 });
    assert.equal(res.envelope.errors.carol?.seq, 1);
    assert.deepEqual(
        res.envelope.state.players.map((p) => p.userId),
        ["bob", "carol"]
    );
    // Input untouched.
    assert.equal(e0.state.players.length, 0);
    assert.deepEqual(e0.acks, {});

    // Nothing pending → same object, no version bump.
    const again = applyIntents(board, res.envelope, pendingIntents(res.envelope, []), applyAction);
    assert.equal(again.envelope, res.envelope);
});

test("applyIntents forces join.userId to the writer", () => {
    const e0 = env(lobby("alice"), "alice");
    const spoof: Action = { ...join("alice", 0) }; // bob tries to seat alice
    const res = applyIntents(board, e0, [{ userId: "bob", intent: { seq: 1, action: spoof } }], applyAction);
    assert.equal(res.envelope.state.players[0]?.userId, "bob");
});

test("applyIntents treats an engine exception as a rejection", () => {
    const boom: ApplyActionFn = () => {
        throw new Error("kaboom");
    };
    const res = applyIntents(board, env(lobby(), "alice"), [{ userId: "bob", intent: { seq: 1, action: roll(0) } }], boom);
    assert.equal(res.envelope.acks.bob, 1);
    assert.match(res.envelope.errors.bob!.message, /kaboom/);
    assert.equal(res.envelope.version, 2);
});

// ---------------------------------------------------------------------------
// session harness

class FakeClock implements Clock {
    t = 1_000_000;
    private timers: { at: number; fn: () => void; id: number }[] = [];
    private ids = 0;
    now(): number {
        return this.t;
    }
    setTimeout(fn: () => void, ms: number): unknown {
        const id = ++this.ids;
        this.timers.push({ at: this.t + ms, fn, id });
        return id;
    }
    clearTimeout(h: unknown): void {
        this.timers = this.timers.filter((x) => x.id !== h);
    }
    advance(ms: number): void {
        const end = this.t + ms;
        for (;;) {
            this.timers.sort((a, b) => a.at - b.at);
            const next = this.timers[0];
            if (!next || next.at > end) break;
            this.timers.shift();
            this.t = next.at;
            next.fn();
        }
        this.t = end;
    }
}

class FakeIO implements SessionIO {
    envWrites: GameEnvelope[] = [];
    intentWrites: IntentRecord[] = [];
    /** When set, writes block until release() is called. */
    gate: Promise<void> | null = null;
    private open: (() => void) | null = null;
    concurrent = 0;
    maxConcurrent = 0;
    hold(): void {
        this.gate = new Promise((r) => (this.open = r));
    }
    release(): void {
        this.open?.();
        this.gate = null;
    }
    async writeEnvelope(e: GameEnvelope): Promise<void> {
        this.concurrent++;
        this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
        this.envWrites.push(JSON.parse(JSON.stringify(e)));
        if (this.gate) await this.gate;
        this.concurrent--;
    }
    async writeIntents(r: IntentRecord): Promise<void> {
        this.intentWrites.push(JSON.parse(JSON.stringify(r)));
        if (this.gate) await this.gate;
    }
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function session(me: string, opts: { applyAction?: ApplyActionFn } = {}) {
    const io = new FakeIO();
    const clock = new FakeClock();
    const rejected: string[] = [];
    const authority: boolean[] = [];
    const s = new GameSession({
        gameId: GAME,
        myUserId: me,
        board,
        applyAction: opts.applyAction ?? applyAction,
        io,
        clock,
        events: {
            onIntentRejected: (m) => rejected.push(m),
            onAuthorityChange: (isMe) => authority.push(isMe),
        },
    });
    return { s, io, clock, rejected, authority };
}

// ---------------------------------------------------------------------------
// session

test("authority applies incoming intents and writes the envelope", async () => {
    const { s, io } = session("alice");
    s.setPresence(["alice", "bob"]);
    s.ingestEnvelope(env(lobby("alice"), "alice"));
    assert.ok(s.isAuthority());
    s.ingestIntentRecord(rec("bob", [{ seq: 1, action: join("bob", 1) }]));
    await flush();
    assert.equal(io.envWrites.length, 1);
    assert.equal(io.envWrites[0]!.version, 2);
    assert.equal(io.envWrites[0]!.acks.bob, 1);
    assert.equal(s.envelope!.state.players[0]!.userId, "bob");
    // Re-delivery of the same record is a no-op.
    s.ingestIntentRecord(rec("bob", [{ seq: 1, action: join("bob", 1) }]));
    await flush();
    assert.equal(io.envWrites.length, 1);
});

test("envelope writes are serialized and coalesced to the latest", async () => {
    const { s, io } = session("alice");
    s.setPresence(["alice"]);
    s.ingestEnvelope(env(lobby("alice"), "alice"));
    io.hold();
    assert.ok(s.submit(join("alice", 0)).ok);
    await flush();
    assert.ok(s.submit(join("alice", 1)).ok);
    assert.ok(s.submit(join("alice", 2)).ok);
    await flush();
    assert.equal(io.envWrites.length, 1, "second write waits for the first");
    io.release();
    await flush();
    await flush();
    assert.equal(io.maxConcurrent, 1);
    assert.deepEqual(
        io.envWrites.map((e) => e.version),
        [2, 4]
    );
    assert.equal(io.envWrites[1]!.state.players.length, 3);
});

test("authority's own invalid action returns the engine error and writes nothing", async () => {
    const { s, io } = session("alice");
    s.setPresence(["alice"]);
    s.ingestEnvelope(env(lobby("alice"), "alice"));
    const r = s.submit(roll(0));
    assert.equal(r.ok, false);
    await flush();
    assert.equal(io.envWrites.length, 0);
    assert.equal(s.envelope!.version, 1);
});

test("non-authority writes intents with increasing seq; pending until acked; rejection shown once", async () => {
    const { s, io, rejected } = session("bob");
    s.setPresence(["alice", "bob"]);
    const e1 = env(lobby("alice"), "alice");
    s.ingestEnvelope(e1);
    assert.ok(!s.isAuthority());
    assert.equal(s.pending(), false);

    assert.deepEqual(s.submit(join("bob", 1)), { ok: true, via: "intent" });
    assert.ok(s.submit(roll(0)).ok);
    await flush();
    await flush();
    assert.equal(io.envWrites.length, 0, "non-authority never writes the envelope");
    const last = io.intentWrites.at(-1)!;
    assert.deepEqual(
        last.intents.map((i) => i.seq),
        [1, 2]
    );
    assert.equal(last.userId, "bob");
    assert.ok(s.pending());

    // The authority applies seq 1 and rejects seq 2.
    const res = applyIntents(board, e1, pendingIntents(e1, [last]), applyAction);
    s.ingestEnvelope(res.envelope);
    assert.equal(s.pending(), false);
    assert.equal(rejected.length, 1);
    // Re-delivered envelope does not repeat the toast.
    s.ingestEnvelope(res.envelope);
    s.ingestEnvelope({ ...res.envelope, version: res.envelope.version + 1 });
    assert.equal(rejected.length, 1);

    // Next seq continues past the ack.
    s.submit(roll(0));
    await flush();
    assert.equal(io.intentWrites.at(-1)!.intents.at(-1)!.seq, 3);
});

test("intent record keeps only the last 20", async () => {
    const { s, io } = session("bob");
    s.setPresence(["alice", "bob"]);
    s.ingestEnvelope(env(lobby("alice"), "alice"));
    for (let i = 0; i < 25; i++) s.submit(roll(0));
    await flush();
    await flush();
    const r = io.intentWrites.at(-1)!;
    assert.equal(r.intents.length, 20);
    assert.equal(r.intents[0]!.seq, 6);
    assert.equal(r.intents[19]!.seq, 25);
});

test("after reload, my seq continues from the record found in the scene", () => {
    const { s } = session("bob");
    s.setPresence(["alice", "bob"]);
    s.ingestEnvelope({ ...env(lobby("alice"), "alice"), acks: { bob: 4 } });
    s.ingestIntentRecord(rec("bob", [{ seq: 4, action: roll(0) }, { seq: 5, action: roll(0) }]));
    assert.ok(s.pending());
    s.submit(roll(0));
    assert.equal(s.myIntentRecord().intents.at(-1)!.seq, 6);
});

test("versions only move forward for non-authorities", () => {
    const { s } = session("bob");
    s.setPresence(["alice", "bob"]);
    const base = env(started(["alice", "bob"]), "alice", 5);
    s.ingestEnvelope(base);
    s.ingestEnvelope({ ...base, version: 4, state: lobby("alice") });
    assert.equal(s.envelope!.version, 5);
    assert.equal(s.envelope!.state.phase.kind, "pre-roll");
    s.ingestEnvelope({ ...base, version: 9 });
    assert.equal(s.envelope!.version, 9);
    // Malformed meta is ignored.
    s.ingestFrameMeta({ [META_KEY]: { kind: "game", version: 100 } });
    s.ingestFrameMeta("garbage");
    assert.equal(s.envelope!.version, 9);
});

test("authority ignores its own echoes but re-asserts over an older version (undo)", async () => {
    const { s, io } = session("alice");
    s.setPresence(["alice", "bob"]);
    s.ingestEnvelope(env(lobby("alice"), "alice", 1));
    s.submit(join("alice", 0)); // v2
    await flush();
    assert.equal(io.envWrites.length, 1);
    // Echo of v2 arrives: nothing to do.
    s.ingestEnvelope(io.envWrites[0]!);
    await flush();
    assert.equal(io.envWrites.length, 1);
    // Someone undoes the frame meta back to v1: re-write v2.
    s.ingestEnvelope(env(lobby("alice"), "alice", 1));
    await flush();
    assert.equal(io.envWrites.length, 2);
    assert.equal(io.envWrites[1]!.version, 2);
    assert.equal(io.envWrites[1]!.state.players.length, 1);
});

test("authority adopts a higher version written by someone else and steps down", async () => {
    const { s, authority } = session("alice");
    s.setPresence(["alice", "bob"]);
    s.ingestEnvelope(env(lobby("alice"), "alice", 3));
    s.ingestEnvelope(env(lobby("alice"), "bob", 4));
    assert.equal(s.isAuthority(), false);
    assert.deepEqual(authority, [true, false]); // gained on first load, then lost
});

test("equal-version claim conflict: lower userId wins everywhere", async () => {
    const st = started(["alice", "bob", "carol"]);
    // carol is authority at v5, sees bob's claim at v5: bob < carol → carol adopts.
    const c = session("carol");
    c.s.setPresence(["alice", "bob", "carol"]);
    c.s.ingestEnvelope(env(st, "carol", 5));
    c.s.ingestEnvelope(env(st, "bob", 5));
    assert.equal(c.s.envelope!.authorityUserId, "bob");

    // bob is authority at v5, sees carol's claim at v5: bob wins → re-asserts at v6.
    const b = session("bob");
    b.s.setPresence(["alice", "bob", "carol"]);
    b.s.ingestEnvelope(env(st, "bob", 5));
    b.s.ingestEnvelope(env(st, "carol", 5));
    await flush();
    assert.equal(b.s.envelope!.authorityUserId, "bob");
    assert.equal(b.io.envWrites.at(-1)!.version, 6);
});

test("failover: the first present seat claims after 4 s, others wait", async () => {
    const st = started(["alice", "bob", "carol"]);
    const b = session("bob");
    const c = session("carol");
    for (const x of [b, c]) {
        x.s.ingestEnvelope(env(st, "alice", 10));
        x.s.setPresence(["alice", "bob", "carol"]);
    }
    // alice leaves
    for (const x of [b, c]) x.s.setPresence(["bob", "carol"]);
    b.clock.advance(FAILOVER_MS - 100);
    c.clock.advance(FAILOVER_MS - 100);
    assert.equal(b.s.isAuthority(), false);
    b.clock.advance(200);
    c.clock.advance(200);
    await flush();
    assert.equal(b.s.isAuthority(), true);
    assert.equal(c.s.isAuthority(), false);
    const claim = b.io.envWrites.at(-1)!;
    assert.equal(claim.authorityUserId, "bob");
    assert.equal(claim.version, 11);
    assert.deepEqual(b.authority, [true]);
    // carol learns about it from the scene.
    c.s.ingestEnvelope(claim);
    assert.equal(c.s.envelope!.authorityUserId, "bob");
});

test("failover: a returning authority within the grace period keeps the job", () => {
    const b = session("bob");
    b.s.ingestEnvelope(env(started(["alice", "bob"]), "alice"));
    b.s.setPresence(["bob"]);
    b.clock.advance(FAILOVER_MS - 500);
    b.s.setPresence(["alice", "bob"]);
    b.clock.advance(FAILOVER_MS * 2);
    assert.equal(b.s.isAuthority(), false);
});

test("new authority applies intents left pending by the old one", async () => {
    const st = started(["alice", "bob"]);
    const b = session("bob");
    b.s.ingestEnvelope(env(st, "alice", 3));
    b.s.setPresence(["alice", "bob"]);
    // bob rolled (it's alice's turn → it'll be rejected, but it must be processed)
    b.s.submit(roll(1));
    b.s.setPresence(["bob"]);
    b.clock.advance(FAILOVER_MS + 100);
    await flush();
    assert.ok(b.s.isAuthority());
    assert.equal(b.s.envelope!.acks.bob, 1);
    assert.ok(b.s.envelope!.version >= 5);
    assert.equal(b.s.pending(), false);
});

test("unresponsive (present but silent) authority is replaced after a while", async () => {
    const st = started(["alice", "bob"]);
    const b = session("bob");
    b.s.ingestEnvelope(env(st, "alice", 3));
    b.s.setPresence(["alice", "bob"]);
    b.s.submit(roll(1));
    b.clock.advance(UNRESPONSIVE_MS - 100);
    assert.equal(b.s.isAuthority(), false);
    b.clock.advance(200);
    await flush();
    assert.equal(b.s.isAuthority(), true);
});

test("solo mode (no collaboration): I'm always the authority", async () => {
    const x = session("local");
    x.s.ingestEnvelope(env(lobby("someone-else"), "someone-else", 2));
    assert.equal(x.s.isAuthority(), false, "presence unknown: no claim yet");
    x.s.setPresence(null);
    await flush();
    assert.equal(x.s.isAuthority(), true);
    assert.equal(x.io.envWrites.at(-1)!.version, 3);
    // Hot-seat: two joins from the same user apply directly.
    assert.deepEqual(x.s.submit(join("local", 0)), { ok: true, via: "direct" });
    assert.ok(x.s.submit(join("local", 1)).ok);
    assert.equal(x.s.envelope!.state.players.length, 2);
});

test("records for other games are ignored", async () => {
    const { s, io } = session("alice");
    s.setPresence(["alice"]);
    s.ingestEnvelope(env(lobby("alice"), "alice"));
    s.ingestIntentRecord({ ...rec("bob", [{ seq: 1, action: join("bob", 1) }]), gameId: "other" });
    s.ingestEnvelope({ ...env(lobby("alice"), "alice", 50), state: { ...lobby("alice"), gameId: "other" } });
    await flush();
    assert.equal(io.envWrites.length, 0);
    assert.equal(s.envelope!.version, 1);
});

test("stub engine: applyIntents works with any engine function", () => {
    const calls: string[] = [];
    const stub: ApplyActionFn = (_b, state, action, actor): ApplyResult => {
        calls.push(`${actor.userId}:${action.type}`);
        return action.type === "end-game" ? { ok: false, error: "nope" } : { ok: true, state: { ...state, round: state.round + 1 } };
    };
    const e0 = env(lobby(), "alice");
    const res = applyIntents(
        board,
        e0,
        [
            { userId: "alice", intent: { seq: 1, action: roll(0) } },
            { userId: "alice", intent: { seq: 1, action: roll(0) } }, // duplicate seq skipped
            { userId: "bob", intent: { seq: 1, action: { type: "end-game" } } },
        ],
        stub
    );
    assert.deepEqual(calls, ["alice:roll", "bob:end-game"]);
    assert.equal(res.envelope.state.round, 1);
    assert.equal(res.envelope.errors.bob?.message, "nope");
});

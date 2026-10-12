// Per-game sync runtime. One GameSession per game frame on the board.
//
// Invariants (every client runs the same code):
//
//  1. Only the authority writes the envelope (frame meta). Every envelope it
//     writes has a version strictly greater than the one it was derived from.
//  2. Each user writes only their own intent record. Seqs in a record only grow.
//  3. Higher envelope version always wins. Equal versions with different
//     authorities (a failover race) are settled by the lower userId; the
//     loser adopts, the winner re-asserts at version + 1 if it has to.
//  4. If the authority sees an *older* version on the frame that is not an
//     echo of its own in-flight write (someone hit undo, or a stale client
//     wrote), it re-writes its in-memory copy: the authority's memory is the
//     source of truth while it is alive.
//  5. Envelope writes are serialized and coalesced: at most one write in
//     flight, and the next write always carries the latest envelope. Same for
//     my intent record.
//
// Everything Drawdy-specific (how meta is written, timers) is injected, so
// this file runs under node:test with fakes.

import type { BoardDef } from "../boards/types";
import type { Action } from "../engine/types";
import {
    applyIntents,
    applyLocal,
    actorFor,
    electAuthority,
    FAILOVER_MS,
    pendingIntents,
    type ApplyActionFn,
} from "./authority";
import {
    lastSeq,
    MAX_INTENTS,
    newIntentRecord,
    parseEnvelope,
    parseIntentRecord,
    type GameEnvelope,
    type IntentRecord,
} from "./envelope";

/**
 * If the authority is present but leaves intents unacked this long (its
 * driver isn't running, tab frozen…), everyone treats it as absent.
 */
export const UNRESPONSIVE_MS = 12000;

const WRITE_RETRY_MS = 1000;
const MAX_WRITE_FAILURES = 5;

export type Clock = {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
};

export const realClock: Clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface SessionIO {
    /** Replace `meta.tycoon` on the game frame with this envelope. */
    writeEnvelope(envelope: GameEnvelope): Promise<void>;
    /**
     * Write my intent record to my intent element, creating the element if
     * needed. `knownToExist` is a hint: false → try to create first.
     */
    writeIntents(record: IntentRecord, knownToExist: boolean): Promise<void>;
}

export type SessionEvents = {
    /** The envelope changed. `local` = produced here (I'm authority), `remote` = adopted from the scene. */
    onEnvelope?(prev: GameEnvelope | null, next: GameEnvelope, origin: "local" | "remote"): void;
    /** I became / stopped being the authority. */
    onAuthorityChange?(isMe: boolean): void;
    /** The frame showed an older state than mine while I'm authority (e.g. undo): the scene may need a full resync. */
    onReassert?(): void;
    /** One of my intents was rejected by the authority. */
    onIntentRejected?(message: string): void;
    /** Anything view-relevant changed (pending flag, envelope, authority). */
    onChange?(): void;
};

export type SessionOptions = {
    gameId: string;
    myUserId: string;
    board: BoardDef;
    applyAction: ApplyActionFn;
    io: SessionIO;
    clock?: Clock;
    events?: SessionEvents;
};

type Presence = { mode: "unknown" } | { mode: "solo" } | { mode: "shared"; users: ReadonlySet<string> };

export type SubmitResult = { ok: true; via: "direct" | "intent" } | { ok: false; error: string };

export class GameSession {
    readonly gameId: string;
    readonly myUserId: string;
    readonly board: BoardDef;

    private readonly applyAction: ApplyActionFn;
    private readonly io: SessionIO;
    private readonly clock: Clock;
    private readonly events: SessionEvents;

    private env: GameEnvelope | null = null;
    /** Other users' intent records, by userId. */
    private readonly records = new Map<string, IntentRecord>();
    /** My own record: the local copy is authoritative (it may be ahead of the scene). */
    private mine: IntentRecord;
    private mineSeenInScene = false;
    /** Highest errors[me].seq already surfaced, so each rejection shows once. */
    private shownErrorSeq = 0;

    private presence: Presence = { mode: "unknown" };
    private absentSince: number | null = null;
    private unresponsiveSince: number | null = null;
    private timer: unknown = null;

    // write queue
    private envDirty = false;
    private intentDirty = false;
    private pumping = false;
    private failures = 0;
    private retryTimer: unknown = null;
    /** Versions I wrote whose echo hasn't come back yet, oldest first. */
    private inflight: number[] = [];
    private disposed = false;

    constructor(opts: SessionOptions) {
        this.gameId = opts.gameId;
        this.myUserId = opts.myUserId;
        this.board = opts.board;
        this.applyAction = opts.applyAction;
        this.io = opts.io;
        this.clock = opts.clock ?? realClock;
        this.events = opts.events ?? {};
        this.mine = newIntentRecord(opts.gameId, opts.myUserId);
    }

    // -- read side ---------------------------------------------------------

    get envelope(): GameEnvelope | null {
        return this.env;
    }

    isAuthority(): boolean {
        return this.env !== null && this.env.authorityUserId === this.myUserId;
    }

    /** True while one of my intents is waiting for the authority. */
    pending(): boolean {
        if (!this.env || this.isAuthority()) return false;
        return lastSeq(this.mine) > (this.env.acks[this.myUserId] ?? 0);
    }

    myIntentRecord(): IntentRecord {
        return this.mine;
    }

    intentRecords(): IntentRecord[] {
        return [...this.records.values(), this.mine];
    }

    // -- inputs from the scene ---------------------------------------------

    /** The game frame's meta changed (or was discovered). */
    ingestFrameMeta(meta: unknown): void {
        const env = parseEnvelope(meta);
        if (env) this.ingestEnvelope(env);
    }

    ingestEnvelope(incoming: GameEnvelope): void {
        if (this.disposed || incoming.state.gameId !== this.gameId) return;
        const mine = this.env;
        if (!mine) {
            this.adopt(incoming);
            return;
        }
        const me = this.myUserId;
        const amAuthority = mine.authorityUserId === me;

        // Echo of one of my own writes: Drawdy reports our updates back to us.
        if (incoming.authorityUserId === me) {
            const i = this.inflight.indexOf(incoming.version);
            if (i !== -1) {
                this.inflight.splice(0, i + 1);
                if (incoming.version <= mine.version) return;
            }
        }

        if (incoming.version > mine.version) {
            this.adopt(incoming);
            return;
        }
        if (incoming.version === mine.version) {
            if (incoming.authorityUserId === mine.authorityUserId) return; // same lineage, nothing new
            // Two claims at the same version: lower userId wins, deterministically everywhere.
            if (incoming.authorityUserId < mine.authorityUserId) {
                this.adopt(incoming);
            } else if (amAuthority) {
                this.setLocal({ ...mine, version: mine.version + 1 });
            }
            return;
        }
        // Older than mine.
        if (amAuthority) {
            this.envDirty = true;
            void this.pump();
            this.events.onReassert?.();
        }
    }

    /** An intent element's meta changed (or was discovered). */
    ingestIntentMeta(meta: unknown): void {
        const rec = parseIntentRecord(meta);
        if (rec) this.ingestIntentRecord(rec);
    }

    ingestIntentRecord(rec: IntentRecord): void {
        if (this.disposed || rec.gameId !== this.gameId) return;
        if (rec.userId === this.myUserId) {
            this.mineSeenInScene = true;
            // Only take the scene copy if it is ahead of mine (reload, or my other tab).
            if (lastSeq(rec) > lastSeq(this.mine)) {
                this.mine = rec;
                this.events.onChange?.();
            }
        } else {
            this.records.set(rec.userId, rec);
        }
        this.processIntents();
        this.recheck();
    }

    /** My intent element disappeared (deleted / undone). Re-create it on the next write. */
    intentElementRemoved(userId: string): void {
        if (userId === this.myUserId) {
            this.mineSeenInScene = false;
            if (this.pending()) {
                this.intentDirty = true;
                void this.pump();
            }
        } else {
            this.records.delete(userId);
        }
    }

    /**
     * Presence from the collaboration API. `null` = collaboration unavailable
     * (denied / unauthorized): solo mode, where the local user is always the
     * authority (hot-seat).
     */
    setPresence(userIds: readonly string[] | null): void {
        if (userIds === null) {
            this.presence = { mode: "solo" };
        } else {
            const users = new Set(userIds);
            users.add(this.myUserId);
            this.presence = { mode: "shared", users };
        }
        this.recheck();
    }

    // -- inputs from the local user ----------------------------------------

    /**
     * Send one of my actions. As authority it is applied immediately (and the
     * engine's error, if any, returned); otherwise it is queued as an intent
     * and the authority's verdict arrives later via onIntentRejected.
     */
    submit(action: Action): SubmitResult {
        if (this.disposed) return { ok: false, error: "This game is closed." };
        const env = this.env;
        if (!env) return { ok: false, error: "Game is still loading." };
        if (this.isAuthority()) {
            const r = applyLocal(this.board, env, this.myUserId, action, this.applyAction);
            if (!r.ok) return r;
            this.setLocal(r.envelope);
            return { ok: true, via: "direct" };
        }
        const seq = Math.max(lastSeq(this.mine), env.acks[this.myUserId] ?? 0) + 1;
        const fixed = actorFor(env.state, this.myUserId, action).action;
        const intents = [...this.mine.intents, { seq, action: fixed, t: this.clock.now() }].slice(-MAX_INTENTS);
        this.mine = { ...this.mine, intents };
        this.intentDirty = true;
        void this.pump();
        this.events.onChange?.();
        this.recheck(); // starts the unresponsive-authority clock
        return { ok: true, via: "intent" };
    }

    /** Install a freshly created game (I'm the creator and authority). The scene write is the caller's job. */
    initCreated(envelope: GameEnvelope): void {
        this.env = envelope;
        this.inflight.push(envelope.version);
        this.shownErrorSeq = envelope.errors[this.myUserId]?.seq ?? 0;
        this.events.onAuthorityChange?.(this.isAuthority());
        this.events.onChange?.();
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer !== null) this.clock.clearTimeout(this.timer);
        if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
        this.timer = null;
        this.retryTimer = null;
    }

    // -- internals ---------------------------------------------------------

    private adopt(next: GameEnvelope): void {
        const prev = this.env;
        const wasAuthority = this.isAuthority();
        if (prev === null) this.shownErrorSeq = next.errors[this.myUserId]?.seq ?? 0;
        if (prev && next.version > prev.version) this.unresponsiveSince = null; // the authority is alive
        this.env = next;
        this.afterChange(prev, next, "remote", wasAuthority);
        this.processIntents();
        this.recheck();
    }

    private setLocal(next: GameEnvelope): void {
        const prev = this.env;
        const wasAuthority = this.isAuthority();
        this.env = next;
        if (next.authorityUserId === this.myUserId) {
            this.envDirty = true;
            void this.pump();
        }
        this.afterChange(prev, next, "local", wasAuthority);
    }

    private afterChange(prev: GameEnvelope | null, next: GameEnvelope, origin: "local" | "remote", wasAuthority: boolean): void {
        const err = next.errors[this.myUserId];
        if (err && err.seq > this.shownErrorSeq) {
            this.shownErrorSeq = err.seq;
            if (err.seq <= lastSeq(this.mine)) this.events.onIntentRejected?.(err.message);
        }
        const isAuthority = this.isAuthority();
        this.events.onEnvelope?.(prev, next, origin);
        if (isAuthority !== wasAuthority) this.events.onAuthorityChange?.(isAuthority);
        this.events.onChange?.();
    }

    /** As authority, apply every pending intent in one envelope write. */
    private processIntents(): void {
        const env = this.env;
        if (!env || !this.isAuthority() || this.disposed) return;
        const list = pendingIntents(env, this.intentRecords());
        if (list.length === 0) return;
        const res = applyIntents(this.board, env, list, this.applyAction);
        if (res.envelope !== env) this.setLocal(res.envelope);
    }

    private claim(): void {
        const env = this.env;
        if (!env || env.authorityUserId === this.myUserId) return;
        this.absentSince = null;
        this.unresponsiveSince = null;
        this.setLocal({ ...env, authorityUserId: this.myUserId, version: env.version + 1 });
        this.processIntents();
    }

    /** Re-evaluate authority from presence; arm a timer for the next deadline. */
    private recheck(): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
        const env = this.env;
        if (!env || this.disposed) return;
        const p = this.presence;
        if (p.mode === "unknown") return;
        if (p.mode === "solo") {
            if (!this.isAuthority()) this.claim();
            return;
        }
        const now = this.clock.now();
        const auth = env.authorityUserId;
        if (auth === this.myUserId) {
            this.absentSince = null;
            this.unresponsiveSince = null;
            return;
        }
        this.absentSince = p.users.has(auth) ? null : this.absentSince ?? now;
        const anyPending = pendingIntents(env, this.intentRecords()).length > 0;
        this.unresponsiveSince = anyPending ? this.unresponsiveSince ?? now : null;

        let present: readonly string[] = [...p.users];
        let absentSince = this.absentSince;
        if (absentSince === null && this.unresponsiveSince !== null && now - this.unresponsiveSince >= UNRESPONSIVE_MS) {
            // Present but not doing its job: treat as gone right now.
            present = present.filter((u) => u !== auth);
            absentSince = now - FAILOVER_MS;
        }
        const winner = electAuthority(env, present, absentSince, now);
        if (winner === this.myUserId) {
            this.claim();
            return;
        }
        // Wake up at the next deadline to look again.
        let wait = Infinity;
        if (this.absentSince !== null) wait = Math.min(wait, this.absentSince + FAILOVER_MS - now);
        if (this.unresponsiveSince !== null) wait = Math.min(wait, this.unresponsiveSince + UNRESPONSIVE_MS - now);
        if (wait !== Infinity) {
            // If the deadline already passed and someone else is the successor, poll slowly.
            const ms = wait > 0 ? wait + 50 : 1000;
            this.timer = this.clock.setTimeout(() => {
                this.timer = null;
                this.recheck();
            }, ms);
        }
    }

    private async pump(): Promise<void> {
        if (this.pumping || this.disposed) return;
        this.pumping = true;
        try {
            while (!this.disposed && (this.envDirty || this.intentDirty)) {
                if (this.envDirty) {
                    this.envDirty = false;
                    const env = this.env;
                    // Only ever write an envelope that names me as authority.
                    if (env && env.authorityUserId === this.myUserId) {
                        this.inflight.push(env.version);
                        if (this.inflight.length > 20) this.inflight.shift();
                        try {
                            await this.io.writeEnvelope(env);
                            this.failures = 0;
                        } catch {
                            this.envDirty = true;
                            this.scheduleRetry();
                            return;
                        }
                    }
                }
                if (this.intentDirty) {
                    this.intentDirty = false;
                    const rec = this.mine;
                    try {
                        await this.io.writeIntents(rec, this.mineSeenInScene);
                        this.mineSeenInScene = true;
                        this.failures = 0;
                    } catch {
                        this.intentDirty = true;
                        this.scheduleRetry();
                        return;
                    }
                }
            }
        } finally {
            this.pumping = false;
        }
    }

    private scheduleRetry(): void {
        this.failures++;
        if (this.failures > MAX_WRITE_FAILURES || this.retryTimer !== null) return;
        this.retryTimer = this.clock.setTimeout(() => {
            this.retryTimer = null;
            void this.pump();
        }, WRITE_RETRY_MS * this.failures);
    }
}

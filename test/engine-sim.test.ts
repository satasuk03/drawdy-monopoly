// Plays many random full games with random legal actions and checks the
// engine's invariants after every step.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, createGame, needsToAct, seatView } from "../src/engine/index";
import { mulberry32 } from "../src/engine/rng";
import type { Action, ActionType, GameSettings, GameState, Seat, TradeOffer } from "../src/engine/types";
import { board } from "./fixtures/board";
import { actorFor } from "./fixtures/helpers";

const COLORS = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4"];

/** Separate PRNG for the agent, so the engine's own rng is untouched. */
function agentRng(seed: number) {
    let st = seed >>> 0;
    const next = () => {
        const r = mulberry32(st);
        st = r.state;
        return r.value;
    };
    return {
        next,
        int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
        pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
        chance: (p: number) => next() < p,
    };
}
type Agent = ReturnType<typeof agentRng>;

const ADMIN: ActionType[] = ["force-skip", "end-game"];

/** How often each applied action type and phase occurred, across all simulated games. */
const seen = new Map<string, number>();
const tally = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1);

function totalMoney(s: GameState): number {
    return s.players.reduce((a, p) => a + p.cash, 0) + s.jackpot;
}

function checkInvariants(s: GameState, ctx: string): void {
    const fail = (m: string) => assert.fail(`${ctx}: ${m}`);
    for (const p of s.players) {
        if (!Number.isInteger(p.cash) || p.cash < 0) fail(`${p.name} has cash ${p.cash}`);
        if (p.bankrupt && (p.cash !== 0 || p.jailCards.chance + p.jailCards.chest !== 0)) fail(`bankrupt ${p.name} holds assets`);
        if (p.jailTurns < 0 || p.jailTurns > 2) fail(`jailTurns ${p.jailTurns}`);
        if (p.position < 0 || p.position >= 40) fail(`position ${p.position}`);
    }
    if (s.jackpot < 0 || (!s.settings.freeParkingJackpot && s.jackpot !== 0)) fail(`jackpot ${s.jackpot}`);

    let houses = 0;
    let hotels = 0;
    for (const [key, o] of Object.entries(s.ownership)) {
        const i = Number(key);
        const t = board.tiles[i];
        if (!t || (t.kind !== "property" && t.kind !== "railroad" && t.kind !== "utility")) fail(`tile ${key} isn't ownable`);
        const owner = s.players[o.owner];
        if (!owner || owner.bankrupt) fail(`tile ${key} owned by bad seat ${o.owner}`);
        if (!Number.isInteger(o.houses) || o.houses < 0 || o.houses > 5) fail(`tile ${key} houses ${o.houses}`);
        if (t.kind !== "property" && o.houses !== 0) fail(`buildings on ${t.name}`);
        if (o.mortgaged && o.houses !== 0) fail(`mortgaged ${t.name} has buildings`);
        if (o.houses === 5) hotels++;
        else houses += o.houses;
        if (t.kind === "property" && o.houses > 0) {
            const group = board.tiles.map((x, j) => (x.kind === "property" && x.group === t.group ? j : -1)).filter((j) => j >= 0);
            const os = group.map((j) => s.ownership[String(j)]);
            if (!os.every((x) => x && x.owner === o.owner)) fail(`buildings on ${t.name} without the monopoly`);
            if (os.some((x) => x.mortgaged)) fail(`buildings in a group with a mortgage (${t.name})`);
            if (s.settings.evenBuild) {
                const hs = os.map((x) => x.houses);
                if (Math.max(...hs) - Math.min(...hs) > 1) fail(`uneven group ${t.group}: ${hs}`);
            }
        }
    }
    if (s.phase.kind !== "lobby") {
        if (s.housesLeft < 0 || s.housesLeft + houses !== s.settings.houseSupply) fail(`houses ${s.housesLeft} + ${houses}`);
        if (s.hotelsLeft < 0 || s.hotelsLeft + hotels !== s.settings.hotelSupply) fail(`hotels ${s.hotelsLeft} + ${hotels}`);
    }

    for (const deck of ["chance", "chest"] as const) {
        const d = s.decks[deck];
        if (new Set(d.order).size !== d.order.length) fail(`${deck} has duplicate cards`);
        if (d.order.length && (d.next < 0 || d.next >= d.order.length)) fail(`${deck} pointer ${d.next}`);
        const jailFree = board[deck].filter((c) => c.effect.kind === "jail-free").length;
        const inDeck = d.order.filter((i) => board[deck][i].effect.kind === "jail-free").length;
        const held = s.players.reduce((a, p) => a + p.jailCards[deck], 0);
        if (inDeck + held !== jailFree) fail(`${deck} jail cards: ${inDeck} in deck + ${held} held`);
        if (d.order.length + held !== board[deck].length) fail(`${deck} lost cards`);
    }
    if (s.log.length > 60) fail("log over cap");

    const ph = s.phase;
    if (ph.kind !== "game-over" && s.players[s.current].bankrupt) fail("current player is bankrupt");
    if (ph.kind === "debt" && s.players[ph.debt.debtor].bankrupt) fail("bankrupt debtor");
    if (ph.kind === "auction" && ph.auction.bidders.some((b) => s.players[b].bankrupt)) fail("bankrupt bidder");
}

/** Exact change in total money for actions whose bank flow is known; null = only bounded. */
function expectedDelta(prev: GameState, next: GameState, a: Action): number | null {
    const st = prev.settings;
    const tile = "tile" in a ? board.tiles[a.tile] : null;
    switch (a.type) {
        case "build":
            return tile?.kind === "property" ? -tile.houseCost : null;
        case "sell-building": {
            if (tile?.kind !== "property") return null;
            const before = prev.ownership[String(a.tile)].houses;
            const after = next.ownership[String(a.tile)].houses;
            return (before - after) * Math.floor(tile.houseCost / 2);
        }
        case "mortgage":
            return tile && "price" in tile ? Math.floor(tile.price / 2) : null;
        case "unmortgage":
            return tile && "price" in tile ? -(Math.floor(tile.price / 2) + Math.ceil(Math.floor(tile.price / 2) / 10)) : null;
        case "buy": {
            const t = prev.phase.kind === "buy-decision" ? board.tiles[prev.phase.tile] : null;
            return t && "price" in t ? -t.price : null;
        }
        case "bid":
        case "pass-bid":
            if (prev.phase.kind !== "auction") return null;
            // The winner pays the bank when the auction closes.
            if (!next.ownership[String(prev.phase.auction.tile)]) return 0;
            return -(a.type === "bid" ? a.amount : prev.phase.auction.highBid);
        case "pay-jail-fine":
            return st.freeParkingJackpot ? 0 : -st.jailFine;
        case "pay-debt":
            // Queued debts are always between players (multi-player cards).
            if (prev.phase.kind !== "debt") return null;
            return prev.phase.debt.creditor === null && !st.freeParkingJackpot ? -prev.phase.debt.amount : 0;
        case "accept-trade": {
            const t = prev.pendingTrade!;
            let interest = 0;
            for (const i of [...t.give.tiles, ...t.get.tiles]) {
                const o = prev.ownership[String(i)];
                const def = board.tiles[i];
                if (o.mortgaged && "price" in def) interest += Math.ceil(Math.floor(def.price / 2) / 10);
            }
            return -interest;
        }
        case "decline":
        case "end-turn":
        case "use-jail-card":
        case "propose-trade":
        case "reject-trade":
        case "cancel-trade":
            return 0;
        default:
            return null;
    }
}

function randomOffer(r: Agent, s: GameState, seat: Seat): TradeOffer {
    const mine = Object.keys(s.ownership)
        .map(Number)
        .filter((i) => s.ownership[String(i)].owner === seat);
    const tiles = mine.length && r.chance(0.6) ? [r.pick(mine)] : [];
    const cash = r.chance(0.5) ? r.int(0, Math.min(200, s.players[seat].cash)) : 0;
    const p = s.players[seat];
    const jailCards = p.jailCards.chance + p.jailCards.chest > 0 && r.chance(0.3) ? 1 : 0;
    return { cash, tiles, jailCards };
}

/** Concrete candidate actions for `seat` given its SeatView. */
function candidates(r: Agent, s: GameState, seat: Seat): Action[] {
    const v = seatView(board, s, seat);
    const out: Action[] = [];
    const ph = s.phase;
    for (const type of v.legal) {
        switch (type) {
            case "roll":
            case "buy":
            case "decline":
            case "pass-bid":
            case "pay-jail-fine":
            case "use-jail-card":
            case "end-turn":
            case "pay-debt":
            case "declare-bankruptcy":
                out.push({ type, seat });
                break;
            case "bid":
                if (ph.kind === "auction") {
                    const cash = s.players[seat].cash;
                    const hi = Math.min(cash, ph.auction.highBid + 80);
                    if (hi > ph.auction.highBid) out.push({ type, seat, amount: r.int(ph.auction.highBid + 1, hi) });
                }
                break;
            case "build":
                out.push({ type, seat, tile: r.pick(v.buildable) });
                break;
            case "sell-building":
                out.push({ type, seat, tile: r.pick(v.sellable) });
                break;
            case "mortgage":
                out.push({ type, seat, tile: r.pick(v.mortgageable) });
                break;
            case "unmortgage":
                out.push({ type, seat, tile: r.pick(v.unmortgageable) });
                break;
            case "propose-trade": {
                const others = s.players.filter((p) => p.seat !== seat && !p.bankrupt).map((p) => p.seat);
                const to = r.pick(others);
                out.push({ type, seat, to, give: randomOffer(r, s, seat), get: randomOffer(r, s, to) });
                break;
            }
            case "accept-trade":
            case "reject-trade":
            case "cancel-trade":
                out.push({ type, seat, tradeId: s.pendingTrade!.id });
                break;
            default:
                break;
        }
    }
    return out;
}

/** Pick an action with a mild strategy so games progress: buy often, build sometimes, raise cash in debt. */
function choose(r: Agent, s: GameState, seat: Seat, cands: Action[]): Action | null {
    const by = (t: ActionType) => cands.filter((c) => c.type === t);
    const has = (t: ActionType) => by(t).length > 0;
    if (s.phase.kind === "debt") {
        if (has("pay-debt")) return by("pay-debt")[0];
        const raise = [...by("sell-building"), ...by("mortgage")];
        if (raise.length && r.chance(0.9)) return r.pick(raise);
        if (has("propose-trade") && r.chance(0.3)) return by("propose-trade")[0];
        if (raise.length) return r.pick(raise);
        return by("declare-bankruptcy")[0] ?? null;
    }
    if (s.pendingTrade) {
        if (seat === s.pendingTrade.to) return r.chance(0.5) ? (by("accept-trade")[0] ?? by("reject-trade")[0]) : by("reject-trade")[0];
        return r.chance(0.2) ? (by("cancel-trade")[0] ?? null) : null;
    }
    if (has("buy") && r.chance(0.7)) return by("buy")[0];
    if (has("bid") && r.chance(0.5)) return by("bid")[0];
    // Builders: keep enough of a cushion to survive a few rents.
    if (has("build") && s.players[seat].cash > 400 && r.chance(0.6)) return by("build")[0];
    const optional = [...by("build"), ...by("sell-building"), ...by("mortgage"), ...by("unmortgage"), ...by("pay-jail-fine"), ...by("use-jail-card")];
    if (optional.length && r.chance(0.25)) return r.pick(optional);
    if (has("propose-trade") && r.chance(0.03)) return by("propose-trade")[0];
    const progress = cands.filter((c) => ["roll", "end-turn", "decline", "pass-bid", "bid"].includes(c.type));
    if (progress.length) return r.pick(progress);
    return cands.length ? r.pick(cands) : null;
}

function playGame(seed: number, players: number, settings: Partial<GameSettings>): { state: GameState; steps: number } {
    const r = agentRng(seed * 7919 + 1);
    let s = createGame({ gameId: `sim-${seed}`, board, creatorUserId: "u0", seed, settings });
    const apply = (a: Action, userId: string) => {
        const res = applyAction(board, s, a, actorFor(s, userId));
        if (!res.ok) assert.fail(`seed ${seed}: legal-looking ${a.type} rejected: ${res.error}`);
        return res.state;
    };
    for (let i = 0; i < players; i++) {
        // Seats 0 and 1 share a user (hot-seat) to exercise that path.
        const uid = i === 1 ? "u0" : `u${i}`;
        s = apply({ type: "join", userId: uid, name: `P${i}`, color: COLORS[i], token: board.tokens[i].id }, uid);
    }
    s = apply({ type: "start" }, "u0");
    checkInvariants(s, `seed ${seed} start`);

    let steps = 0;
    while (s.phase.kind !== "game-over") {
        steps++;
        if (steps > 60_000) assert.fail(`seed ${seed}: game did not terminate`);
        const waiting = needsToAct(s);
        assert.ok(waiting.length > 0, `seed ${seed}: nobody to act in ${s.phase.kind}`);
        for (const w of waiting) {
            const legal = seatView(board, s, w).legal.filter((t) => !ADMIN.includes(t));
            assert.ok(legal.length > 0, `seed ${seed}: seat ${w} has no legal action in ${s.phase.kind}`);
        }

        let action: Action | null = null;
        let userId = "";
        if (r.chance(0.005)) {
            action = { type: "force-skip", seat: r.pick(waiting) };
            userId = "u0";
        } else {
            // Mostly the waited-on seat; occasionally the current player in a free phase.
            const order = r.chance(0.5) ? [...waiting].reverse() : waiting;
            for (const seat of order) {
                action = choose(r, s, seat, candidates(r, s, seat));
                if (action) {
                    userId = s.players[seat].userId;
                    break;
                }
            }
        }
        if (!action) continue;

        const res = applyAction(board, s, action, actorFor(s, userId));
        if (!res.ok) {
            // Random trade offers may be invalid (e.g. a tile with buildings in its group); everything else must pass.
            if (action.type === "propose-trade") continue;
            assert.fail(`seed ${seed} step ${steps}: ${action.type} rejected: ${res.error}`);
        }
        const next = res.state;
        const ctx = `seed ${seed} step ${steps} after ${action.type}`;
        checkInvariants(next, ctx);
        tally(action.type);
        tally(`phase:${next.phase.kind}`);
        if (next.phase.kind === "debt" && next.phase.queue) tally("debt-queue");
        if (Object.values(next.ownership).some((o) => o.houses === 5)) tally("hotel");
        const delta = totalMoney(next) - totalMoney(s);
        const exact = expectedDelta(s, next, action);
        if (exact !== null) assert.ok(delta === exact, `${ctx}: money changed by ${delta}, expected ${exact}`);
        else if (action.type === "roll" || action.type === "force-skip") {
            const cap = 2 * 2 * s.settings.salary + 200;
            assert.ok(delta <= cap, `${ctx}: roll created ${delta}`);
        }
        s = next;
    }
    return { state: s, steps };
}

const SETTING_VARIANTS: Partial<GameSettings>[] = [
    { roundLimit: 40 },
    { roundLimit: 40, auctionOnDecline: false, evenBuild: false },
    { roundLimit: 40, freeParkingJackpot: true, doubleSalaryOnGo: true },
    { roundLimit: 40, rentInJail: false, houseSupply: 12, hotelSupply: 4, startingCash: 800 },
];

test("random full games keep every invariant and always terminate", () => {
    let games = 0;
    let lastStanding = 0;
    for (let players = 2; players <= 6; players++) {
        for (let k = 0; k < 16; k++) {
            const seed = players * 1000 + k;
            const { state } = playGame(seed, players, SETTING_VARIANTS[k % SETTING_VARIANTS.length]);
            assert.equal(state.phase.kind, "game-over");
            if (state.phase.kind === "game-over" && state.phase.reason === "last-standing") lastStanding++;
            games++;
        }
    }
    assert.equal(games, 80);
    if (process.env.SIM_STATS) console.log(Object.fromEntries([...seen].sort()));
    const required = ["accept-trade", "build", "sell-building", "mortgage", "unmortgage", "bid", "pay-debt", "declare-bankruptcy", "pay-jail-fine", "use-jail-card", "force-skip", "hotel", "phase:auction", "phase:debt"];
    for (const k of required) assert.ok((seen.get(k) ?? 0) > 0, `simulation never exercised ${k}`);
    assert.ok(lastStanding > 0, "some games should end by bankruptcy");
});

test("determinism: same seed and actions give identical states", () => {
    const a = playGame(77, 4, { roundLimit: 25 });
    const b = playGame(77, 4, { roundLimit: 25 });
    assert.equal(a.steps, b.steps);
    assert.deepEqual(a.state, b.state);
    const c = playGame(78, 4, { roundLimit: 25 });
    assert.notDeepEqual(a.state.log, c.state.log);
});

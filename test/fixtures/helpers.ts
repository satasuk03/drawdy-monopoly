// Test helpers: set up games, apply actions as the right user, rig dice and decks.

import assert from "node:assert/strict";
import { applyAction, createGame } from "../../src/engine/index";
import { mulberry32 } from "../../src/engine/rng";
import type { Action, Actor, GameSettings, GameState, Seat } from "../../src/engine/types";
import { board } from "./board";

export const NAMES = ["Ann", "Bo", "Cy", "Di", "Ed", "Fay"];
const COLORS = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4"];

/** Started game with `n` players, seat i controlled by user `u${i}` (u0 is the creator). */
export function newGame(n: number, settings: Partial<GameSettings> = {}, seed = 42): GameState {
    let s = lobby(n, settings, seed);
    s = act(s, { type: "start" }, "u0");
    return s;
}

export function lobby(n: number, settings: Partial<GameSettings> = {}, seed = 42): GameState {
    let s = createGame({ gameId: "g1", board, creatorUserId: "u0", seed, settings });
    for (let i = 0; i < n; i++) {
        s = act(s, { type: "join", userId: `u${i}`, name: NAMES[i], color: COLORS[i], token: board.tokens[i].id }, `u${i}`);
    }
    return s;
}

export function actorFor(s: GameState, userId: string): Actor {
    return { userId, isCreator: userId === s.creatorUserId };
}

/** The user controlling the action's seat, or the creator for seatless actions. */
function defaultUser(s: GameState, a: Action): string {
    if ("seat" in a && a.type !== "force-skip") return s.players[a.seat].userId;
    return s.creatorUserId;
}

export function act(s: GameState, a: Action, userId = defaultUser(s, a)): GameState {
    const r = applyAction(board, s, a, actorFor(s, userId));
    if (!r.ok) assert.fail(`${a.type} rejected: ${r.error}`);
    return r.state;
}

export function reject(s: GameState, a: Action, userId = defaultUser(s, a)): string {
    const r = applyAction(board, s, a, actorFor(s, userId));
    assert.equal(r.ok, false, `${a.type} should have been rejected`);
    return r.ok ? "" : r.error;
}

function die(state: number): { value: number; state: number } {
    const r = mulberry32(state);
    return { value: 1 + Math.floor(r.value * 6), state: r.state };
}

/** An rng state whose next rolls are exactly `pairs`. */
export function seedFor(...pairs: [number, number][]): number {
    for (let seed = 1; seed < 50_000_000; seed++) {
        let st = seed;
        let good = true;
        for (const [a, b] of pairs) {
            const x = die(st);
            const y = die(x.state);
            st = y.state;
            if (x.value !== a || y.value !== b) {
                good = false;
                break;
            }
        }
        if (good) return seed;
    }
    throw new Error("no seed found");
}

/** Set the dice for the next roll(s). Mutates (tests own their states). */
export function rig(s: GameState, ...pairs: [number, number][]): GameState {
    s.rng = seedFor(...pairs);
    return s;
}

/** Make `cardId` the next card drawn from `deck`. */
export function stack(s: GameState, deck: "chance" | "chest", cardId: string): GameState {
    const idx = board[deck].findIndex((c) => c.id === cardId);
    assert.ok(idx >= 0, `unknown card ${cardId}`);
    const d = s.decks[deck];
    const rest = d.order.filter((i) => i !== idx);
    d.order = [idx, ...rest];
    d.next = 0;
    return s;
}

export function give(s: GameState, seat: Seat, tiles: number[], houses = 0, mortgaged = false): GameState {
    for (const t of tiles) s.ownership[String(t)] = { owner: seat, houses, mortgaged };
    return s;
}

export function place(s: GameState, seat: Seat, position: number): GameState {
    s.players[seat].position = position;
    return s;
}

export const roll = (s: GameState, seat: Seat = s.current) => act(s, { type: "roll", seat });
export const lastLog = (s: GameState, n = 1) => s.log.slice(-n).map((e) => e.text);
export const logs = (s: GameState) => s.log.map((e) => e.text).join("\n");

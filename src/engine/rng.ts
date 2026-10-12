// Seeded randomness. The PRNG state lives in GameState.rng so every client
// that replays the same actions rolls the same dice and shuffles the same decks.

import type { GameState } from "./types";

/** One mulberry32 step: a float in [0, 1) and the next state (uint32). */
export function mulberry32(state: number): { value: number; state: number } {
    const next = (state + 0x6d2b79f5) | 0;
    let t = next;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next >>> 0 };
}

/** Draw a float in [0, 1) from the state's PRNG, advancing it. */
export function random(s: GameState): number {
    const r = mulberry32(s.rng);
    s.rng = r.state;
    return r.value;
}

export function rollDie(s: GameState): number {
    return 1 + Math.floor(random(s) * 6);
}

export function rollDice(s: GameState): [number, number] {
    return [rollDie(s), rollDie(s)];
}

/** Fisher–Yates, in place. */
export function shuffle<T>(s: GameState, arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(random(s) * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

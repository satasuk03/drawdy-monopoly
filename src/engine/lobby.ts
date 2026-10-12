// Game creation, the lobby and starting the game.

import type { BoardDef } from "../boards/types";
import { newDeck } from "./cards";
import { DEFAULT_SETTINGS, type GameSettings, type GameState } from "./types";
import { isInt, log, MAX_PLAYERS, money } from "./util";

const BOOL_KEYS = ["doubleSalaryOnGo", "freeParkingJackpot", "auctionOnDecline", "evenBuild", "rentInJail"] as const;
const NUM_KEYS = ["startingCash", "salary", "jailFine", "roundLimit", "houseSupply", "hotelSupply"] as const;

/** Validate a settings patch. Returns the merged settings or an error. */
export function mergeSettings(base: GameSettings, patch: unknown): GameSettings | string {
    if (!patch || typeof patch !== "object") return "Settings must be an object.";
    const out: GameSettings = { ...base };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if ((BOOL_KEYS as readonly string[]).includes(k)) {
            if (typeof v !== "boolean") return `Setting ${k} must be true or false.`;
            (out as Record<string, unknown>)[k] = v;
        } else if ((NUM_KEYS as readonly string[]).includes(k)) {
            if (!isInt(v) || v < 0 || v > 1000000) return `Setting ${k} must be a whole number from 0 to 1,000,000.`;
            (out as Record<string, unknown>)[k] = v;
        } else {
            return `Unknown setting ${k}.`;
        }
    }
    return out;
}

export function createGame(opts: {
    gameId: string;
    board: BoardDef;
    creatorUserId: string;
    seed: number;
    settings?: Partial<GameSettings>;
}): GameState {
    const merged = opts.settings ? mergeSettings(DEFAULT_SETTINGS, opts.settings) : DEFAULT_SETTINGS;
    const settings = typeof merged === "string" ? { ...DEFAULT_SETTINGS } : merged;
    return {
        schema: 1,
        gameId: opts.gameId,
        boardId: opts.board.id,
        creatorUserId: opts.creatorUserId,
        settings,
        players: [],
        ownership: {},
        current: 0,
        phase: { kind: "lobby" },
        dice: null,
        doublesCount: 0,
        round: 0,
        housesLeft: settings.houseSupply,
        hotelsLeft: settings.hotelSupply,
        jackpot: 0,
        decks: { chance: { order: [], next: 0 }, chest: { order: [], next: 0 } },
        pendingTrade: null,
        log: [{ id: 0, text: `New game of ${opts.board.name}.`, tone: "info" }],
        nextLogId: 1,
        rng: opts.seed >>> 0,
    };
}

export function joinError(
    board: BoardDef,
    s: GameState,
    a: { userId: string; name: string; color: string; token: string },
    actorId: string,
): string | null {
    if (a.userId !== actorId) return "You can only join as yourself.";
    if (s.players.length >= MAX_PLAYERS) return `The game is full (${MAX_PLAYERS} players).`;
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (name.length < 1 || name.length > 24) return "Pick a name of 1–24 characters.";
    if (typeof a.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(a.color)) return "Pick a color like #ff8800.";
    if (!board.tokens.some((t) => t.id === a.token)) return "Unknown token.";
    if (s.players.some((p) => p.token === a.token)) return "That token is taken.";
    if (s.players.some((p) => p.color.toLowerCase() === a.color.toLowerCase())) return "That color is taken.";
    return null;
}

export function doJoin(s: GameState, a: { userId: string; name: string; color: string; token: string }): void {
    const seat = s.players.length;
    s.players.push({
        seat,
        userId: a.userId,
        name: a.name.trim(),
        color: a.color.toLowerCase(),
        token: a.token,
        cash: 0,
        position: 0,
        inJail: false,
        jailTurns: 0,
        jailCards: { chance: 0, chest: 0 },
        bankrupt: false,
    });
    log(s, `${a.name.trim()} joined.`, "info", seat);
}

export function doLeave(s: GameState, seat: number): void {
    const [p] = s.players.splice(seat, 1);
    s.players.forEach((q, i) => (q.seat = i));
    log(s, `${p.name} left.`, "info");
}

export function doStart(board: BoardDef, s: GameState): void {
    for (const p of s.players) p.cash = s.settings.startingCash;
    s.housesLeft = s.settings.houseSupply;
    s.hotelsLeft = s.settings.hotelSupply;
    s.decks = { chance: newDeck(s, board.chance), chest: newDeck(s, board.chest) };
    s.current = 0;
    s.round = 0;
    s.doublesCount = 0;
    s.phase = { kind: "pre-roll" };
    log(s, `The game begins! Everyone starts with ${money(board, s.settings.startingCash)}.`, "good");
    log(s, `${s.players[0].name}'s turn.`, "info", 0);
}

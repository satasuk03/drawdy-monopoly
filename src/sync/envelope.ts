// What lives in element `meta.tycoon`, and how to read it back safely.
//
// Two kinds of record are synced through the scene:
//
//   - GameEnvelope, on the game's root frame. Written ONLY by the current
//     authority. Holds the whole GameState plus bookkeeping (version, acks).
//   - IntentRecord, on one tiny invisible element per (game, user). Written
//     ONLY by that user. Holds the user's recent actions with increasing seq.
//
// One writer per element means no merge conflicts even though Drawdy meta is
// last-writer-wins. Everything read from meta came over the network from
// another client (possibly an older or buggy version), so the parsers below
// never throw and return null for anything they can't trust.

import type { Action, GameState } from "../engine/types";

/** Key used on element meta for everything this extension stores. */
export const META_KEY = "tycoon";

/** Separator in element ids. Kept in one place in case Drawdy restricts id characters. */
export const SEP = ":";

/** How many intents a user's record keeps (older ones are long acked). */
export const MAX_INTENTS = 20;

/** Where the renderer put the game. Element ids themselves are derived from gameId (see ids below). */
export type SceneIds = {
    /** The root frame's element id. */
    frame: string;
    /** Canvas position of the board's top-left at creation (the frame's position is authoritative later). */
    origin: { x: number; y: number };
};

export type GameEnvelope = {
    kind: "game";
    v: 1;
    /** +1 on every authority write. Higher always wins. */
    version: number;
    /** The only client allowed to write this envelope and the game's scene elements. */
    authorityUserId: string;
    /** userId → last intent seq applied (or rejected). */
    acks: Record<string, number>;
    /** Last rejection per user. */
    errors: Record<string, { seq: number; message: string }>;
    state: GameState;
    ids: SceneIds;
};

export type Intent = {
    seq: number;
    action: Action;
    /** Wall-clock ms when written (writer's clock). Only used to interleave users fairly. */
    t?: number;
};

export type IntentRecord = {
    kind: "intent";
    v: 1;
    gameId: string;
    userId: string;
    /** Ascending seq, last MAX_INTENTS only. */
    intents: Intent[];
};

// ---------------------------------------------------------------------------
// ids

/** FNV-1a 32-bit, base36. Short, stable, deterministic across clients. */
export function shortHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** Make a gameId out of anything (e.g. generateId()), restricted to safe characters. */
export function makeGameId(raw: string): string {
    const clean = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    return `bt-${clean || shortHash(raw)}`;
}

/** Prefix every element of a game starts with. */
export function gamePrefix(gameId: string): string {
    return `${gameId}${SEP}`;
}

export function frameElementId(gameId: string): string {
    return `${gameId}${SEP}frame`;
}

export function intentElementId(gameId: string, userId: string): string {
    return `${gameId}${SEP}intent${SEP}${shortHash(userId)}`;
}

export function isIntentElementId(gameId: string, id: string): boolean {
    return id.startsWith(`${gameId}${SEP}intent${SEP}`);
}

/** A scene (render) element id: `${gameId}:${role}:${...parts}`. */
export function sceneElementId(gameId: string, role: string, ...parts: (string | number)[]): string {
    return [gameId, role, ...parts].join(SEP);
}

/** True for ids the renderer owns (everything with the game prefix except the frame and intent elements). */
export function isRenderElementId(gameId: string, id: string): boolean {
    return id.startsWith(gamePrefix(gameId)) && id !== frameElementId(gameId) && !isIntentElementId(gameId, id);
}

// ---------------------------------------------------------------------------
// construction

export function newEnvelope(state: GameState, authorityUserId: string, ids: SceneIds): GameEnvelope {
    return { kind: "game", v: 1, version: 1, authorityUserId, acks: {}, errors: {}, state, ids };
}

export function newIntentRecord(gameId: string, userId: string): IntentRecord {
    return { kind: "intent", v: 1, gameId, userId, intents: [] };
}

export function lastSeq(record: IntentRecord | null | undefined): number {
    if (!record || record.intents.length === 0) return 0;
    return record.intents[record.intents.length - 1]!.seq;
}

// ---------------------------------------------------------------------------
// parsing (defensive: input is network data)

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStr(x: unknown): x is string {
    return typeof x === "string" && x.length > 0;
}

function isNum(x: unknown): x is number {
    return typeof x === "number" && Number.isFinite(x);
}

function isInt(x: unknown): x is number {
    return isNum(x) && Number.isInteger(x);
}

const PHASES = new Set(["lobby", "pre-roll", "buy-decision", "auction", "debt", "post-roll", "game-over"]);

/**
 * Structural check of the parts of GameState the driver relies on. The engine
 * owns the deep semantics; this only guarantees we won't crash rendering it.
 */
export function isPlausibleState(x: unknown): x is GameState {
    if (!isObj(x)) return false;
    if (x.schema !== 1 || !isStr(x.gameId) || !isStr(x.boardId) || !isStr(x.creatorUserId)) return false;
    if (!isObj(x.settings) || !isObj(x.ownership) || !isObj(x.decks) || !isInt(x.current)) return false;
    if (!isObj(x.phase) || !PHASES.has(x.phase.kind as string)) return false;
    if (!Array.isArray(x.log) || !isInt(x.nextLogId) || !isInt(x.round)) return false;
    if (x.dice !== null && !(Array.isArray(x.dice) && x.dice.length === 2 && x.dice.every(isInt))) return false;
    if (!Array.isArray(x.players) || x.players.length > 8) return false;
    for (let i = 0; i < x.players.length; i++) {
        const p = x.players[i];
        if (!isObj(p)) return false;
        if (p.seat !== i || !isStr(p.userId) || typeof p.name !== "string" || typeof p.color !== "string") return false;
        if (typeof p.token !== "string" || !isNum(p.cash) || !isInt(p.position)) return false;
        if (p.position < 0 || p.position > 39) return false;
        if (typeof p.inJail !== "boolean" || typeof p.bankrupt !== "boolean") return false;
    }
    for (const [k, o] of Object.entries(x.ownership)) {
        if (!/^\d+$/.test(k) || !isObj(o) || !isInt(o.owner) || !isInt(o.houses) || typeof o.mortgaged !== "boolean") return false;
    }
    return true;
}

/** Parse a frame's `meta` (the whole meta object, or meta.tycoon) into an envelope, or null. */
export function parseEnvelope(meta: unknown): GameEnvelope | null {
    const raw = isObj(meta) && isObj(meta[META_KEY]) ? meta[META_KEY] : meta;
    if (!isObj(raw)) return null;
    if (raw.kind !== "game" || raw.v !== 1) return null;
    if (!isInt(raw.version) || raw.version < 0) return null;
    if (!isStr(raw.authorityUserId)) return null;
    if (!isPlausibleState(raw.state)) return null;
    const ids = raw.ids;
    if (!isObj(ids) || !isStr(ids.frame) || !isObj(ids.origin) || !isNum(ids.origin.x) || !isNum(ids.origin.y)) {
        return null;
    }
    const acks: Record<string, number> = {};
    if (isObj(raw.acks)) {
        for (const [u, s] of Object.entries(raw.acks)) if (isInt(s) && s >= 0) acks[u] = s;
    }
    const errors: GameEnvelope["errors"] = {};
    if (isObj(raw.errors)) {
        for (const [u, e] of Object.entries(raw.errors)) {
            if (isObj(e) && isInt(e.seq) && typeof e.message === "string") errors[u] = { seq: e.seq, message: e.message };
        }
    }
    return {
        kind: "game",
        v: 1,
        version: raw.version,
        authorityUserId: raw.authorityUserId,
        acks,
        errors,
        state: raw.state,
        ids: { frame: ids.frame, origin: { x: ids.origin.x, y: ids.origin.y } },
    };
}

/**
 * Parse an intent element's meta. Malformed intents are dropped individually;
 * the record survives as long as its header is sound. Intents are returned
 * sorted by seq with duplicates removed.
 */
export function parseIntentRecord(meta: unknown): IntentRecord | null {
    const raw = isObj(meta) && isObj(meta[META_KEY]) ? meta[META_KEY] : meta;
    if (!isObj(raw)) return null;
    if (raw.kind !== "intent" || !isStr(raw.gameId) || !isStr(raw.userId)) return null;
    const intents: Intent[] = [];
    const seen = new Set<number>();
    if (Array.isArray(raw.intents)) {
        for (const it of raw.intents) {
            if (!isObj(it) || !isInt(it.seq) || it.seq <= 0 || seen.has(it.seq)) continue;
            if (!isObj(it.action) || !isStr(it.action.type)) continue;
            seen.add(it.seq);
            const intent: Intent = { seq: it.seq, action: it.action as Action };
            if (isNum(it.t)) intent.t = it.t;
            intents.push(intent);
        }
    }
    intents.sort((a, b) => a.seq - b.seq);
    return { kind: "intent", v: 1, gameId: raw.gameId, userId: raw.userId, intents };
}

/** Which kind of record a meta object carries, without full parsing. */
export function metaKind(meta: unknown): "game" | "intent" | null {
    if (!isObj(meta) || !isObj(meta[META_KEY])) return null;
    const k = meta[META_KEY].kind;
    return k === "game" || k === "intent" ? k : null;
}

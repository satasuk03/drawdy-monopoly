// Small shared helpers: board lookups, ownership queries, logging.
// Everything that mutates takes the *draft* state (a private clone made by
// applyAction), never the caller's state.

import type { BoardDef, TileDef } from "../boards/types";
import { formatMoney } from "../boards/types";
import type { GameState, LogEntry, Ownership, Player, Seat } from "./types";

export const LOG_CAP = 60;
export const MAX_PLAYERS = 6;

export type OwnableTile = Extract<TileDef, { kind: "property" | "railroad" | "utility" }>;
export type PropertyTile = Extract<TileDef, { kind: "property" }>;

/** GameState is plain JSON, so a JSON round trip is a faithful deep copy. */
export function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

export function isInt(n: unknown): n is number {
    return typeof n === "number" && Number.isInteger(n);
}

export function ownableTile(board: BoardDef, tile: number): OwnableTile | null {
    const t = board.tiles[tile];
    if (!t) return null;
    return t.kind === "property" || t.kind === "railroad" || t.kind === "utility" ? t : null;
}

export function ownerOf(s: GameState, tile: number): Ownership | null {
    return s.ownership[String(tile)] ?? null;
}

export function groupTiles(board: BoardDef, group: string): number[] {
    const out: number[] = [];
    board.tiles.forEach((t, i) => {
        if (t.kind === "property" && t.group === group) out.push(i);
    });
    return out;
}

/** Owner holds every tile of the group (mortgaged ones count, per official rules). */
export function ownsGroup(board: BoardDef, s: GameState, seat: Seat, group: string): boolean {
    return groupTiles(board, group).every((i) => ownerOf(s, i)?.owner === seat);
}

/** Tiles of `tile`'s color group, or just [tile] for railroads/utilities. */
export function groupOf(board: BoardDef, tile: number): number[] {
    const t = board.tiles[tile];
    return t && t.kind === "property" ? groupTiles(board, t.group) : [tile];
}

export function groupHasBuildings(board: BoardDef, s: GameState, tile: number): boolean {
    return groupOf(board, tile).some((i) => (ownerOf(s, i)?.houses ?? 0) > 0);
}

export function ownedTiles(s: GameState, seat: Seat): number[] {
    return Object.keys(s.ownership)
        .filter((k) => s.ownership[k].owner === seat)
        .map(Number)
        .sort((a, b) => a - b);
}

export function activeSeats(s: GameState): Seat[] {
    return s.players.filter((p) => !p.bankrupt).map((p) => p.seat);
}

export function mortgageValue(t: OwnableTile): number {
    return Math.floor(t.price / 2);
}

/** 10% of the mortgage value, rounded up to whole units. */
export function mortgageInterest(t: OwnableTile): number {
    return Math.ceil(mortgageValue(t) / 10);
}

export function halfHouseCost(t: PropertyTile): number {
    return Math.floor(t.houseCost / 2);
}

export function jailIndex(board: BoardDef): number {
    const i = board.tiles.findIndex((t) => t.kind === "jail");
    return i < 0 ? 10 : i;
}

export function money(board: BoardDef, n: number): string {
    return formatMoney(board, n);
}

export function tileName(board: BoardDef, tile: number): string {
    return board.tiles[tile]?.name ?? `tile ${tile}`;
}

export function playerName(s: GameState, seat: Seat | null): string {
    return seat === null ? "the bank" : s.players[seat]?.name ?? `seat ${seat}`;
}

export function current(s: GameState): Player {
    return s.players[s.current];
}

export function log(s: GameState, text: string, tone: LogEntry["tone"], seat?: Seat): void {
    const entry: LogEntry = { id: s.nextLogId++, text, tone };
    if (seat !== undefined) entry.seat = seat;
    s.log.push(entry);
    if (s.log.length > LOG_CAP) s.log.splice(0, s.log.length - LOG_CAP);
}

// Rent and net worth. Both are read-only.

import type { BoardDef } from "../boards/types";
import type { GameState, Seat } from "./types";
import { ownableTile, ownedTiles, ownerOf, ownsGroup } from "./util";

/**
 * Standard rent owed for landing on `tile` (0 if bank-owned or mortgaged).
 * Card multipliers (move-to-nearest) and the rent-in-jail house rule are
 * applied by the caller.
 */
export function rentFor(board: BoardDef, state: GameState, tile: number, diceTotal: number): number {
    const t = ownableTile(board, tile);
    const o = ownerOf(state, tile);
    if (!t || !o || o.mortgaged) return 0;
    if (t.kind === "property") {
        if (o.houses > 0) return t.rent[Math.min(o.houses, 5)];
        return ownsGroup(board, state, o.owner, t.group) ? t.rent[0] * 2 : t.rent[0];
    }
    // Railroads and utilities count every one the owner holds, mortgaged or not.
    const sameKind = board.tiles
        .map((k, i) => (k.kind === t.kind ? i : -1))
        .filter((i) => i >= 0);
    const held = sameKind.filter((i) => ownerOf(state, i)?.owner === o.owner).length;
    if (t.kind === "railroad") return 25 * 2 ** (Math.max(1, held) - 1); // 25 / 50 / 100 / 200
    return diceTotal * (held >= 2 ? 10 : 4);
}

/**
 * Cash + each owned tile at its price (half if mortgaged) + buildings at full
 * house cost (a hotel counts as 5 houses).
 */
export function netWorth(board: BoardDef, state: GameState, seat: Seat): number {
    const p = state.players[seat];
    if (!p || p.bankrupt) return 0;
    let total = p.cash;
    for (const i of ownedTiles(state, seat)) {
        const t = ownableTile(board, i);
        const o = ownerOf(state, i);
        if (!t || !o) continue;
        total += o.mortgaged ? Math.floor(t.price / 2) : t.price;
        if (t.kind === "property") total += o.houses * t.houseCost;
    }
    return total;
}

// Trades: one pending offer at a time, validated on proposal and again on
// acceptance (the world may have changed in between), executed atomically.

import type { BoardDef } from "../boards/types";
import { heldJailDeck } from "./cards";
import type { GameState, Seat, Trade, TradeOffer } from "./types";
import { groupHasBuildings, isInt, log, money, mortgageInterest, ownableTile, ownerOf, tileName } from "./util";

function offerShapeError(o: unknown): string | null {
    if (!o || typeof o !== "object") return "Malformed trade offer.";
    const x = o as Partial<TradeOffer>;
    if (!isInt(x.cash) || x.cash < 0) return "Trade cash must be a whole, non-negative amount.";
    if (!isInt(x.jailCards) || x.jailCards < 0) return "Trade jail cards must be a whole, non-negative number.";
    if (!Array.isArray(x.tiles) || !x.tiles.every(isInt)) return "Malformed trade tiles.";
    return null;
}

function jailCardCount(s: GameState, seat: Seat): number {
    const c = s.players[seat].jailCards;
    return c.chance + c.chest;
}

/** One side can still deliver `offer`. */
function sideError(board: BoardDef, s: GameState, seat: Seat, offer: TradeOffer): string | null {
    const p = s.players[seat];
    for (const i of offer.tiles) {
        const t = ownableTile(board, i);
        if (!t) return `${tileName(board, i)} can't be traded.`;
        if (ownerOf(s, i)?.owner !== seat) return `${p.name} doesn't own ${t.name}.`;
        if (groupHasBuildings(board, s, i)) return `Sell the buildings in ${t.name}'s color group before trading it.`;
    }
    if (p.cash < offer.cash) return `${p.name} doesn't have ${money(board, offer.cash)}.`;
    if (jailCardCount(s, seat) < offer.jailCards) return `${p.name} doesn't have that many jail cards.`;
    return null;
}

export function validateTrade(board: BoardDef, s: GameState, from: Seat, to: Seat, give: unknown, get: unknown): string | null {
    const target = s.players[to];
    if (!isInt(to) || !target) return "No such player.";
    if (to === from) return "You can't trade with yourself.";
    if (target.bankrupt) return `${target.name} is bankrupt.`;
    const shape = offerShapeError(give) ?? offerShapeError(get);
    if (shape) return shape;
    const g = give as TradeOffer;
    const r = get as TradeOffer;
    const all = [...g.tiles, ...r.tiles];
    if (new Set(all).size !== all.length) return "A tile appears twice in the trade.";
    if (all.length === 0 && g.cash + r.cash + g.jailCards + r.jailCards === 0) return "The trade is empty.";
    return sideError(board, s, from, g) ?? sideError(board, s, to, r);
}

function interestOn(board: BoardDef, s: GameState, tiles: number[]): number {
    let sum = 0;
    for (const i of tiles) if (ownerOf(s, i)?.mortgaged) sum += mortgageInterest(ownableTile(board, i)!);
    return sum;
}

/** Re-validate and check both sides can cover the 10% interest on mortgaged tiles they receive. */
export function acceptError(board: BoardDef, s: GameState, t: Trade): string | null {
    const err = validateTrade(board, s, t.from, t.to, t.give, t.get);
    if (err) return err;
    const fromCash = s.players[t.from].cash - t.give.cash + t.get.cash - interestOn(board, s, t.get.tiles);
    const toCash = s.players[t.to].cash - t.get.cash + t.give.cash - interestOn(board, s, t.give.tiles);
    if (fromCash < 0) return `${s.players[t.from].name} can't cover the mortgage interest on the tiles received.`;
    if (toCash < 0) return `${s.players[t.to].name} can't cover the mortgage interest on the tiles received.`;
    return null;
}

function moveJailCards(s: GameState, from: Seat, to: Seat, n: number): void {
    for (let k = 0; k < n; k++) {
        const deck = heldJailDeck(s, from);
        if (!deck) return;
        s.players[from].jailCards[deck]--;
        s.players[to].jailCards[deck]++;
    }
}

function giveSide(board: BoardDef, s: GameState, from: Seat, to: Seat, offer: TradeOffer): void {
    s.players[from].cash -= offer.cash;
    s.players[to].cash += offer.cash;
    for (const i of offer.tiles) {
        const o = ownerOf(s, i)!;
        o.owner = to;
        // Mortgaged tiles move as-is; the receiver pays the 10% interest now.
        if (o.mortgaged) s.players[to].cash -= mortgageInterest(ownableTile(board, i)!);
    }
    moveJailCards(s, from, to, offer.jailCards);
}

export function executeTrade(board: BoardDef, s: GameState, t: Trade): void {
    giveSide(board, s, t.from, t.to, t.give);
    giveSide(board, s, t.to, t.from, t.get);
    s.pendingTrade = null;
    log(s, `${s.players[t.to].name} accepted ${s.players[t.from].name}'s trade: ${describe(board, s, t)}.`, "good", t.to);
}

export function describe(board: BoardDef, s: GameState, t: Trade): string {
    const side = (o: TradeOffer) => {
        const parts = o.tiles.map((i) => tileName(board, i));
        if (o.cash > 0) parts.push(money(board, o.cash));
        if (o.jailCards > 0) parts.push(`${o.jailCards} jail card${o.jailCards > 1 ? "s" : ""}`);
        return parts.length ? parts.join(", ") : "nothing";
    };
    return `${side(t.give)} for ${side(t.get)}`;
}

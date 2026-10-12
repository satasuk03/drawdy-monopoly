// Auctions for a declined tile. Round-robin among all active players starting
// after the decliner (who bids last). Passing drops you out for good.

import type { BoardDef } from "../boards/types";
import { toPostRoll } from "./turn";
import type { GameState, Seat } from "./types";
import { log, money, ownableTile, tileName, tr } from "./util";

export function startAuction(board: BoardDef, s: GameState, tile: number): void {
    const n = s.players.length;
    const bidders: Seat[] = [];
    for (let k = 1; k <= n; k++) {
        const seat = (s.current + k) % n;
        if (!s.players[seat].bankrupt) bidders.push(seat);
    }
    s.phase = { kind: "auction", auction: { tile, highBid: 0, highBidder: null, bidders, turn: 0 } };
    log(s, tr(board, "log.toAuction", { tile: tileName(board, tile) }), "info", s.current);
}

export function bidError(board: BoardDef, s: GameState, seat: Seat, amount: unknown): string | null {
    if (s.phase.kind !== "auction") return tr(board, "err.noAuction");
    const a = s.phase.auction;
    if (a.bidders[a.turn] !== seat) return tr(board, "err.notYourBid");
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) return tr(board, "err.bidWhole");
    if (amount <= a.highBid) return tr(board, "err.bidBeat");
    if (amount > s.players[seat].cash) return tr(board, "err.bidCash");
    return null;
}

export function placeBid(board: BoardDef, s: GameState, seat: Seat, amount: number): void {
    if (s.phase.kind !== "auction") return;
    const a = s.phase.auction;
    a.highBid = amount;
    a.highBidder = seat;
    a.turn = (a.turn + 1) % a.bidders.length;
    log(s, tr(board, "log.bid", { name: s.players[seat].name, amount: money(board, amount) }), "info", seat);
    resolveIfDone(board, s);
}

export function passBid(board: BoardDef, s: GameState, seat: Seat): void {
    if (s.phase.kind !== "auction") return;
    const a = s.phase.auction;
    const at = a.bidders.indexOf(seat);
    a.bidders.splice(at, 1);
    if (at < a.turn) a.turn--;
    if (a.turn >= a.bidders.length) a.turn = 0;
    log(s, tr(board, "log.passed", { name: s.players[seat].name }), "info", seat);
    resolveIfDone(board, s);
}

function resolveIfDone(board: BoardDef, s: GameState): void {
    if (s.phase.kind !== "auction") return;
    const a = s.phase.auction;
    if (a.bidders.length === 0) {
        log(s, tr(board, "log.noBids", { tile: tileName(board, a.tile) }), "info");
        return toPostRoll(s);
    }
    // Every bid sends the turn round the remaining bidders, so a lone remaining
    // bidder with a standing high bid is always the high bidder.
    if (a.bidders.length === 1 && a.highBidder !== null) {
        const winner = a.highBidder;
        const t = ownableTile(board, a.tile)!;
        s.players[winner].cash -= a.highBid;
        s.ownership[String(a.tile)] = { owner: winner, houses: 0, mortgaged: false };
        log(s, tr(board, "log.wonAuction", { name: s.players[winner].name, tile: t.name, amount: money(board, a.highBid) }), "good", winner);
        toPostRoll(s);
    }
}

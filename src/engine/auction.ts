// Auctions for a declined tile. Round-robin among all active players starting
// after the decliner (who bids last). Passing drops you out for good.

import type { BoardDef } from "../boards/types";
import { toPostRoll } from "./turn";
import type { GameState, Seat } from "./types";
import { log, money, ownableTile, tileName } from "./util";

export function startAuction(board: BoardDef, s: GameState, tile: number): void {
    const n = s.players.length;
    const bidders: Seat[] = [];
    for (let k = 1; k <= n; k++) {
        const seat = (s.current + k) % n;
        if (!s.players[seat].bankrupt) bidders.push(seat);
    }
    s.phase = { kind: "auction", auction: { tile, highBid: 0, highBidder: null, bidders, turn: 0 } };
    log(s, `${tileName(board, tile)} goes to auction.`, "info", s.current);
}

export function bidError(s: GameState, seat: Seat, amount: unknown): string | null {
    if (s.phase.kind !== "auction") return "There is no auction.";
    const a = s.phase.auction;
    if (a.bidders[a.turn] !== seat) return "It's not your turn to bid.";
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) return "Bid a whole amount of at least 1.";
    if (amount <= a.highBid) return "Your bid must beat the current high bid.";
    if (amount > s.players[seat].cash) return "You can't bid more cash than you have.";
    return null;
}

export function placeBid(board: BoardDef, s: GameState, seat: Seat, amount: number): void {
    if (s.phase.kind !== "auction") return;
    const a = s.phase.auction;
    a.highBid = amount;
    a.highBidder = seat;
    a.turn = (a.turn + 1) % a.bidders.length;
    log(s, `${s.players[seat].name} bid ${money(board, amount)}.`, "info", seat);
    resolveIfDone(board, s);
}

export function passBid(board: BoardDef, s: GameState, seat: Seat): void {
    if (s.phase.kind !== "auction") return;
    const a = s.phase.auction;
    const at = a.bidders.indexOf(seat);
    a.bidders.splice(at, 1);
    if (at < a.turn) a.turn--;
    if (a.turn >= a.bidders.length) a.turn = 0;
    log(s, `${s.players[seat].name} passed.`, "info", seat);
    resolveIfDone(board, s);
}

function resolveIfDone(board: BoardDef, s: GameState): void {
    if (s.phase.kind !== "auction") return;
    const a = s.phase.auction;
    if (a.bidders.length === 0) {
        log(s, `No bids — ${tileName(board, a.tile)} stays with the bank.`, "info");
        return toPostRoll(s);
    }
    // Every bid sends the turn round the remaining bidders, so a lone remaining
    // bidder with a standing high bid is always the high bidder.
    if (a.bidders.length === 1 && a.highBidder !== null) {
        const winner = a.highBidder;
        const t = ownableTile(board, a.tile)!;
        s.players[winner].cash -= a.highBid;
        s.ownership[String(a.tile)] = { owner: winner, houses: 0, mortgaged: false };
        log(s, `${s.players[winner].name} won ${t.name} for ${money(board, a.highBid)}.`, "good", winner);
        toPostRoll(s);
    }
}

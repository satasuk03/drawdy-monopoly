// Bankruptcy. Buildings are always sold back to the bank first (at half cost).
// To a player: that cash, all other cash, properties (still mortgaged) and
//   jail cards go to the creditor. The creditor pays the 10% interest on each
//   mortgaged tile now if they can afford it; otherwise it is waived.
// To the bank: everything returns to the bank. Properties become unowned and
//   unmortgaged (no auction — a simplification of the official rule), jail
//   cards go back to the bottom of their decks.

import type { BoardDef } from "../boards/types";
import { returnJailCard } from "./cards";
import type { GameState, Seat } from "./types";
import { halfHouseCost, log, money, mortgageInterest, ownableTile, ownedTiles, ownerOf, tr, type PropertyTile } from "./util";

export function goBankrupt(board: BoardDef, s: GameState, seat: Seat, creditor: Seat | null): void {
    const p = s.players[seat];
    const tiles = ownedTiles(s, seat);

    for (const i of tiles) {
        const o = ownerOf(s, i)!;
        if (o.houses === 0) continue;
        const half = halfHouseCost(board.tiles[i] as PropertyTile);
        if (o.houses === 5) s.hotelsLeft++;
        else s.housesLeft += o.houses;
        p.cash += half * o.houses;
        o.houses = 0;
    }

    if (creditor !== null) {
        const c = s.players[creditor];
        log(s, tr(board, "log.bankruptTo", { name: p.name, creditor: c.name, amount: money(board, p.cash) }), "bad", seat);
        c.cash += p.cash;
        for (const i of tiles) {
            const o = ownerOf(s, i)!;
            o.owner = creditor;
            if (!o.mortgaged) continue;
            const interest = mortgageInterest(ownableTile(board, i)!);
            if (c.cash >= interest) {
                c.cash -= interest;
                log(s, tr(board, "log.paidInterest", { name: c.name, amount: money(board, interest), tile: board.tiles[i].name }), "info", creditor);
            } else {
                log(s, tr(board, "log.interestWaived", { tile: board.tiles[i].name }), "info", creditor);
            }
        }
        c.jailCards.chance += p.jailCards.chance;
        c.jailCards.chest += p.jailCards.chest;
    } else {
        log(s, tr(board, "log.bankruptBank", { name: p.name }), "bad", seat);
        for (const i of tiles) delete s.ownership[String(i)];
        for (let k = 0; k < p.jailCards.chance; k++) returnJailCard(board, s, "chance");
        for (let k = 0; k < p.jailCards.chest; k++) returnJailCard(board, s, "chest");
    }

    p.cash = 0;
    p.jailCards = { chance: 0, chest: 0 };
    p.inJail = false;
    p.jailTurns = 0;
    p.bankrupt = true;
    if (s.pendingTrade && (s.pendingTrade.from === seat || s.pendingTrade.to === seat)) s.pendingTrade = null;
}

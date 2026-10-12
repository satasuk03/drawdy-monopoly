// Houses, hotels and mortgages. Each rule has an *Error check (null = allowed)
// shared by applyAction and seatView, and a do* that assumes the check passed.
// houses: 0–4, 5 = hotel.

import type { BoardDef } from "../boards/types";
import type { GameState, Seat } from "./types";
import {
    groupHasBuildings,
    groupTiles,
    halfHouseCost,
    log,
    money,
    mortgageInterest,
    mortgageValue,
    ownableTile,
    ownerOf,
    ownsGroup,
    tr,
    type PropertyTile,
} from "./util";

function ownedProperty(board: BoardDef, s: GameState, seat: Seat, tile: number): PropertyTile | string {
    const t = ownableTile(board, tile);
    if (!t) return tr(board, "err.notOwnable");
    if (ownerOf(s, tile)?.owner !== seat) return tr(board, "err.notOwner", { tile: t.name });
    if (t.kind !== "property") return tr(board, "err.cantBuildOn", { tile: t.name });
    return t;
}

function groupHouses(board: BoardDef, s: GameState, t: PropertyTile, except: number): number[] {
    return groupTiles(board, t.group)
        .filter((i) => i !== except)
        .map((i) => ownerOf(s, i)?.houses ?? 0);
}

export function buildError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownedProperty(board, s, seat, tile);
    if (typeof t === "string") return t;
    if (!ownsGroup(board, s, seat, t.group)) return tr(board, "err.needGroup");
    if (groupTiles(board, t.group).some((i) => ownerOf(s, i)!.mortgaged)) return tr(board, "err.unmortgageGroupFirst");
    const h = ownerOf(s, tile)!.houses;
    if (h >= 5) return tr(board, "err.hasHotel", { tile: t.name });
    if (s.settings.evenBuild && groupHouses(board, s, t, tile).some((x) => x < h))
        return tr(board, "err.buildEvenly");
    if (h === 4 && s.hotelsLeft < 1) return tr(board, "err.noHotelsLeft");
    if (h < 4 && s.housesLeft < 1) return tr(board, "err.noHousesLeft");
    if (s.players[seat].cash < t.houseCost) return tr(board, "err.buildCosts", { amount: money(board, t.houseCost) });
    return null;
}

export function doBuild(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const t = board.tiles[tile] as PropertyTile;
    const o = ownerOf(s, tile)!;
    s.players[seat].cash -= t.houseCost;
    if (o.houses === 4) {
        // Hotel: the four houses go back to the bank.
        s.hotelsLeft--;
        s.housesLeft += 4;
    } else {
        s.housesLeft--;
    }
    o.houses++;
    const what = o.houses === 5 ? board.labels.hotel : board.labels.house;
    log(s, tr(board, "log.built", { name: s.players[seat].name, what: what.toLowerCase(), tile: t.name, amount: money(board, t.houseCost) }), "info", seat);
}

export function sellError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownedProperty(board, s, seat, tile);
    if (typeof t === "string") return t;
    const h = ownerOf(s, tile)!.houses;
    if (h === 0) return tr(board, "err.noBuildings", { tile: t.name });
    const others = groupHouses(board, s, t, tile);
    if (s.settings.evenBuild && others.some((x) => x > h)) return tr(board, "err.sellEvenly");
    if (h === 5 && s.housesLeft < 4) {
        // The bank can't break the hotel into 4 houses, so it can only be sold outright.
        if (s.settings.evenBuild && others.some((x) => x > 1))
            return tr(board, "err.hotelBreakdown", { count: s.housesLeft });
    }
    return null;
}

export function doSell(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const t = board.tiles[tile] as PropertyTile;
    const o = ownerOf(s, tile)!;
    const half = halfHouseCost(t);
    let refund = half;
    if (o.houses === 5 && s.housesLeft < 4) {
        refund = half * 5;
        o.houses = 0;
        s.hotelsLeft++;
        log(s, tr(board, "log.soldHotelOutright", { name: s.players[seat].name, what: board.labels.hotel.toLowerCase(), tile: t.name, amount: money(board, refund) }), "info", seat);
    } else if (o.houses === 5) {
        o.houses = 4;
        s.hotelsLeft++;
        s.housesLeft -= 4;
        log(s, tr(board, "log.soldHotel", { name: s.players[seat].name, what: board.labels.hotel.toLowerCase(), tile: t.name, amount: money(board, refund) }), "info", seat);
    } else {
        o.houses--;
        s.housesLeft++;
        log(s, tr(board, "log.soldHouse", { name: s.players[seat].name, what: board.labels.house.toLowerCase(), tile: t.name, amount: money(board, refund) }), "info", seat);
    }
    s.players[seat].cash += refund;
}

export function mortgageError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownableTile(board, tile);
    const o = ownerOf(s, tile);
    if (!t) return tr(board, "err.notOwnable");
    if (!o || o.owner !== seat) return tr(board, "err.notOwner", { tile: t.name });
    if (o.mortgaged) return tr(board, "err.alreadyMortgaged", { tile: t.name });
    if (groupHasBuildings(board, s, tile)) return tr(board, "err.sellGroupBuildingsFirst");
    return null;
}

export function doMortgage(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const t = ownableTile(board, tile)!;
    ownerOf(s, tile)!.mortgaged = true;
    s.players[seat].cash += mortgageValue(t);
    log(s, tr(board, "log.mortgaged", { name: s.players[seat].name, tile: t.name, amount: money(board, mortgageValue(t)) }), "info", seat);
}

export function unmortgageCost(board: BoardDef, tile: number): number {
    const t = ownableTile(board, tile);
    return t ? mortgageValue(t) + mortgageInterest(t) : 0;
}

export function unmortgageError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownableTile(board, tile);
    const o = ownerOf(s, tile);
    if (!t) return tr(board, "err.notOwnable");
    if (!o || o.owner !== seat) return tr(board, "err.notOwner", { tile: t.name });
    if (!o.mortgaged) return tr(board, "err.notMortgaged", { tile: t.name });
    const cost = unmortgageCost(board, tile);
    if (s.players[seat].cash < cost) return tr(board, "err.unmortgageCosts", { amount: money(board, cost) });
    return null;
}

export function doUnmortgage(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const cost = unmortgageCost(board, tile);
    ownerOf(s, tile)!.mortgaged = false;
    s.players[seat].cash -= cost;
    log(s, tr(board, "log.unmortgaged", { name: s.players[seat].name, amount: money(board, cost), tile: board.tiles[tile].name }), "info", seat);
}

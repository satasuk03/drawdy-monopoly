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
    type PropertyTile,
} from "./util";

function ownedProperty(board: BoardDef, s: GameState, seat: Seat, tile: number): PropertyTile | string {
    const t = ownableTile(board, tile);
    if (!t) return "That tile can't be owned.";
    if (ownerOf(s, tile)?.owner !== seat) return `You don't own ${t.name}.`;
    if (t.kind !== "property") return `You can't build on ${t.name}.`;
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
    if (!ownsGroup(board, s, seat, t.group)) return "You need the whole color group to build.";
    if (groupTiles(board, t.group).some((i) => ownerOf(s, i)!.mortgaged)) return "Unmortgage the whole group before building.";
    const h = ownerOf(s, tile)!.houses;
    if (h >= 5) return `${t.name} already has a hotel.`;
    if (s.settings.evenBuild && groupHouses(board, s, t, tile).some((x) => x < h))
        return "Build evenly: add to the other properties in this group first.";
    if (h === 4 && s.hotelsLeft < 1) return "The bank has no hotels left.";
    if (h < 4 && s.housesLeft < 1) return "The bank has no houses left.";
    if (s.players[seat].cash < t.houseCost) return `Building costs ${money(board, t.houseCost)}.`;
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
    log(s, `${s.players[seat].name} built a ${what.toLowerCase()} on ${t.name} for ${money(board, t.houseCost)}.`, "info", seat);
}

export function sellError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownedProperty(board, s, seat, tile);
    if (typeof t === "string") return t;
    const h = ownerOf(s, tile)!.houses;
    if (h === 0) return `${t.name} has no buildings.`;
    const others = groupHouses(board, s, t, tile);
    if (s.settings.evenBuild && others.some((x) => x > h)) return "Sell evenly: sell from the other properties in this group first.";
    if (h === 5 && s.housesLeft < 4) {
        // The bank can't break the hotel into 4 houses, so it can only be sold outright.
        if (s.settings.evenBuild && others.some((x) => x > 1))
            return `The bank has only ${s.housesLeft} houses, so this hotel can't be broken down to 4 houses, and selling it outright would break the even-build rule.`;
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
        log(s, `${s.players[seat].name} sold the ${board.labels.hotel.toLowerCase()} on ${t.name} outright for ${money(board, refund)} (house shortage).`, "info", seat);
    } else if (o.houses === 5) {
        o.houses = 4;
        s.hotelsLeft++;
        s.housesLeft -= 4;
        log(s, `${s.players[seat].name} sold the ${board.labels.hotel.toLowerCase()} on ${t.name} for ${money(board, refund)}.`, "info", seat);
    } else {
        o.houses--;
        s.housesLeft++;
        log(s, `${s.players[seat].name} sold a ${board.labels.house.toLowerCase()} on ${t.name} for ${money(board, refund)}.`, "info", seat);
    }
    s.players[seat].cash += refund;
}

export function mortgageError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownableTile(board, tile);
    const o = ownerOf(s, tile);
    if (!t) return "That tile can't be owned.";
    if (!o || o.owner !== seat) return `You don't own ${t.name}.`;
    if (o.mortgaged) return `${t.name} is already mortgaged.`;
    if (groupHasBuildings(board, s, tile)) return "Sell all buildings in this color group first.";
    return null;
}

export function doMortgage(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const t = ownableTile(board, tile)!;
    ownerOf(s, tile)!.mortgaged = true;
    s.players[seat].cash += mortgageValue(t);
    log(s, `${s.players[seat].name} mortgaged ${t.name} for ${money(board, mortgageValue(t))}.`, "info", seat);
}

export function unmortgageCost(board: BoardDef, tile: number): number {
    const t = ownableTile(board, tile);
    return t ? mortgageValue(t) + mortgageInterest(t) : 0;
}

export function unmortgageError(board: BoardDef, s: GameState, seat: Seat, tile: number): string | null {
    const t = ownableTile(board, tile);
    const o = ownerOf(s, tile);
    if (!t) return "That tile can't be owned.";
    if (!o || o.owner !== seat) return `You don't own ${t.name}.`;
    if (!o.mortgaged) return `${t.name} isn't mortgaged.`;
    const cost = unmortgageCost(board, tile);
    if (s.players[seat].cash < cost) return `Unmortgaging costs ${money(board, cost)}.`;
    return null;
}

export function doUnmortgage(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const cost = unmortgageCost(board, tile);
    ownerOf(s, tile)!.mortgaged = false;
    s.players[seat].cash -= cost;
    log(s, `${s.players[seat].name} paid ${money(board, cost)} to unmortgage ${board.tiles[tile].name}.`, "info", seat);
}

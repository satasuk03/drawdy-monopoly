// Rolling, moving, and resolving the tile landed on (rent, tax, cards, jail).
// Everything here runs inside the "roll" action, so the state that comes out
// is already "landed": in buy-decision, debt, or post-roll.

import type { BoardDef } from "../boards/types";
import { formatCardText } from "../boards/types";
import { drawCard, type DeckName } from "./cards";
import { settle, type Charge } from "./money";
import { rentFor } from "./rent";
import { rollDice } from "./rng";
import { toPostRoll } from "./turn";
import type { GameState, Seat } from "./types";
import { activeSeats, current, jailIndex, log, money, ownableTile, ownedTiles, ownerOf, tileName } from "./util";

type LandingMod = { nearest?: "railroad" | "utility" };

/** Roll for the current player (normal roll, roll-again, or a jail attempt). */
export function doRoll(board: BoardDef, s: GameState): void {
    const seat = s.current;
    const p = current(s);
    const [d1, d2] = rollDice(s);
    s.dice = [d1, d2];
    const doubles = d1 === d2;
    log(s, `${p.name} rolled ${d1} + ${d2}${doubles ? " (doubles)" : ""}`, "dice", seat);

    if (p.inJail) {
        if (doubles) {
            // Leaves jail and moves, but never rolls again for these doubles.
            releaseFromJail(s, seat);
            s.doublesCount = 0;
            log(s, `${p.name} rolled doubles and leaves ${tileName(board, jailIndex(board))}.`, "good", seat);
            return moveAndLand(board, s, seat, d1 + d2);
        }
        p.jailTurns++;
        if (p.jailTurns < 3) {
            log(s, `${p.name} stays in jail.`, "info", seat);
            return toPostRoll(s);
        }
        // Third failure: the fine is forced, then the player moves by this roll.
        releaseFromJail(s, seat);
        const fine: Charge = {
            debtor: seat,
            creditor: null,
            amount: s.settings.jailFine,
            text: `${p.name} paid the ${money(board, s.settings.jailFine)} jail fine after three tries.`,
        };
        // If the fine can't be covered, the player is out of jail but in debt;
        // once paid they roll afresh from the jail tile (this roll is discarded).
        if (settle(board, s, [fine], "pre-roll")) moveAndLand(board, s, seat, d1 + d2);
        return;
    }

    if (doubles) {
        s.doublesCount++;
        if (s.doublesCount >= 3) {
            log(s, `${p.name} rolled doubles three times in a row.`, "bad", seat);
            sendToJail(board, s, seat);
            return toPostRoll(s);
        }
    } else {
        s.doublesCount = 0;
    }
    moveAndLand(board, s, seat, d1 + d2);
}

function moveAndLand(board: BoardDef, s: GameState, seat: Seat, steps: number): void {
    advance(board, s, seat, steps);
    land(board, s, seat, {});
}

export function releaseFromJail(s: GameState, seat: Seat): void {
    const p = s.players[seat];
    p.inJail = false;
    p.jailTurns = 0;
}

export function sendToJail(board: BoardDef, s: GameState, seat: Seat): void {
    const p = s.players[seat];
    p.position = jailIndex(board);
    p.inJail = true;
    p.jailTurns = 0;
    if (seat === s.current) s.doublesCount = 0;
    log(s, `${p.name} landed in jail.`, "bad", seat);
}

/** Move by `steps`; forward moves that pass or land on GO pay salary. */
function advance(board: BoardDef, s: GameState, seat: Seat, steps: number): void {
    const n = board.tiles.length;
    const p = s.players[seat];
    const raw = p.position + steps;
    p.position = ((raw % n) + n) % n;
    if (steps > 0 && raw >= n) {
        const onGo = p.position === 0;
        const pay = onGo && s.settings.doubleSalaryOnGo ? s.settings.salary * 2 : s.settings.salary;
        p.cash += pay;
        log(s, `${p.name} ${onGo ? "landed on" : "passed"} ${tileName(board, 0)} and collected ${money(board, pay)}.`, "good", seat);
    }
}

function moveTo(board: BoardDef, s: GameState, seat: Seat, tile: number): void {
    const n = board.tiles.length;
    advance(board, s, seat, (tile - s.players[seat].position + n) % n);
}

function land(board: BoardDef, s: GameState, seat: Seat, mod: LandingMod): void {
    const p = s.players[seat];
    const tile = board.tiles[p.position];
    log(s, `${p.name} landed on ${tile.name}.`, "info", seat);
    switch (tile.kind) {
        case "property":
        case "railroad":
        case "utility":
            return landOnOwnable(board, s, seat, mod);
        case "tax": {
            const charge: Charge = {
                debtor: seat,
                creditor: null,
                amount: tile.amount,
                text: `${p.name} paid ${money(board, tile.amount)} ${tile.name}.`,
            };
            if (settle(board, s, [charge], "post-roll")) toPostRoll(s);
            return;
        }
        case "chance":
        case "chest":
            return resolveCard(board, s, seat, tile.kind);
        case "go-to-jail":
            sendToJail(board, s, seat);
            return toPostRoll(s);
        case "free-parking":
            if (s.settings.freeParkingJackpot && s.jackpot > 0) {
                log(s, `${p.name} collected the ${money(board, s.jackpot)} jackpot!`, "good", seat);
                p.cash += s.jackpot;
                s.jackpot = 0;
            }
            return toPostRoll(s);
        default:
            return toPostRoll(s);
    }
}

function landOnOwnable(board: BoardDef, s: GameState, seat: Seat, mod: LandingMod): void {
    const i = s.players[seat].position;
    const t = ownableTile(board, i)!;
    const o = ownerOf(s, i);
    const p = s.players[seat];
    if (!o) {
        s.phase = { kind: "buy-decision", tile: i };
        return;
    }
    if (o.owner === seat) return toPostRoll(s);
    const owner = s.players[o.owner];
    if (o.mortgaged) {
        log(s, `${t.name} is mortgaged — no rent.`, "info", seat);
        return toPostRoll(s);
    }
    if (owner.inJail && !s.settings.rentInJail) {
        log(s, `${owner.name} is in jail — no rent.`, "info", seat);
        return toPostRoll(s);
    }
    let rent: number;
    if (mod.nearest === "utility" && t.kind === "utility") {
        const [a, b] = rollDice(s);
        log(s, `${p.name} rolled ${a} + ${b} for the utility rent (10×).`, "dice", seat);
        rent = 10 * (a + b);
    } else {
        const dice = s.dice ? s.dice[0] + s.dice[1] : 0;
        rent = rentFor(board, s, i, dice) * (mod.nearest === "railroad" && t.kind === "railroad" ? 2 : 1);
    }
    const charge: Charge = {
        debtor: seat,
        creditor: o.owner,
        amount: rent,
        text: `${p.name} paid ${money(board, rent)} rent to ${owner.name} for ${t.name}.`,
    };
    if (settle(board, s, [charge], "post-roll")) toPostRoll(s);
}

function resolveCard(board: BoardDef, s: GameState, seat: Seat, deck: DeckName): void {
    const p = s.players[seat];
    const idx = drawCard(board, s, deck);
    const card = board[deck][idx];
    if (!card) return toPostRoll(s);
    log(s, `${p.name} drew ${board.labels[deck]}: ${formatCardText(board, card.text)}`, "card", seat);
    const e = card.effect;
    const others = activeSeats(s).filter((x) => x !== seat);
    switch (e.kind) {
        case "move-to":
            moveTo(board, s, seat, e.tile);
            return land(board, s, seat, {});
        case "move-to-nearest": {
            const n = board.tiles.length;
            for (let k = 1; k <= n; k++) {
                const j = (p.position + k) % n;
                if (board.tiles[j].kind === e.target) {
                    moveTo(board, s, seat, j);
                    return land(board, s, seat, { nearest: e.target });
                }
            }
            return toPostRoll(s);
        }
        case "move-by":
            advance(board, s, seat, e.steps);
            return land(board, s, seat, {});
        case "collect":
            p.cash += e.amount;
            return toPostRoll(s);
        case "pay":
            if (settle(board, s, [{ debtor: seat, creditor: null, amount: e.amount }], "post-roll")) toPostRoll(s);
            return;
        case "collect-from-each": {
            const charges = others.map((o) => ({ debtor: o, creditor: seat, amount: e.amount }));
            if (settle(board, s, charges, "post-roll")) toPostRoll(s);
            return;
        }
        case "pay-each": {
            const charges = others.map((o) => ({ debtor: seat, creditor: o, amount: e.amount }));
            if (settle(board, s, charges, "post-roll")) toPostRoll(s);
            return;
        }
        case "repairs": {
            let houses = 0;
            let hotels = 0;
            for (const i of ownedTiles(s, seat)) {
                const h = ownerOf(s, i)!.houses;
                if (h === 5) hotels++;
                else houses += h;
            }
            const amount = houses * e.perHouse + hotels * e.perHotel;
            if (amount === 0) {
                log(s, `${p.name} has no buildings to repair.`, "info", seat);
                return toPostRoll(s);
            }
            if (settle(board, s, [{ debtor: seat, creditor: null, amount }], "post-roll")) toPostRoll(s);
            return;
        }
        case "go-to-jail":
            sendToJail(board, s, seat);
            return toPostRoll(s);
        case "jail-free":
            p.jailCards[deck]++;
            return toPostRoll(s);
    }
}

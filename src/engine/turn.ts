// Turn flow: where play goes after a move, a debt, or an end-turn.

import type { BoardDef } from "../boards/types";
import { netWorth } from "./rent";
import type { GameState, Seat } from "./types";
import { activeSeats, current, log, money } from "./util";

/**
 * The current player rolls again iff their last normal roll this turn was
 * doubles. doublesCount is reset by non-doubles, by jail, and by doubles
 * rolled to get out of jail (those never grant another roll).
 */
export function rollAgain(s: GameState): boolean {
    const p = current(s);
    return s.doublesCount > 0 && !p.inJail && !p.bankrupt;
}

/** Movement for this roll is finished. */
export function toPostRoll(s: GameState): void {
    s.phase = { kind: "post-roll", rollAgain: rollAgain(s) };
}

/** Continue the current player's turn after a debt/bankruptcy was resolved. */
export function resumeTurn(board: BoardDef, s: GameState, resume: "pre-roll" | "post-roll"): void {
    if (current(s).bankrupt) return nextTurn(board, s);
    if (resume === "pre-roll") s.phase = { kind: "pre-roll" };
    else toPostRoll(s);
}

/** Pass play to the next non-bankrupt seat; a wrap to a lower seat completes a round. */
export function nextTurn(board: BoardDef, s: GameState): void {
    const n = s.players.length;
    let next = s.current;
    for (let k = 1; k <= n; k++) {
        const j = (s.current + k) % n;
        if (!s.players[j].bankrupt) {
            next = j;
            break;
        }
    }
    if (next <= s.current) s.round++;
    s.current = next;
    s.doublesCount = 0;
    if (s.settings.roundLimit > 0 && s.round >= s.settings.roundLimit) {
        log(s, `Round limit of ${s.settings.roundLimit} reached.`, "info");
        return finishGame(board, s, "round-limit");
    }
    s.phase = { kind: "pre-roll" };
    log(s, `${current(s).name}'s turn.`, "info", next);
}

/** Highest net worth among active players; ties go to the lower seat. */
export function leader(board: BoardDef, s: GameState): Seat | null {
    let best: Seat | null = null;
    let bestWorth = -1;
    for (const seat of activeSeats(s)) {
        const w = netWorth(board, s, seat);
        if (w > bestWorth) {
            best = seat;
            bestWorth = w;
        }
    }
    return best;
}

export function finishGame(board: BoardDef, s: GameState, reason: "last-standing" | "round-limit" | "ended"): void {
    const winner = reason === "last-standing" ? (activeSeats(s)[0] ?? null) : leader(board, s);
    s.phase = { kind: "game-over", winner, reason };
    s.pendingTrade = null;
    if (winner === null) log(s, "The game is over.", "info");
    else
        log(
            s,
            `Game over — ${s.players[winner].name} wins with a net worth of ${money(board, netWorth(board, s, winner))}.`,
            "good",
            winner,
        );
}

/** Ends the game if only one player is left. Returns true if it did. */
export function checkLastStanding(board: BoardDef, s: GameState): boolean {
    if (activeSeats(s).length > 1) return false;
    finishGame(board, s, "last-standing");
    return true;
}

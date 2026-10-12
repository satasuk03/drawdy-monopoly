// Payments that can fail. A payment the debtor can't cover in full is never
// partially taken: it becomes a Debt and the game enters the "debt" phase.
//
// Payments to the bank that go through here are always taxes, card fines or
// jail fines, so with freeParkingJackpot on they go into the jackpot instead.

import type { BoardDef } from "../boards/types";
import { resumeTurn } from "./turn";
import type { Debt, GameState } from "./types";
import { log, money, playerName } from "./util";

export type Charge = Debt & {
    /** Log line when paid on the spot; a generic one is used otherwise. */
    text?: string;
};

/** Move `amount` from the debtor to the creditor (or bank / jackpot). Caller checked cash. */
function transfer(s: GameState, d: Debt): void {
    s.players[d.debtor].cash -= d.amount;
    if (d.creditor !== null) s.players[d.creditor].cash += d.amount;
    else if (s.settings.freeParkingJackpot) s.jackpot += d.amount;
}

function creditorLabel(s: GameState, creditor: number | null): string {
    if (creditor !== null) return playerName(s, creditor);
    return s.settings.freeParkingJackpot ? "the jackpot" : "the bank";
}

export function payText(board: BoardDef, s: GameState, d: Debt): string {
    return `${playerName(s, d.debtor)} paid ${money(board, d.amount)} to ${creditorLabel(s, d.creditor)}.`;
}

/**
 * Pay charges in order. A charge is deferred if its debtor can't afford it or
 * already has a deferred charge (so one debtor's debts stay in order).
 * Returns true if everything was paid; otherwise the first deferred charge
 * becomes the debt phase (the rest queue behind it) and false is returned.
 */
export function settle(board: BoardDef, s: GameState, charges: Charge[], resume: "pre-roll" | "post-roll"): boolean {
    const deferred: Debt[] = [];
    for (const c of charges) {
        const debtor = s.players[c.debtor];
        if (c.amount <= 0 || debtor.bankrupt) continue;
        if (c.creditor !== null && s.players[c.creditor].bankrupt) continue;
        const d: Debt = { debtor: c.debtor, creditor: c.creditor, amount: c.amount };
        if (debtor.cash >= c.amount && !deferred.some((x) => x.debtor === c.debtor)) {
            transfer(s, d);
            log(s, c.text ?? payText(board, s, d), "bad", c.debtor);
        } else {
            deferred.push(d);
        }
    }
    if (deferred.length === 0) return true;
    enterDebt(board, s, deferred, resume);
    return false;
}

function enterDebt(board: BoardDef, s: GameState, debts: Debt[], resume: "pre-roll" | "post-roll"): void {
    const [debt, ...queue] = debts;
    const p = s.players[debt.debtor];
    log(
        s,
        `${p.name} owes ${money(board, debt.amount)} to ${creditorLabel(s, debt.creditor)} but has only ${money(board, p.cash)}. Raise cash or declare bankruptcy.`,
        "bad",
        debt.debtor,
    );
    s.phase = queue.length > 0 ? { kind: "debt", debt, resume, queue } : { kind: "debt", debt, resume };
}

/** The head debt is affordable: pay it, then settle the queue and resume the turn. */
export function payDebt(board: BoardDef, s: GameState): void {
    if (s.phase.kind !== "debt") return;
    const { debt, resume, queue } = s.phase;
    transfer(s, debt);
    log(s, payText(board, s, debt), "info", debt.debtor);
    continueAfterDebt(board, s, queue ?? [], resume);
}

/** Settle whatever is still queued; when nothing is owed, resume the current player's turn. */
export function continueAfterDebt(board: BoardDef, s: GameState, queue: Debt[], resume: "pre-roll" | "post-roll"): void {
    if (settle(board, s, queue, resume)) resumeTurn(board, s, resume);
}

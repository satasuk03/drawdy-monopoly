// Public engine API. Pure: (board, state, action, actor) -> new state.
// applyAction never mutates its input and never throws for a bad action.

import type { BoardDef } from "../boards/types";
import { canProposeTrade, checkAction, needsToAct, runAction } from "./actions";
import { createGame } from "./lobby";
import { netWorth, rentFor } from "./rent";
import type { Action, ActionType, Actor, ApplyResult, GameState, Seat, SeatView } from "./types";
import { clone } from "./util";

export { createGame, needsToAct, netWorth, rentFor };

export function applyAction(board: BoardDef, state: GameState, action: Action, actor: Actor): ApplyResult {
    let error: string | null;
    try {
        error = checkAction(board, state, action, actor);
    } catch {
        error = "Malformed action.";
    }
    if (error) return { ok: false, error };
    const draft = clone(state);
    runAction(board, draft, action);
    return { ok: true, state: draft };
}

export function seatView(board: BoardDef, state: GameState, seat: Seat): SeatView {
    const p = state.players[seat];
    const view: SeatView = {
        seat,
        netWorth: netWorth(board, state, seat),
        legal: [],
        buildable: [],
        sellable: [],
        mortgageable: [],
        unmortgageable: [],
    };
    if (!p) return view;
    const actor: Actor = { userId: p.userId, isCreator: p.userId === state.creatorUserId };
    const ok = (a: Action) => checkAction(board, state, a, actor) === null;

    const tiles = board.tiles.map((_, i) => i);
    const tileOk = (type: "build" | "sell-building" | "mortgage" | "unmortgage") =>
        tiles.filter((tile) => ok({ type, seat, tile }));
    view.buildable = tileOk("build");
    view.sellable = tileOk("sell-building");
    view.mortgageable = tileOk("mortgage");
    view.unmortgageable = tileOk("unmortgage");

    const legal = new Set<ActionType>();
    const simple = [
        "leave",
        "roll",
        "buy",
        "decline",
        "pass-bid",
        "pay-jail-fine",
        "use-jail-card",
        "end-turn",
        "pay-debt",
        "declare-bankruptcy",
    ] as const;
    for (const type of simple) if (ok({ type, seat })) legal.add(type);
    if (ok({ type: "update-settings", settings: {} })) legal.add("update-settings");
    if (ok({ type: "start" })) legal.add("start");
    if (state.phase.kind === "auction" && ok({ type: "bid", seat, amount: state.phase.auction.highBid + 1 })) legal.add("bid");
    if (view.buildable.length) legal.add("build");
    if (view.sellable.length) legal.add("sell-building");
    if (view.mortgageable.length) legal.add("mortgage");
    if (view.unmortgageable.length) legal.add("unmortgage");
    if (canProposeTrade(state, seat)) legal.add("propose-trade");
    const t = state.pendingTrade;
    if (t) {
        for (const type of ["accept-trade", "reject-trade", "cancel-trade"] as const)
            if (ok({ type, seat, tradeId: t.id })) legal.add(type);
    }
    if (needsToAct(state).some((target) => ok({ type: "force-skip", seat: target }))) legal.add("force-skip");
    if (ok({ type: "end-game" })) legal.add("end-game");
    view.legal = [...legal];
    return view;
}

// The reducer, split in two: checkAction validates against the read-only
// state (null = legal), runAction mutates a private draft and may assume the
// check passed. seatView reuses checkAction to list legal actions.

import type { BoardDef } from "../boards/types";
import { bidError, passBid, placeBid, startAuction } from "./auction";
import { goBankrupt } from "./bankruptcy";
import {
    buildError,
    doBuild,
    doMortgage,
    doSell,
    doUnmortgage,
    mortgageError,
    sellError,
    unmortgageError,
} from "./building";
import { heldJailDeck, returnJailCard } from "./cards";
import { doJoin, doLeave, doStart, joinError, mergeSettings } from "./lobby";
import { continueAfterDebt, payDebt, settle } from "./money";
import { doRoll, releaseFromJail } from "./movement";
import { acceptError, describe, executeTrade, validateTrade } from "./trade";
import { checkLastStanding, finishGame, nextTurn, resumeTurn, toPostRoll } from "./turn";
import type { Action, Actor, GameState, Seat } from "./types";
import { isInt, log, money, ownableTile } from "./util";

/** Seats whose input the game is waiting on. */
export function needsToAct(state: GameState): Seat[] {
    const ph = state.phase;
    if (ph.kind === "lobby" || ph.kind === "game-over") return [];
    if (state.pendingTrade) {
        const { from, to } = state.pendingTrade;
        return from === to ? [from] : [from, to];
    }
    switch (ph.kind) {
        case "auction":
            return [ph.auction.bidders[ph.auction.turn]];
        case "debt":
            return [ph.debt.debtor];
        default:
            return [state.current];
    }
}

/** Gate for build / sell / mortgage / unmortgage. Debtors may only raise cash. */
function assetGate(s: GameState, seat: Seat, raisesCash: boolean): string | null {
    const ph = s.phase;
    if ((ph.kind === "pre-roll" || ph.kind === "post-roll") && seat === s.current) return null;
    if (ph.kind === "debt" && ph.debt.debtor === seat) return raisesCash ? null : "Pay off your debt first.";
    return "You can't manage property right now.";
}

function tradeGate(s: GameState, seat: Seat): string | null {
    const ph = s.phase;
    if ((ph.kind === "pre-roll" || ph.kind === "post-roll") && seat === s.current) return null;
    if (ph.kind === "debt" && ph.debt.debtor === seat) return null;
    return "You can only propose trades on your own turn.";
}

/** propose-trade is possible for `seat` with some other active player (ignoring the offer's contents). */
export function canProposeTrade(s: GameState, seat: Seat): boolean {
    const p = s.players[seat];
    if (!p || p.bankrupt || s.pendingTrade || s.phase.kind === "lobby" || s.phase.kind === "game-over") return false;
    return tradeGate(s, seat) === null && s.players.some((q) => q.seat !== seat && !q.bankrupt);
}

function tileArg(board: BoardDef, tile: unknown): string | null {
    return isInt(tile) && tile >= 0 && tile < board.tiles.length ? null : "No such tile.";
}

/** Actions allowed while a trade offer is waiting for an answer. */
const DURING_TRADE = new Set(["accept-trade", "reject-trade", "cancel-trade", "force-skip", "end-game"]);
const LOBBY = new Set(["join", "leave", "update-settings", "start", "end-game"]);

export function checkAction(board: BoardDef, s: GameState, a: Action, actor: Actor): string | null {
    if (!a || typeof a !== "object" || typeof a.type !== "string") return "Malformed action.";
    const ph = s.phase;
    if (ph.kind === "game-over") return "The game is over.";
    if (ph.kind === "lobby" && !LOBBY.has(a.type)) return "The game hasn't started yet.";
    if (ph.kind !== "lobby" && (a.type === "join" || a.type === "leave" || a.type === "update-settings" || a.type === "start"))
        return "The game has already started.";

    // Every seat-bearing action must come from the user controlling that seat
    // (force-skip names the seat being skipped, so it is creator-gated instead).
    let seat: Seat = -1;
    if ("seat" in a) {
        seat = a.seat;
        const p = isInt(seat) ? s.players[seat] : undefined;
        if (!p) return "No such seat.";
        if (a.type !== "force-skip") {
            if (p.userId !== actor.userId) return "That seat isn't yours.";
            if (p.bankrupt) return "You are bankrupt.";
        }
    }
    if (s.pendingTrade && !DURING_TRADE.has(a.type)) return "Waiting for the trade offer to be answered.";
    const p = s.players[seat];

    switch (a.type) {
        case "join":
            return joinError(board, s, a, actor.userId);
        case "leave":
            return null;
        case "update-settings": {
            if (!actor.isCreator) return "Only the game creator can change settings.";
            const m = mergeSettings(s.settings, a.settings);
            return typeof m === "string" ? m : null;
        }
        case "start":
            if (!actor.isCreator) return "Only the game creator can start the game.";
            return s.players.length >= 2 ? null : "At least 2 players are needed.";

        case "roll":
            if (seat !== s.current) return "It's not your turn.";
            if (ph.kind === "pre-roll" || (ph.kind === "post-roll" && ph.rollAgain)) return null;
            return "You can't roll now.";
        case "buy": {
            if (ph.kind !== "buy-decision" || seat !== s.current) return "There is nothing to buy.";
            const t = ownableTile(board, ph.tile)!;
            return p.cash >= t.price ? null : `${t.name} costs ${money(board, t.price)}.`;
        }
        case "decline":
            return ph.kind === "buy-decision" && seat === s.current ? null : "There is nothing to decline.";
        case "bid":
            return bidError(s, seat, a.amount);
        case "pass-bid":
            if (ph.kind !== "auction") return "There is no auction.";
            return ph.auction.bidders[ph.auction.turn] === seat ? null : "It's not your turn to bid.";
        case "pay-jail-fine":
            if (ph.kind !== "pre-roll" || seat !== s.current || !p.inJail) return "You're not in jail.";
            return p.cash >= s.settings.jailFine ? null : `The fine is ${money(board, s.settings.jailFine)}.`;
        case "use-jail-card":
            if (ph.kind !== "pre-roll" || seat !== s.current || !p.inJail) return "You're not in jail.";
            return heldJailDeck(s, seat) ? null : "You have no Get Out of Jail Free card.";
        case "end-turn":
            if (ph.kind !== "post-roll" || seat !== s.current) return "You can't end your turn now.";
            return ph.rollAgain ? "You rolled doubles — roll again." : null;

        case "build":
            return assetGate(s, seat, false) ?? tileArg(board, a.tile) ?? buildError(board, s, seat, a.tile);
        case "sell-building":
            return assetGate(s, seat, true) ?? tileArg(board, a.tile) ?? sellError(board, s, seat, a.tile);
        case "mortgage":
            return assetGate(s, seat, true) ?? tileArg(board, a.tile) ?? mortgageError(board, s, seat, a.tile);
        case "unmortgage":
            return assetGate(s, seat, false) ?? tileArg(board, a.tile) ?? unmortgageError(board, s, seat, a.tile);

        case "propose-trade":
            if (s.pendingTrade) return "Another trade is already pending.";
            return tradeGate(s, seat) ?? validateTrade(board, s, seat, a.to, a.give, a.get);
        case "accept-trade": {
            const t = s.pendingTrade;
            if (!t || t.id !== a.tradeId) return "That trade is no longer open.";
            if (t.to !== seat) return "Only the player the trade was offered to can accept it.";
            return acceptError(board, s, t);
        }
        case "reject-trade": {
            const t = s.pendingTrade;
            if (!t || t.id !== a.tradeId) return "That trade is no longer open.";
            return t.to === seat ? null : "Only the player the trade was offered to can reject it.";
        }
        case "cancel-trade": {
            const t = s.pendingTrade;
            if (!t || t.id !== a.tradeId) return "That trade is no longer open.";
            return t.from === seat ? null : "Only the proposer can cancel a trade.";
        }

        case "pay-debt":
            if (ph.kind !== "debt" || ph.debt.debtor !== seat) return "You don't owe anything.";
            return p.cash >= ph.debt.amount ? null : `You need ${money(board, ph.debt.amount)} — sell, mortgage or trade first.`;
        case "declare-bankruptcy":
            return ph.kind === "debt" && ph.debt.debtor === seat ? null : "You can only declare bankruptcy when in debt.";

        case "force-skip":
            if (!actor.isCreator) return "Only the game creator can skip a player.";
            return needsToAct(s).includes(seat) ? null : "That player isn't holding up the game.";
        case "end-game":
            return actor.isCreator ? null : "Only the game creator can end the game.";
        default:
            return "Unknown action.";
    }
}

export function runAction(board: BoardDef, s: GameState, a: Action): void {
    const ph = s.phase;
    switch (a.type) {
        case "join":
            return doJoin(s, a);
        case "leave":
            return doLeave(s, a.seat);
        case "update-settings": {
            s.settings = mergeSettings(s.settings, a.settings) as typeof s.settings;
            s.housesLeft = s.settings.houseSupply;
            s.hotelsLeft = s.settings.hotelSupply;
            return log(s, "Game settings updated.", "info");
        }
        case "start":
            return doStart(board, s);

        case "roll":
            return doRoll(board, s);
        case "buy": {
            if (ph.kind !== "buy-decision") return;
            const t = ownableTile(board, ph.tile)!;
            s.players[a.seat].cash -= t.price;
            s.ownership[String(ph.tile)] = { owner: a.seat, houses: 0, mortgaged: false };
            log(s, `${s.players[a.seat].name} bought ${t.name} for ${money(board, t.price)}.`, "good", a.seat);
            return toPostRoll(s);
        }
        case "decline":
            if (ph.kind !== "buy-decision") return;
            log(s, `${s.players[a.seat].name} declined ${board.tiles[ph.tile].name}.`, "info", a.seat);
            return decline(board, s, ph.tile, s.settings.auctionOnDecline);
        case "bid":
            return placeBid(board, s, a.seat, a.amount);
        case "pass-bid":
            return passBid(board, s, a.seat);
        case "pay-jail-fine": {
            const p = s.players[a.seat];
            const text = `${p.name} paid the ${money(board, s.settings.jailFine)} jail fine.`;
            settle(board, s, [{ debtor: a.seat, creditor: null, amount: s.settings.jailFine, text }], "pre-roll");
            return releaseFromJail(s, a.seat);
        }
        case "use-jail-card": {
            const deck = heldJailDeck(s, a.seat)!;
            s.players[a.seat].jailCards[deck]--;
            returnJailCard(board, s, deck);
            releaseFromJail(s, a.seat);
            return log(s, `${s.players[a.seat].name} used a Get Out of Jail Free card.`, "good", a.seat);
        }
        case "end-turn":
            return nextTurn(board, s);

        case "build":
            return doBuild(board, s, a.seat, a.tile);
        case "sell-building":
            return doSell(board, s, a.seat, a.tile);
        case "mortgage":
            return doMortgage(board, s, a.seat, a.tile);
        case "unmortgage":
            return doUnmortgage(board, s, a.seat, a.tile);

        case "propose-trade": {
            const trade = {
                id: `trade-${s.nextLogId}`,
                from: a.seat,
                to: a.to,
                give: { cash: a.give.cash, tiles: [...a.give.tiles], jailCards: a.give.jailCards },
                get: { cash: a.get.cash, tiles: [...a.get.tiles], jailCards: a.get.jailCards },
            };
            s.pendingTrade = trade;
            return log(s, `${s.players[a.seat].name} offered ${s.players[a.to].name} a trade: ${describe(board, s, trade)}.`, "info", a.seat);
        }
        case "accept-trade":
            return executeTrade(board, s, s.pendingTrade!);
        case "reject-trade":
            s.pendingTrade = null;
            return log(s, `${s.players[a.seat].name} rejected the trade.`, "info", a.seat);
        case "cancel-trade":
            s.pendingTrade = null;
            return log(s, `${s.players[a.seat].name} withdrew the trade offer.`, "info", a.seat);

        case "pay-debt":
            return payDebt(board, s);
        case "declare-bankruptcy":
            return bankrupt(board, s, a.seat);

        case "force-skip":
            return forceSkip(board, s, a.seat);
        case "end-game":
            log(s, "The game creator ended the game.", "info");
            if (ph.kind === "lobby") {
                s.phase = { kind: "game-over", winner: null, reason: "ended" };
                return;
            }
            return finishGame(board, s, "ended");
    }
}

function decline(board: BoardDef, s: GameState, tile: number, auction: boolean): void {
    if (auction) startAuction(board, s, tile);
    else toPostRoll(s);
}

function bankrupt(board: BoardDef, s: GameState, seat: Seat): void {
    if (s.phase.kind !== "debt") return;
    const { debt, resume, queue } = s.phase;
    goBankrupt(board, s, seat, debt.creditor);
    if (checkLastStanding(board, s)) return;
    const rest = (queue ?? []).filter((d) => d.debtor !== seat && d.creditor !== seat);
    continueAfterDebt(board, s, rest, resume);
}

/** Creator override: take the minimal step that unblocks `seat`. */
function forceSkip(board: BoardDef, s: GameState, seat: Seat): void {
    const name = s.players[seat].name;
    if (s.pendingTrade) {
        s.pendingTrade = null;
        return log(s, `The game creator cancelled the pending trade.`, "info");
    }
    const ph = s.phase;
    log(s, `The game creator skipped ahead for ${name}.`, "info", seat);
    switch (ph.kind) {
        case "pre-roll":
            return doRoll(board, s);
        case "post-roll":
            return ph.rollAgain ? doRoll(board, s) : nextTurn(board, s);
        case "buy-decision":
            return decline(board, s, ph.tile, false);
        case "auction":
            return passBid(board, s, seat);
        case "debt":
            return bankrupt(board, s, seat);
        default:
            return resumeTurn(board, s, "post-roll");
    }
}

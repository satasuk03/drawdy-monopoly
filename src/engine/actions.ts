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
import { isInt, log, money, ownableTile, tr } from "./util";

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
function assetGate(board: BoardDef, s: GameState, seat: Seat, raisesCash: boolean): string | null {
    const ph = s.phase;
    if ((ph.kind === "pre-roll" || ph.kind === "post-roll") && seat === s.current) return null;
    if (ph.kind === "debt" && ph.debt.debtor === seat) return raisesCash ? null : tr(board, "err.payDebtFirst");
    return tr(board, "err.cantManageNow");
}

function tradeGate(board: BoardDef, s: GameState, seat: Seat): string | null {
    const ph = s.phase;
    if ((ph.kind === "pre-roll" || ph.kind === "post-roll") && seat === s.current) return null;
    if (ph.kind === "debt" && ph.debt.debtor === seat) return null;
    return tr(board, "err.tradeOwnTurn");
}

/** propose-trade is possible for `seat` with some other active player (ignoring the offer's contents). */
export function canProposeTrade(board: BoardDef, s: GameState, seat: Seat): boolean {
    const p = s.players[seat];
    if (!p || p.bankrupt || s.pendingTrade || s.phase.kind === "lobby" || s.phase.kind === "game-over") return false;
    return tradeGate(board, s, seat) === null && s.players.some((q) => q.seat !== seat && !q.bankrupt);
}

function tileArg(board: BoardDef, tile: unknown): string | null {
    return isInt(tile) && tile >= 0 && tile < board.tiles.length ? null : tr(board, "err.noSuchTile");
}

/** Actions allowed while a trade offer is waiting for an answer. */
const DURING_TRADE = new Set(["accept-trade", "reject-trade", "cancel-trade", "force-skip", "end-game"]);
const LOBBY = new Set(["join", "leave", "update-settings", "start", "end-game"]);

export function checkAction(board: BoardDef, s: GameState, a: Action, actor: Actor): string | null {
    if (!a || typeof a !== "object" || typeof a.type !== "string") return tr(board, "err.malformedAction");
    const ph = s.phase;
    if (ph.kind === "game-over") return tr(board, "err.gameOver");
    if (ph.kind === "lobby" && !LOBBY.has(a.type)) return tr(board, "err.notStarted");
    if (ph.kind !== "lobby" && (a.type === "join" || a.type === "leave" || a.type === "update-settings" || a.type === "start"))
        return tr(board, "err.alreadyStarted");

    // Every seat-bearing action must come from the user controlling that seat
    // (force-skip names the seat being skipped, so it is creator-gated instead).
    let seat: Seat = -1;
    if ("seat" in a) {
        seat = a.seat;
        const p = isInt(seat) ? s.players[seat] : undefined;
        if (!p) return tr(board, "err.noSuchSeat");
        if (a.type !== "force-skip") {
            if (p.userId !== actor.userId) return tr(board, "err.notYourSeat");
            if (p.bankrupt) return tr(board, "err.youAreBankrupt");
        }
    }
    if (s.pendingTrade && !DURING_TRADE.has(a.type)) return tr(board, "err.tradePending");
    const p = s.players[seat];

    switch (a.type) {
        case "join":
            return joinError(board, s, a, actor.userId);
        case "leave":
            return null;
        case "update-settings": {
            if (!actor.isCreator) return tr(board, "err.creatorSettings");
            const m = mergeSettings(board, s.settings, a.settings);
            return typeof m === "string" ? m : null;
        }
        case "start":
            if (!actor.isCreator) return tr(board, "err.creatorStart");
            return s.players.length >= 2 ? null : tr(board, "err.needTwoPlayers");

        case "roll":
            if (seat !== s.current) return tr(board, "err.notYourTurn");
            if (ph.kind === "pre-roll" || (ph.kind === "post-roll" && ph.rollAgain)) return null;
            return tr(board, "err.cantRoll");
        case "buy": {
            if (ph.kind !== "buy-decision" || seat !== s.current) return tr(board, "err.nothingToBuy");
            const t = ownableTile(board, ph.tile)!;
            return p.cash >= t.price ? null : tr(board, "err.costs", { tile: t.name, amount: money(board, t.price) });
        }
        case "decline":
            return ph.kind === "buy-decision" && seat === s.current ? null : tr(board, "err.nothingToDecline");
        case "bid":
            return bidError(board, s, seat, a.amount);
        case "pass-bid":
            if (ph.kind !== "auction") return tr(board, "err.noAuction");
            return ph.auction.bidders[ph.auction.turn] === seat ? null : tr(board, "err.notYourBid");
        case "pay-jail-fine":
            if (ph.kind !== "pre-roll" || seat !== s.current || !p.inJail) return tr(board, "err.notInJail");
            return p.cash >= s.settings.jailFine ? null : tr(board, "err.fineIs", { amount: money(board, s.settings.jailFine) });
        case "use-jail-card":
            if (ph.kind !== "pre-roll" || seat !== s.current || !p.inJail) return tr(board, "err.notInJail");
            return heldJailDeck(s, seat) ? null : tr(board, "err.noJailCard");
        case "end-turn":
            if (ph.kind !== "post-roll" || seat !== s.current) return tr(board, "err.cantEndTurn");
            return ph.rollAgain ? tr(board, "err.rollAgain") : null;

        case "build":
            return assetGate(board, s, seat, false) ?? tileArg(board, a.tile) ?? buildError(board, s, seat, a.tile);
        case "sell-building":
            return assetGate(board, s, seat, true) ?? tileArg(board, a.tile) ?? sellError(board, s, seat, a.tile);
        case "mortgage":
            return assetGate(board, s, seat, true) ?? tileArg(board, a.tile) ?? mortgageError(board, s, seat, a.tile);
        case "unmortgage":
            return assetGate(board, s, seat, false) ?? tileArg(board, a.tile) ?? unmortgageError(board, s, seat, a.tile);

        case "propose-trade":
            if (s.pendingTrade) return tr(board, "err.tradeAlreadyPending");
            return tradeGate(board, s, seat) ?? validateTrade(board, s, seat, a.to, a.give, a.get);
        case "accept-trade": {
            const t = s.pendingTrade;
            if (!t || t.id !== a.tradeId) return tr(board, "err.tradeClosed");
            if (t.to !== seat) return tr(board, "err.onlyTargetAccept");
            return acceptError(board, s, t);
        }
        case "reject-trade": {
            const t = s.pendingTrade;
            if (!t || t.id !== a.tradeId) return tr(board, "err.tradeClosed");
            return t.to === seat ? null : tr(board, "err.onlyTargetReject");
        }
        case "cancel-trade": {
            const t = s.pendingTrade;
            if (!t || t.id !== a.tradeId) return tr(board, "err.tradeClosed");
            return t.from === seat ? null : tr(board, "err.onlyProposerCancel");
        }

        case "pay-debt":
            if (ph.kind !== "debt" || ph.debt.debtor !== seat) return tr(board, "err.oweNothing");
            return p.cash >= ph.debt.amount ? null : tr(board, "err.needCash", { amount: money(board, ph.debt.amount) });
        case "declare-bankruptcy":
            return ph.kind === "debt" && ph.debt.debtor === seat ? null : tr(board, "err.bankruptOnlyInDebt");

        case "force-skip":
            if (!actor.isCreator) return tr(board, "err.creatorSkip");
            return needsToAct(s).includes(seat) ? null : tr(board, "err.notHoldingUp");
        case "end-game":
            return actor.isCreator ? null : tr(board, "err.creatorEnd");
        default:
            return tr(board, "err.unknownAction");
    }
}

export function runAction(board: BoardDef, s: GameState, a: Action): void {
    const ph = s.phase;
    switch (a.type) {
        case "join":
            return doJoin(board, s, a);
        case "leave":
            return doLeave(board, s, a.seat);
        case "update-settings": {
            s.settings = mergeSettings(board, s.settings, a.settings) as typeof s.settings;
            s.housesLeft = s.settings.houseSupply;
            s.hotelsLeft = s.settings.hotelSupply;
            return log(s, tr(board, "log.settingsUpdated"), "info");
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
            log(s, tr(board, "log.bought", { name: s.players[a.seat].name, tile: t.name, amount: money(board, t.price) }), "good", a.seat);
            return toPostRoll(s);
        }
        case "decline":
            if (ph.kind !== "buy-decision") return;
            log(s, tr(board, "log.declined", { name: s.players[a.seat].name, tile: board.tiles[ph.tile].name }), "info", a.seat);
            return decline(board, s, ph.tile, s.settings.auctionOnDecline);
        case "bid":
            return placeBid(board, s, a.seat, a.amount);
        case "pass-bid":
            return passBid(board, s, a.seat);
        case "pay-jail-fine": {
            const p = s.players[a.seat];
            const text = tr(board, "log.paidJailFine", { name: p.name, amount: money(board, s.settings.jailFine) });
            settle(board, s, [{ debtor: a.seat, creditor: null, amount: s.settings.jailFine, text }], "pre-roll");
            return releaseFromJail(s, a.seat);
        }
        case "use-jail-card": {
            const deck = heldJailDeck(s, a.seat)!;
            s.players[a.seat].jailCards[deck]--;
            returnJailCard(board, s, deck);
            releaseFromJail(s, a.seat);
            return log(s, tr(board, "log.usedJailCard", { name: s.players[a.seat].name }), "good", a.seat);
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
            return log(s, tr(board, "log.tradeOffered", { name: s.players[a.seat].name, other: s.players[a.to].name, trade: describe(board, s, trade) }), "info", a.seat);
        }
        case "accept-trade":
            return executeTrade(board, s, s.pendingTrade!);
        case "reject-trade":
            s.pendingTrade = null;
            return log(s, tr(board, "log.tradeRejected", { name: s.players[a.seat].name }), "info", a.seat);
        case "cancel-trade":
            s.pendingTrade = null;
            return log(s, tr(board, "log.tradeWithdrawn", { name: s.players[a.seat].name }), "info", a.seat);

        case "pay-debt":
            return payDebt(board, s);
        case "declare-bankruptcy":
            return bankrupt(board, s, a.seat);

        case "force-skip":
            return forceSkip(board, s, a.seat);
        case "end-game":
            log(s, tr(board, "log.creatorEnded"), "info");
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
        return log(s, tr(board, "log.creatorCancelledTrade"), "info");
    }
    const ph = s.phase;
    log(s, tr(board, "log.creatorSkipped", { name }), "info", seat);
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

// The game contract. GameState is plain JSON: it lives in the board frame's
// `meta` and is synced to every collaborator, so keep it small and never put
// class instances, Maps, or undefined-vs-missing distinctions in it.
//
// The engine is pure: (board, state, action, actor) -> new state + events.
// It never imports Drawdy types and never reads the clock or Math.random —
// dice come from the seeded PRNG stored in the state, so any client replaying
// the same actions gets the same game.

import type { Lang } from "../i18n/lang";

/** Index into GameState.players. Stable for the whole game. */
export type Seat = number;

export type GameSettings = {
    startingCash: number;
    /** Paid when passing or landing on GO. */
    salary: number;
    /** Land exactly on GO pays double salary. House rule, default false. */
    doubleSalaryOnGo: boolean;
    /** Taxes and card fines go to a pot collected on free parking. House rule, default false. */
    freeParkingJackpot: boolean;
    /** Declining to buy starts an auction (official rule). Default true. */
    auctionOnDecline: boolean;
    /** Must build evenly across a color group (official rule). Default true. */
    evenBuild: boolean;
    /** Collect rent while in jail (official rule). Default true. */
    rentInJail: boolean;
    jailFine: number;
    /** 0 = unlimited. Otherwise game ends after this many full rounds; highest net worth wins. */
    roundLimit: number;
    /** Bank building supply (official 32 / 12). */
    houseSupply: number;
    hotelSupply: number;
};

export const DEFAULT_SETTINGS: GameSettings = {
    startingCash: 1500,
    salary: 200,
    doubleSalaryOnGo: false,
    freeParkingJackpot: false,
    auctionOnDecline: true,
    evenBuild: true,
    rentInJail: true,
    jailFine: 50,
    roundLimit: 0,
    houseSupply: 32,
    hotelSupply: 12,
};

export type Player = {
    seat: Seat;
    /** Drawdy collaboration user id controlling this seat. Several seats may share one id (hot-seat). */
    userId: string;
    name: string;
    /** #rrggbb */
    color: string;
    /** TokenDef.id from the board theme. */
    token: string;
    cash: number;
    /** 0–39 */
    position: number;
    inJail: boolean;
    /** Failed doubles attempts this jail stay (0–2). */
    jailTurns: number;
    /** Number of jail-free cards held, by deck. */
    jailCards: { chance: number; chest: number };
    bankrupt: boolean;
};

export type Ownership = {
    owner: Seat;
    /** 0–4 houses, 5 = hotel. Always 0 for railroads/utilities. */
    houses: number;
    mortgaged: boolean;
};

export type TradeOffer = {
    cash: number;
    tiles: number[];
    jailCards: number;
};

export type Trade = {
    id: string;
    from: Seat;
    to: Seat;
    /** What `from` gives. */
    give: TradeOffer;
    /** What `from` asks of `to`. */
    get: TradeOffer;
};

export type Auction = {
    tile: number;
    /** 0 = no bid yet. */
    highBid: number;
    highBidder: Seat | null;
    /** Seats still in, in bidding order. Bidding goes round-robin. */
    bidders: Seat[];
    /** Index into `bidders` of whose turn it is to bid or pass. */
    turn: number;
};

export type Debt = {
    debtor: Seat;
    /** null = the bank. */
    creditor: Seat | null;
    amount: number;
};

export type Phase =
    /** Players join; game creator configures and starts. */
    | { kind: "lobby" }
    /** Current player rolls (or, in jail, pays / uses card / rolls for doubles). */
    | { kind: "pre-roll" }
    /** Landed on an unowned ownable tile. */
    | { kind: "buy-decision"; tile: number }
    | { kind: "auction"; auction: Auction }
    /** Owes more cash than they hold: sell, mortgage, trade, or go bankrupt. Resumes `resume` when paid. */
    | {
          kind: "debt";
          debt: Debt;
          resume: "pre-roll" | "post-roll";
          /** Further debts from the same event (pay-each / collect-from-each cards), settled in order after `debt`. Omitted when empty. */
          queue?: Debt[];
      }
    /** Turn done moving; may build, trade, mortgage. Rolls again if `rollAgain` (doubles). */
    | { kind: "post-roll"; rollAgain: boolean }
    | { kind: "game-over"; winner: Seat | null; reason: "last-standing" | "round-limit" | "ended" };

export type PhaseKind = Phase["kind"];

export type Deck = {
    /** Card indices in draw order. Jail-free cards held by players are absent. */
    order: number[];
    /** Next draw position in `order`. */
    next: number;
};

export type LogEntry = {
    /** Monotonic id; clients toast entries newer than the last id they saw. */
    id: number;
    /** Plain text, already formatted with the board's currency. */
    text: string;
    /** Seat the entry is mostly about, for coloring. */
    seat?: Seat;
    /** Drives toast styling and sounds-of-the-mind. */
    tone: "info" | "good" | "bad" | "card" | "dice";
};

export type GameState = {
    /** Schema version of this object, for future migrations. */
    schema: 1;
    gameId: string;
    boardId: string;
    /** Language of the board text and the log, fixed at creation. Missing on older games = "en". */
    lang?: Lang;
    /** userId of the player who created the game; they control settings and admin actions. */
    creatorUserId: string;
    settings: GameSettings;
    players: Player[];
    /** Keyed by tile index as a string (JSON object keys). Missing = bank-owned. */
    ownership: Record<string, Ownership>;
    current: Seat;
    phase: Phase;
    /** Last roll, for the dice display. */
    dice: [number, number] | null;
    /** Doubles rolled in a row this turn. 3 → jail. */
    doublesCount: number;
    /** Completed rounds (incremented when play wraps back to the first non-bankrupt seat). */
    round: number;
    housesLeft: number;
    hotelsLeft: number;
    jackpot: number;
    decks: { chance: Deck; chest: Deck };
    pendingTrade: Trade | null;
    /** Last ~60 entries. */
    log: LogEntry[];
    nextLogId: number;
    /** mulberry32 state. */
    rng: number;
};

/** Everything a client can ask the engine to do. `seat` is who is acting. */
export type Action =
    // lobby
    | { type: "join"; userId: string; name: string; color: string; token: string }
    | { type: "leave"; seat: Seat }
    | { type: "update-settings"; settings: Partial<GameSettings> }
    | { type: "start" }
    // turn
    | { type: "roll"; seat: Seat }
    | { type: "buy"; seat: Seat }
    | { type: "decline"; seat: Seat }
    | { type: "bid"; seat: Seat; amount: number }
    | { type: "pass-bid"; seat: Seat }
    | { type: "pay-jail-fine"; seat: Seat }
    | { type: "use-jail-card"; seat: Seat }
    | { type: "end-turn"; seat: Seat }
    // assets, allowed whenever it's not someone else's blocking decision (see engine)
    | { type: "build"; seat: Seat; tile: number }
    | { type: "sell-building"; seat: Seat; tile: number }
    | { type: "mortgage"; seat: Seat; tile: number }
    | { type: "unmortgage"; seat: Seat; tile: number }
    // trades
    | { type: "propose-trade"; seat: Seat; to: Seat; give: TradeOffer; get: TradeOffer }
    | { type: "accept-trade"; seat: Seat; tradeId: string }
    | { type: "reject-trade"; seat: Seat; tradeId: string }
    | { type: "cancel-trade"; seat: Seat; tradeId: string }
    // endings
    | { type: "pay-debt"; seat: Seat }
    | { type: "declare-bankruptcy"; seat: Seat }
    /** Creator only: skip an absent player's turn (forces the minimal legal step). */
    | { type: "force-skip"; seat: Seat }
    /** Creator only: end now, highest net worth wins. */
    | { type: "end-game" };

export type ActionType = Action["type"];

/** Who sent an action. The engine checks `userId` controls the action's seat. */
export type Actor = { userId: string; isCreator: boolean };

export type ApplyResult =
    | { ok: true; state: GameState }
    | { ok: false; error: string };

/** Per-seat summary used by UIs. */
export type SeatView = {
    seat: Seat;
    netWorth: number;
    /** Action types this seat may issue right now. */
    legal: ActionType[];
    /** Tiles this seat may build on / sell from / mortgage / unmortgage right now. */
    buildable: number[];
    sellable: number[];
    mortgageable: number[];
    unmortgageable: number[];
};

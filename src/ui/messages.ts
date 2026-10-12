// Messages between the driver (worker) and the control-panel webview.
// The webview bundle is a hand-written HTML string (src/ui/webview-html.ts),
// so this file is the only shared definition — keep both sides in sync with it.

import type { BoardDef } from "../boards/types";
import type { Action, GameSettings, GameState, Seat, SeatView } from "../engine/types";

/** A theme as listed in the "new game" picker. */
export type BoardSummary = {
    id: string;
    name: string;
    tagline: string;
    /** Small SVG preview of the theme (corner/center art), as an SVG string. */
    previewSvg: string;
    /** Token choices: id, name and SVG string for the picker. */
    tokens: { id: string; name: string; svg: string }[];
    currencySymbol: string;
};

/** A game found on this Drawdy board. A board may hold several games. */
export type GameSummary = {
    gameId: string;
    boardId: string;
    boardName: string;
    phase: GameState["phase"]["kind"];
    playerNames: string[];
};

export type Me = { userId: string; name: string; color: string };

/** Everything the panel needs to render the selected game. Sent whole on each change. */
export type GameView = {
    state: GameState;
    board: BoardDef;
    /** Seats the local user controls (several in hot-seat mode). */
    mySeats: Seat[];
    /** The seat the panel should act as right now: whoever must act among mySeats, else the first. */
    activeSeat: Seat | null;
    seatViews: SeatView[];
    /** Token SVG strings by token id, for player chips. */
    tokenSvgs: Record<string, string>;
    /** userIds currently present on the Drawdy board (empty if collaboration is unavailable). */
    presentUserIds: string[];
    isCreator: boolean;
    /** Action round-trip in flight: grey out buttons until the next state arrives. */
    pending: boolean;
};

/** driver → webview */
export type DriverToWebview =
    | {
          type: "init";
          me: Me;
          boards: BoardSummary[];
          defaultSettings: GameSettings;
          /** `--dd-*` token map from ModuleStyling.tokens. */
          themeTokens: Record<string, string>;
          themeMode: "dark" | "light";
      }
    /** Theme picker entries again, after the panel switched language. */
    | { type: "boards"; boards: BoardSummary[] }
    | { type: "theme"; themeTokens: Record<string, string>; themeMode: "dark" | "light" }
    /** Games on the board; `selected` is the one the panel shows (null → lobby/new-game screen). */
    | { type: "games"; games: GameSummary[]; selected: string | null }
    | { type: "view"; view: GameView | null }
    /** An action was rejected; show inline, non-blocking. */
    | { type: "error"; message: string };

/** webview → driver */
export type WebviewToDriver =
    /** `lang`: the panel's language (navigator / saved choice), so the driver can match it. */
    | { type: "ready"; lang?: string }
    /** The user switched the panel language. */
    | { type: "lang"; lang: string }
    /** Create a new game frame on the canvas near the viewport and select it. */
    /** `lang`: the game's language (board text, scoreboard, log), fixed for the game's life. Defaults to the panel's. */
    | { type: "create-game"; boardId: string; settings: Partial<GameSettings>; lang?: string }
    | { type: "select-game"; gameId: string | null }
    /**
     * Send an engine action for the selected game. For `join` the driver fills
     * in userId; the webview supplies name/color/token. Hot-seat players are
     * just extra `join`s from the same user.
     */
    | { type: "action"; gameId: string; action: Action }
    /** Fly the camera to the game board (or one tile of it). */
    | { type: "focus"; gameId: string; tile?: number }
    /** Remove the game's elements from the canvas (creator only; asks to confirm in the panel first). */
    | { type: "delete-game"; gameId: string };

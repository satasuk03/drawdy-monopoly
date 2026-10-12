// Board themes are pure, serializable data. The engine, the scene renderer,
// the SVG art and the webview all read the same BoardDef, so it must never
// hold functions — it is posted to the webview as-is.
//
// Money is in *base units* everywhere (engine, state, cards). Display goes
// through formatMoney() with the board's currency, so a theme reskins prices
// without changing the balance: Thailand's base 200 shows as ฿20,000.

export type GroupId = string;

/** Keys into the art icon library (src/art/icons.ts). */
export type IconKey = string;

export type ColorGroup = {
    id: GroupId;
    name: string;
    /** #rrggbb, used for the tile color bar, ownership chips and cards. */
    color: string;
};

/** [base, 1 house, 2 houses, 3 houses, 4 houses, hotel] in base units. */
export type RentTable = [number, number, number, number, number, number];

export type TileDef =
    | { kind: "go"; name: string; icon?: IconKey }
    | {
          kind: "property";
          name: string;
          /** Short line under the name, e.g. a district. Optional flavor. */
          subtitle?: string;
          group: GroupId;
          price: number;
          rent: RentTable;
          houseCost: number;
          icon?: IconKey;
      }
    /** Rent 25 / 50 / 100 / 200 for 1–4 owned. */
    | { kind: "railroad"; name: string; price: number; icon?: IconKey }
    /** Rent 4× dice with one owned, 10× with both. */
    | { kind: "utility"; name: string; price: number; icon?: IconKey }
    | { kind: "tax"; name: string; amount: number; icon?: IconKey }
    | { kind: "chance"; name: string; icon?: IconKey }
    | { kind: "chest"; name: string; icon?: IconKey }
    /** Corner 10. "Just visiting" when not jailed. */
    | { kind: "jail"; name: string; icon?: IconKey }
    | { kind: "free-parking"; name: string; icon?: IconKey }
    | { kind: "go-to-jail"; name: string; icon?: IconKey };

export type TileKind = TileDef["kind"];

/** Tiles that can be owned. */
export type OwnableKind = "property" | "railroad" | "utility";

export type CardEffect =
    /** Move forward to `tile`; collect salary if passing GO (always true in the classic deck). */
    | { kind: "move-to"; tile: number }
    /** Move forward to the nearest tile of `target` kind. Rent is multiplied (railroad: 2× rent; utility: 10× dice, rolled fresh). */
    | { kind: "move-to-nearest"; target: "railroad" | "utility" }
    /** Move by `steps` (negative = backwards, never collects salary). */
    | { kind: "move-by"; steps: number }
    | { kind: "collect"; amount: number }
    | { kind: "pay"; amount: number }
    /** Every other active player pays you `amount`. */
    | { kind: "collect-from-each"; amount: number }
    /** You pay every other active player `amount`. */
    | { kind: "pay-each"; amount: number }
    | { kind: "repairs"; perHouse: number; perHotel: number }
    | { kind: "go-to-jail" }
    /** Keep until used or traded. */
    | { kind: "jail-free" };

export type CardDef = {
    id: string;
    /** Use {money:N} placeholders for amounts so they format in the board's currency, e.g. "Bank error in your favor. Collect {money:200}." */
    text: string;
    effect: CardEffect;
};

export type TokenDef = {
    /** Key into the art token library for this theme (src/art/tokens.ts). */
    id: string;
    name: string;
};

export type Currency = {
    symbol: string;
    /** true → "200 ₡", false → "$200". */
    suffix: boolean;
    /** Multiplier applied for display only. */
    scale: number;
};

export type BoardPalette = {
    /** Canvas behind the tiles. */
    boardFill: string;
    /** Tile body fill. */
    tileFill: string;
    /** Big center area. */
    centerFill: string;
    /** Tile borders and grid lines. */
    line: string;
    /** Primary text on tiles. */
    text: string;
    /** Secondary text (prices). */
    mutedText: string;
    /** Theme accent for logo, highlights and corner art. */
    accent: string;
    /** Second accent. */
    accent2: string;
};

export type BoardDef = {
    id: string;
    name: string;
    tagline: string;
    /** Exactly 40 tiles, index 0 = GO, 10 = jail, 20 = free parking, 30 = go-to-jail. */
    tiles: TileDef[];
    groups: ColorGroup[];
    /** 16 cards each. */
    chance: CardDef[];
    chest: CardDef[];
    /** At least 8, so 6 players always have a choice. */
    tokens: TokenDef[];
    currency: Currency;
    palette: BoardPalette;
    /** Display names for deck and tile families in this theme. */
    labels: {
        chance: string;
        chest: string;
        railroad: string;
        utility: string;
        house: string;
        hotel: string;
        jail: string;
    };
    /** Font stack used in SVG art. Keep to system fonts; Thai needs a Thai-capable stack. */
    fontFamily: string;
    /** Theme key the art module switches on for corner/center artwork. */
    artTheme: string;
};

export function formatMoney(board: Pick<BoardDef, "currency">, base: number): string {
    const { symbol, suffix, scale } = board.currency;
    const n = Math.round(base * scale);
    const abs = Math.abs(n).toLocaleString("en-US");
    const sign = n < 0 ? "-" : "";
    return suffix ? `${sign}${abs} ${symbol}` : `${sign}${symbol}${abs}`;
}

/** Replace {money:N} placeholders in card text. */
export function formatCardText(board: Pick<BoardDef, "currency">, text: string): string {
    return text.replace(/\{money:(-?\d+)\}/g, (_, n: string) => formatMoney(board, Number(n)));
}

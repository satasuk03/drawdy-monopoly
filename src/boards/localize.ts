// Board content in other languages. A theme's BoardDef is written in English;
// src/boards/i18n/<theme>.ts holds a BoardText per language, and
// localizeBoard() overlays it, so the engine, art, scene and panel all read
// translated names without knowing about languages.

import type { BoardDef } from "./types";
import { type Lang } from "../i18n/lang";
import { CLASSIC_TEXT } from "./i18n/classic";
import { THAILAND_TEXT } from "./i18n/thailand";
import { SPACE_TEXT } from "./i18n/space";
import { FANTASY_TEXT } from "./i18n/fantasy";

/** Everything translatable on a board. Missing entries keep the English. */
export type BoardText = {
    name: string;
    tagline: string;
    /** 40 entries, by tile index. */
    tiles: { name: string; subtitle?: string }[];
    /** By group id. */
    groups: Record<string, string>;
    /** By card id (chance and chest). Keep {money:N} placeholders exactly as in English. */
    cards: Record<string, string>;
    /** By token id. */
    tokens: Record<string, string>;
    labels: BoardDef["labels"];
};

export type BoardTranslations = Partial<Record<Exclude<Lang, "en">, BoardText>>;

export const BOARD_TEXT: Record<string, BoardTranslations> = {
    classic: CLASSIC_TEXT,
    thailand: THAILAND_TEXT,
    space: SPACE_TEXT,
    fantasy: FANTASY_TEXT,
};

/** System fonts that cover each script, put ahead of the theme's generic family. */
const SCRIPT_FONTS: Partial<Record<Lang, string>> = {
    th: `"Noto Sans Thai", "Thonburi", "Leelawadee UI", "Tahoma"`,
    zh: `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC"`,
};

function withScriptFonts(stack: string, lang: Lang): string {
    const extra = SCRIPT_FONTS[lang];
    if (!extra) return stack;
    const parts = stack.split(",").map((s) => s.trim());
    const generic = parts.length > 1 && /^(serif|sans-serif|monospace|cursive|fantasy)$/.test(parts[parts.length - 1]!) ? parts.pop()! : null;
    return [...parts, extra, ...(generic ? [generic] : [])].join(", ");
}

const cache = new Map<string, BoardDef>();

/** The board with its text in `lang`. Same object for the same (board, lang). */
export function localizeBoard(board: BoardDef, lang: Lang | undefined): BoardDef {
    const l = lang ?? "en";
    if (l === "en") return board;
    const key = `${board.id}|${l}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const tx = BOARD_TEXT[board.id]?.[l];
    const out: BoardDef = tx
        ? {
              ...board,
              lang: l,
              name: tx.name || board.name,
              tagline: tx.tagline || board.tagline,
              tiles: board.tiles.map((t, i) => {
                  const tt = tx.tiles[i];
                  if (!tt) return t;
                  const next = { ...t, name: tt.name || t.name };
                  if (next.kind === "property") next.subtitle = tt.subtitle;
                  return next;
              }),
              groups: board.groups.map((g) => ({ ...g, name: tx.groups[g.id] || g.name })),
              chance: board.chance.map((c) => ({ ...c, text: tx.cards[c.id] || c.text })),
              chest: board.chest.map((c) => ({ ...c, text: tx.cards[c.id] || c.text })),
              tokens: board.tokens.map((t) => ({ ...t, name: tx.tokens[t.id] || t.name })),
              labels: { ...board.labels, ...tx.labels },
              fontFamily: withScriptFonts(board.fontFamily, l),
          }
        : { ...board, lang: l, fontFamily: withScriptFonts(board.fontFamily, l) };
    cache.set(key, out);
    return out;
}

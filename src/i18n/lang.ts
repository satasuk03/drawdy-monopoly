// Languages. A game has one language (GameState.lang): everything drawn on the
// shared canvas, the board content and the game log use it. The control panel
// chrome follows each user's own choice (webview/i18n.js).

export type Lang = "en" | "th" | "zh" | "es";

export const LANGS: Lang[] = ["en", "th", "zh", "es"];

/** Each language's name in itself, for pickers. */
export const LANG_NAMES: Record<Lang, string> = { en: "English", th: "ไทย", zh: "中文", es: "Español" };

/** "th-TH" → "th", "zh-Hans-CN" → "zh", anything unknown → "en". */
export function normalizeLang(x: unknown): Lang {
    if (typeof x !== "string") return "en";
    const base = x.toLowerCase().split(/[-_]/)[0] ?? "";
    return (LANGS as string[]).includes(base) ? (base as Lang) : "en";
}

export type Params = Record<string, string | number>;

/** Fill `{name}` placeholders. Unknown placeholders are left as they are. */
export function fill(template: string, params?: Params): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * A translator over string tables. English is the complete table and the
 * fallback for keys a language is missing.
 */
export function makeTr<K extends string>(tables: { en: Record<K, string> } & Partial<Record<Lang, Partial<Record<K, string>>>>) {
    return (lang: Lang | undefined, key: K, params?: Params): string =>
        fill(tables[lang ?? "en"]?.[key] ?? tables.en[key], params);
}

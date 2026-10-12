// Small helpers shared by the art generators. Pure, no DOM.

export function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Round to 1 decimal and drop trailing zeros. */
export function n1(v: number): string {
    return String(Math.round(v * 10) / 10);
}

/** Escape a font stack for use inside a double-quoted attribute. */
export function fontAttr(stack: string): string {
    return escapeXml(stack).replace(/&quot;/g, "'");
}

const THAI = /[฀-๿]/;
const COMBINING = /[ัิ-ฺ็-๎]/;
/** Han, kana and full-width punctuation: one em each, and a line may break between any two. */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** Rough advance width of a string in em units. */
export function textEm(s: string, bold = false): number {
    let w = 0;
    for (const ch of s) {
        if (COMBINING.test(ch)) continue;
        if (CJK.test(ch)) w += 1;
        else if (THAI.test(ch)) w += 0.52;
        else if (/[A-Z]/.test(ch)) w += bold ? 0.7 : 0.66;
        else if (/[ilI.,'!|:;]/.test(ch)) w += 0.3;
        else if (/[mwMW]/.test(ch)) w += 0.85;
        else if (ch === " ") w += 0.3;
        else if (/[0-9]/.test(ch)) w += 0.58;
        else w += bold ? 0.6 : 0.55;
    }
    return w;
}

function segments(text: string): string[] {
    if (THAI.test(text) && typeof Intl !== "undefined" && "Segmenter" in Intl) {
        try {
            const seg = new (Intl as unknown as { Segmenter: new (l: string, o: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter("th", { granularity: "word" });
            return Array.from(seg.segment(text), (x) => x.segment);
        } catch {
            /* fall through */
        }
    }
    // CJK: every character is a break point; punctuation stays with the character before it.
    if (CJK.test(text)) return text.match(/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef][\u3001\u3002\uff0c\uff01\uff1f\uff1a\uff1b\u300d\u300f\uff09]*\s*|[^\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]+/g) ?? [text];
    // Latin: keep words with their trailing space.
    return text.match(/\S+\s*|\s+/g) ?? [text];
}

/**
 * Wrap text to a pixel width. Returns at most `maxLines` lines; if the text
 * does not fit the font size is reduced (down to `minSize`) and finally the
 * last line is truncated with an ellipsis. Result `size` is what to draw with.
 */
export function wrapText(
    text: string,
    width: number,
    size: number,
    maxLines: number,
    opts: { bold?: boolean; minSize?: number } = {}
): { lines: string[]; size: number } {
    const bold = !!opts.bold;
    const minSize = opts.minSize ?? size - 3;
    for (let fs = size; fs >= minSize; fs -= 0.5) {
        const lines = layout(text, width / fs, bold, false);
        if (lines && lines.length <= maxLines) return { lines, size: fs };
    }
    const lines = layout(text, width / minSize, bold, true)!;
    const cut = lines.slice(0, maxLines);
    const last = cut[maxLines - 1]!.replace(/\s+$/, "");
    cut[maxLines - 1] = last + "…";
    return { lines: cut, size: minSize };
}

/** Greedy line layout; with `allowBreak` false returns null if a single word is too wide. */
function layout(text: string, maxEm: number, bold: boolean, allowBreak: boolean): string[] | null {
    const lines: string[] = [];
    let cur = "";
    for (const part of segments(text.trim())) {
        if (textEm((cur + part).trimEnd(), bold) <= maxEm) {
            cur += part;
            continue;
        }
        if (cur) lines.push(cur.trimEnd());
        cur = part.trimStart();
        // A single over-long token: break by characters.
        if (!allowBreak && textEm(cur.trimEnd(), bold) > maxEm) return null;
        while (textEm(cur.trimEnd(), bold) > maxEm && cur.length > 1) {
            let k = cur.length - 1;
            while (k > 1 && (textEm(cur.slice(0, k), bold) > maxEm || COMBINING.test(cur[k]!))) k--;
            lines.push(cur.slice(0, k));
            cur = cur.slice(k);
        }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
}

/** Tiny deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** #rrggbb → shade. amt in -1..1 (negative = darker, positive = lighter). */
export function shade(hex: string, amt: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const v = parseInt(m[1]!, 16);
    const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
        const t = amt < 0 ? 0 : 255;
        const p = Math.abs(amt);
        return Math.round((t - c) * p + c);
    });
    return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** Perceived luminance 0..1 of #rrggbb. */
export function luma(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0.5;
    const v = parseInt(m[1]!, 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

/** Text color readable on top of `bg`. */
export function onColor(bg: string): string {
    return luma(bg) > 0.6 ? "#1f1a14" : "#ffffff";
}

export function svgDataUrl(svg: string): string {
    const min = svg.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
    return "data:image/svg+xml," + encodeURIComponent(min);
}

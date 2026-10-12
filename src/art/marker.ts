// Turn marker: a glowing ring in the current player's color, drawn around
// their token. 100x100 viewBox; the ring stays inside 8 units of the edge so
// the glow isn't clipped.

import { escapeXml, fontAttr, n1, textEm } from "./util";

export function turnRingSvg(color: string): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
        `<defs><filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>` +
        `<circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="9" opacity=".75" filter="url(#g)"/>` +
        `<circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="7"/>` +
        `<circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="4"/>` +
        `</svg>`
    );
}

/** A gold coin for money flying between players (64x64): rim, embossed star, shine. */
export function coinSvg(): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
        `<defs><radialGradient id="c" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c2"/><stop offset=".45" stop-color="#ffd23f"/><stop offset="1" stop-color="#d89a12"/></radialGradient></defs>` +
        `<circle cx="32" cy="32" r="29" fill="#b97a0c"/>` +
        `<circle cx="32" cy="31" r="27" fill="url(#c)" stroke="#8a5a06" stroke-width="2"/>` +
        `<circle cx="32" cy="31" r="20" fill="none" stroke="#c98a10" stroke-width="2" opacity=".8"/>` +
        `<path d="M32 18l3.8 7.7 8.5 1.2-6.1 6 1.4 8.4-7.6-4-7.6 4 1.4-8.4-6.1-6 8.5-1.2z" fill="#f2b51d" stroke="#a86f08" stroke-width="1.5" stroke-linejoin="round"/>` +
        `<path d="M15 22a20 20 0 0 1 14-10" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".7"/>` +
        `</svg>`
    );
}

/**
 * Owner marker: a bold band in the owner's color along a tile's outer edge,
 * outlined dark and white so it reads on every theme. Mortgaged: faded with
 * white hatching. Drawn at exactly `width` x `height` (it is placed 1:1).
 */
export function ownerBadgeSvg(color: string, mortgaged: boolean, width: number, height: number): string {
    const w = Math.round(width);
    const h = Math.round(height);
    const r = Math.min(w, h) / 2;
    const horizontal = w >= h;
    const hatch = mortgaged
        ? `<defs><pattern id="m" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#fff" opacity=".75"/></pattern></defs>`
        : "";
    const shine = horizontal
        ? `<rect x="${r}" y="3.5" width="${w - 2 * r}" height="${Math.max(2, h * 0.22)}" rx="1.5" fill="#fff" opacity=".45"/>`
        : `<rect x="3.5" y="${r}" width="${Math.max(2, w * 0.22)}" height="${h - 2 * r}" rx="1.5" fill="#fff" opacity=".45"/>`;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
        hatch +
        `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r - 1}" fill="${color}" stroke="#1d1a24" stroke-width="2"${mortgaged ? ` fill-opacity=".55" stroke-dasharray="5 3"` : ""}/>` +
        (mortgaged ? `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="${r - 3}" fill="url(#m)"/>` : shine) +
        `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="${r - 3}" fill="none" stroke="#fff" stroke-width="1.5" opacity=".85"/>` +
        `</svg>`
    );
}

/** Name tags are this tall; their width follows the name. */
export const NAME_TAG_H = 24;
const NAME_TAG_FONT = 14;
const NAME_TAG_MAX = 12; // characters before the name is cut with an ellipsis

/**
 * A name, shortened to fit on a tag. On a crowded tile (`crowd` tokens) the
 * tags would pile up, so 3 sharing get short names and 4+ just an initial.
 */
export function nameTagText(name: string, crowd = 1): string {
    const chars = [...name.trim()];
    if (crowd >= 4) return (chars[0] ?? "?").toUpperCase();
    const max = crowd === 3 ? 6 : NAME_TAG_MAX;
    return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

/** Width of the tag for `text` (already shortened). */
export function nameTagWidth(text: string): number {
    return Math.round(textEm(text, true) * NAME_TAG_FONT + 18);
}

/** Dark ink on light player colors (yellow, lime), white on the rest. */
function inkOn(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return "#fff";
    const v = parseInt(m[1]!, 16);
    const lum = 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    return lum > 170 ? "#1d1d1f" : "#fff";
}

/** A pill in the player's color with their name on it, a white edge so it reads on any tile. */
export function nameTagSvg(text: string, color: string, fontFamily: string): string {
    const w = nameTagWidth(text);
    const h = NAME_TAG_H;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
        `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${(h - 2) / 2}" fill="${color}" stroke="#fff" stroke-width="2"/>` +
        `<text x="${n1(w / 2)}" y="${n1(h / 2 + NAME_TAG_FONT * 0.36)}" text-anchor="middle" font-family="${fontAttr(fontFamily)}" font-size="${NAME_TAG_FONT}" font-weight="700" fill="${inkOn(color)}">${escapeXml(text)}</text>` +
        `</svg>`
    );
}

// The full 1220x1220 board as one SVG string.

import { formatMoney, type BoardDef, type TileDef } from "../boards/types";
import { ts } from "../i18n/scene";
import { BOARD, CENTER, CORNER, tilePlacement } from "../boards/layout";
import { centerArt } from "./center";
import { iconBody, iconKey } from "./icons";
import { escapeXml, fontAttr, n1, onColor, shade, wrapText } from "./util";

type Ctx = { board: BoardDef; icons: Set<string> };

function text(
    s: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    o: { w?: number; anchor?: string; extra?: string } = {}
): string {
    const w = o.w && o.w !== 400 ? ` font-weight="${o.w}"` : "";
    const a = o.anchor === "start" ? ` text-anchor="start"` : o.anchor === "end" ? ` text-anchor="end"` : "";
    return `<text x="${n1(x)}" y="${n1(y)}" font-size="${n1(size)}" fill="${fill}"${w}${a}${o.extra ?? ""}>${escapeXml(s)}</text>`;
}

function lines(ls: string[], x: number, y0: number, lh: number, size: number, fill: string, w = 700): string {
    return ls.map((l, i) => text(l, x, y0 + i * lh, size, fill, { w })).join("");
}

function use(ctx: Ctx, key: string | undefined, x: number, y: number, size: number, color: string): string {
    const k = iconKey(key);
    ctx.icons.add(k);
    return `<use href="#i-${k}" x="${n1(x)}" y="${n1(y)}" width="${size}" height="${size}" color="${color}"/>`;
}

function groupColor(board: BoardDef, id: string): string {
    return board.groups.find((g) => g.id === id)?.color ?? board.palette.accent;
}

// ---------------------------------------------------------------- edge tiles

/** Upright 100x160 tile art; the bar is at the top, text reads downward. */
function edgeBody(ctx: Ctx, tile: TileDef, flip: boolean): string {
    const { board } = ctx;
    const p = board.palette;
    let out = `<rect width="100" height="160" fill="${p.tileFill}" stroke="${p.line}" stroke-width="1.5"/>`;
    const cx = 50;
    // flip: bar on the bottom (top-row tiles, content stays upright); content shifts clear of the owner chip.
    const barY = flip ? 130 : 0;
    const dy = tile.kind === "property" ? (flip ? -14 : 0) : flip ? 12 : 0;
    let bar = "";
    const open = () => (out += `<g transform="translate(0 ${dy})">`);
    switch (tile.kind) {
        case "property": {
            const gc = groupColor(board, tile.group);
            bar = `<rect y="${barY}" width="100" height="30" fill="${gc}" stroke="${p.line}" stroke-width="1.5"/><rect y="${barY + 1}" width="100" height="12" fill="#fff" opacity=".14"/>`;
            open();
            const nm = wrapText(tile.name, 88, 13, 3, { bold: true, minSize: 9 });
            const lh = nm.size * 1.12;
            const sub = tile.subtitle && nm.lines.length <= 2 ? wrapText(tile.subtitle, 88, 10.5, 1, { minSize: 8.5 }) : null;
            const total = nm.lines.length * lh + (sub ? 12 : 0);
            const y0 = 36 + (62 - total) / 2 + nm.size * 0.85;
            out += lines(nm.lines, cx, y0, lh, nm.size, p.text);
            if (sub) out += text(sub.lines[0]!, cx, y0 + (nm.lines.length - 1) * lh + 13, sub.size, p.mutedText);
            out += use(ctx, tile.icon, cx - 14, 96, 28, shade(gc, luma(gc) > 0.7 ? -0.35 : -0.1));
            out += text(formatMoney(board, tile.price), cx, 134, 14, p.text, { w: 700 });
            break;
        }
        case "railroad":
        case "utility": {
            open();
            const nm = wrapText(tile.name, 88, 13, 3, { bold: true, minSize: 9 });
            out += lines(nm.lines, cx, 24, nm.size * 1.12, nm.size, p.text);
            out += use(ctx, tile.icon ?? (tile.kind === "railroad" ? "train" : "bulb"), cx - 22, 66, 44, p.accent);
            out += text(formatMoney(board, tile.price), cx, 134, 14, p.text, { w: 700 });
            break;
        }
        case "tax": {
            open();
            const nm = wrapText(tile.name, 88, 13, 2, { bold: true, minSize: 10 });
            out += lines(nm.lines, cx, 24, nm.size * 1.12, nm.size, p.text);
            out += use(ctx, tile.icon ?? "tax", cx - 22, 62, 44, p.accent);
            out += text(ts(board.lang, "payTax", { amount: formatMoney(board, tile.amount) }), cx, 134, 13, p.text, { w: 700 });
            break;
        }
        default: {
            // chance / chest (and anything unexpected on an edge)
            const deck = tile.kind === "chest";
            out += `<rect x="8" y="8" width="84" height="144" rx="6" fill="none" stroke="${deck ? p.accent2 : p.accent}" stroke-width="1.5" opacity=".6"/>`;
            open();
            const nm = wrapText(tile.name, 80, 14, 2, { bold: true, minSize: 10 });
            out += lines(nm.lines, cx, 30, nm.size * 1.12, nm.size, p.text);
            out += use(ctx, tile.icon, cx - 26, 62, 52, deck ? p.accent2 : p.accent);
            break;
        }
    }
    return out + "</g>" + bar;
}

function edgeTile(ctx: Ctx, i: number, tile: TileDef): string {
    const pl = tilePlacement(i);
    const cx = pl.rect.x + pl.rect.width / 2;
    const cy = pl.rect.y + pl.rect.height / 2;
    const top = pl.side === "top";
    const rot = pl.rotation && !top ? ` rotate(${pl.rotation})` : "";
    return `<g transform="translate(${n1(cx)} ${n1(cy)})${rot} translate(-50 -80)">${edgeBody(ctx, tile, top)}</g>`;
}

function luma(hex: string): number {
    const v = parseInt(hex.slice(1), 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

// ------------------------------------------------------------------- corners

function cornerGo(ctx: Ctx, tile: TileDef): string {
    const { board } = ctx;
    const p = board.palette;
    const nm = wrapText(tile.name, 140, 13, 2, { bold: true, minSize: 10 });
    return (
        `<rect width="160" height="160" fill="url(#cgo)" stroke="${p.line}" stroke-width="1.5"/>` +
        lines(nm.lines, 80, 24, nm.size * 1.1, nm.size, p.mutedText) +
        text("GO", 80, 96, 64, p.accent, { w: 900, extra: ` letter-spacing="2"` }) +
        text("GO", 82, 98, 64, p.line, { w: 900, extra: ` letter-spacing="2" opacity=".18"` })+
        (() => {
            const c = wrapText(ts(board.lang, "collect", { amount: formatMoney(board, 200) }), 140, 12, 1, { bold: true, minSize: 9 });
            return text(c.lines[0]!, 80, 114, c.size, p.text, { w: 700 });
        })() +
        `<path d="M14 136l24-16v9h110v14H38v9z" fill="${p.accent}" stroke="${p.line}" stroke-width="1.5" stroke-linejoin="round"/>`
    );
}

function cornerJail(ctx: Ctx, tile: TileDef): string {
    const { board } = ctx;
    const p = board.palette;
    const dark = shade(p.accent2, -0.45);
    let bars = "";
    for (let x = 66; x < 150; x += 12) bars += `M${x} 28V118`;
    return (
        `<rect width="160" height="160" fill="${p.tileFill}" stroke="${p.line}" stroke-width="1.5"/>` +
        // outer L (visitors)
        `<path d="M0 0H44V116H160V160H0z" fill="${p.accent2}" opacity=".35"/>` +
        `<path d="M44 0V116H160" fill="none" stroke="${p.line}" stroke-width="1.2" opacity=".6"/>` +
        // the cell
        `<rect x="54" y="8" width="98" height="108" rx="3" fill="${dark}" stroke="${p.line}" stroke-width="2"/>` +
        `<rect x="58" y="12" width="90" height="100" fill="${shade(p.accent2, 0.25)}" opacity=".35"/>` +
        `<path d="${bars}" stroke="${p.line}" stroke-width="3.5" stroke-linecap="round"/>` +
        `<path d="M54 28H152M54 118H152" stroke="${p.line}" stroke-width="3"/>` +
        text(board.labels.jail.toUpperCase(), 103, 22, 12, "#fff", { w: 800, extra: ` letter-spacing="1"` }) +
        // visiting strip text
        `<text transform="translate(30 108) rotate(-90)" font-size="11" font-weight="800" fill="${p.text}" text-anchor="start" textLength="96" lengthAdjust="spacingAndGlyphs">${escapeXml(ts(board.lang, "justVisiting"))}</text>` +
        text(tile.name, 100, 150, 11, p.mutedText, { w: 700 })
    );
}

function cornerParking(ctx: Ctx, tile: TileDef): string {
    const { board } = ctx;
    const p = board.palette;
    const nm = wrapText(tile.name, 140, 14, 2, { bold: true, minSize: 10 });
    return (
        `<rect width="160" height="160" fill="url(#cfp)" stroke="${p.line}" stroke-width="1.5"/>` +
        `<circle cx="80" cy="64" r="44" fill="${p.accent}" stroke="${p.line}" stroke-width="2.5"/>` +
        `<circle cx="80" cy="64" r="37" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/>` +
        use(ctx, tile.icon ?? "parking", 48, 32, 64, "#fff") +
        lines(nm.lines, 80, 132 - (nm.lines.length - 1) * 8, nm.size * 1.1, nm.size, p.text)
    );
}

function cornerGoJail(ctx: Ctx, tile: TileDef): string {
    const { board } = ctx;
    const p = board.palette;
    const nm = wrapText(tile.name, 140, 14, 2, { bold: true, minSize: 10 });
    return (
        `<rect width="160" height="160" fill="url(#cgj)" stroke="${p.line}" stroke-width="1.5"/>` +
        `<path d="M10 10H150V150H10z" fill="none" stroke="${p.accent}" stroke-width="3" stroke-dasharray="10 8" opacity=".55"/>` +
        use(ctx, tile.icon ?? "police", 40, 20, 80, p.accent) +
        lines(nm.lines, 80, 126 - (nm.lines.length - 1) * 8, nm.size * 1.1, nm.size, p.text) +
        `<path d="M60 142h40l-8-8M100 142l-8 8" fill="none" stroke="${p.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    );
}

function corner(ctx: Ctx, i: number, tile: TileDef): string {
    const pl = tilePlacement(i);
    let body: string;
    switch (tile.kind) {
        case "go":
            body = cornerGo(ctx, tile);
            break;
        case "jail":
            body = cornerJail(ctx, tile);
            break;
        case "free-parking":
            body = cornerParking(ctx, tile);
            break;
        default:
            body = cornerGoJail(ctx, tile);
    }
    return `<g transform="translate(${pl.rect.x} ${pl.rect.y})">${body}</g>`;
}

// -------------------------------------------------------------------- center

function deck(ctx: Ctx, cx: number, cy: number, rot: number, label: string, icon: string, color: string): string {
    const p = ctx.board.palette;
    const nm = wrapText(label.toUpperCase(), 130, 18, 2, { bold: true, minSize: 11 });
    return (
        `<g transform="translate(${cx} ${cy}) rotate(${rot})">` +
        `<rect x="-86" y="-50" width="172" height="108" rx="10" fill="#000" opacity=".25"/>` +
        `<rect x="-84" y="-56" width="168" height="108" rx="10" fill="${shade(color, -0.35)}" stroke="${p.line}" stroke-width="1.5"/>` +
        `<rect x="-81" y="-53" width="168" height="108" rx="10" fill="${shade(color, -0.15)}" stroke="${p.line}" stroke-width="1.5"/>` +
        `<rect x="-78" y="-50" width="168" height="108" rx="10" fill="${color}" stroke="${p.line}" stroke-width="2"/>` +
        `<rect x="-70" y="-42" width="152" height="92" rx="6" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>` +
        use(ctx, icon, -14, -42, 32, onColor(color)) +
        lines(nm.lines, 6, nm.lines.length > 1 ? 14 : 22, nm.size * 1.1, nm.size, onColor(color), 800) +
        `</g>`
    );
}

function center(ctx: Ctx): { defs: string; body: string } {
    const { board } = ctx;
    const p = board.palette;
    const art = centerArt(board);
    const title = wrapText(board.name, 760, 84, 2, { bold: true, minSize: 44 });
    const tl = title.lines.length;
    const ty = tl > 1 ? 232 : 270;
    const lh = title.size * 1.05;
    const tag = wrapText(board.tagline, 640, 24, 2, { minSize: 17 });
    const tagY = ty + (tl - 1) * lh + 44;
    const tagFill = p.mutedText;
    let body = `<g transform="translate(${CENTER.x} ${CENTER.y})">${art.body}`;
    // plaque behind the title so it stays readable on busy art
    const plaqueY = ty - title.size * 0.9;
    const plaqueH = (tl - 1) * lh + title.size * 0.9 + 44 + tag.lines.length * 28 + 6;
    body += `<rect x="70" y="${n1(plaqueY)}" width="760" height="${n1(plaqueH)}" rx="22" fill="${p.centerFill}" opacity=".55"/>`;
    body += lines(title.lines, 452, ty + 3, lh, title.size, p.line, 800).replace(/font-weight="800"/g, `font-weight="800" opacity=".25"`);
    body += lines(title.lines, 450, ty, lh, title.size, p.accent, 800).replace(/<text /g, `<text stroke="${shade(p.accent, -0.5)}" stroke-width="1.5" paint-order="stroke" `);
    body += tag.lines.map((l, i) => text(l, 450, tagY + i * 28, tag.size, tagFill, { extra: ` font-style="italic"` })).join("");
    body += `<path d="M300 ${n1(tagY + tag.lines.length * 28 - 6)}h300" stroke="${p.accent2}" stroke-width="3" stroke-linecap="round"/>`;
    body += deck(ctx, 240, 690, -4, board.labels.chest, "chest", p.accent2);
    body += deck(ctx, 660, 690, 4, board.labels.chance, "chance", p.accent);
    body += `</g>`;
    return { defs: art.defs, body };
}

// ------------------------------------------------------------------ assembly

export function boardSvg(board: BoardDef): string {
    const ctx: Ctx = { board, icons: new Set() };
    const p = board.palette;
    let tiles = "";
    for (let i = 0; i < 40; i++) {
        const tile = board.tiles[i];
        if (!tile) continue;
        tiles += tilePlacement(i).corner ? corner(ctx, i, tile) : edgeTile(ctx, i, tile);
    }
    const c = center(ctx);
    const grad = (id: string, c1: string, c2: string) =>
        `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    const defs =
        grad("cgo", p.tileFill, shade(p.accent, 0.7)) + grad("cfp", p.tileFill, shade(p.accent2, 0.6)) + grad("cgj", p.tileFill, shade(p.accent, 0.65)) +
        c.defs +
        [...ctx.icons].sort().map((k) => `<symbol id="i-${k}" viewBox="0 0 24 24">${iconBody(k)}</symbol>`).join("");
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD} ${BOARD}" width="${BOARD}" height="${BOARD}" font-family="${fontAttr(board.fontFamily)}" text-anchor="middle">` +
        `<defs>${defs}</defs>` +
        `<rect width="${BOARD}" height="${BOARD}" rx="14" fill="${p.boardFill}"/>` +
        c.body +
        tiles +
        `<rect x="1" y="1" width="${BOARD - 2}" height="${BOARD - 2}" rx="14" fill="none" stroke="${p.line}" stroke-width="3"/>` +
        `<rect x="${CORNER}" y="${CORNER}" width="${BOARD - 2 * CORNER}" height="${BOARD - 2 * CORNER}" fill="none" stroke="${p.line}" stroke-width="2.5"/>` +
        `</svg>`
    );
}

export { CENTER };

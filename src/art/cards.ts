// Title-deed style cards (220x300) and the theme picker thumbnail (240x160).

import { formatMoney, type BoardDef } from "../boards/types";
import { BOARD, colorBarRect, tilePlacement } from "../boards/layout";
import { centerArt } from "./center";
import { iconBody, iconKey } from "./icons";
import { tokenGroup } from "./tokens";
import { escapeXml, fontAttr, n1, onColor, shade, wrapText } from "./util";

function head(board: BoardDef, w: number, h: number, extraDefs = ""): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${fontAttr(board.fontFamily)}" text-anchor="middle">${extraDefs ? `<defs>${extraDefs}</defs>` : ""}`;
}

function t(s: string, x: number, y: number, size: number, fill: string, weight = 400, anchor = "middle", extra = ""): string {
    return `<text x="${n1(x)}" y="${n1(y)}" font-size="${n1(size)}" fill="${fill}"${weight !== 400 ? ` font-weight="${weight}"` : ""} text-anchor="${anchor}"${extra}>${escapeXml(s)}</text>`;
}

function icon(key: string | undefined, x: number, y: number, size: number, color: string): string {
    return `<g transform="translate(${n1(x)} ${n1(y)}) scale(${n1(size / 24)})" color="${color}">${iconBody(iconKey(key))}</g>`;
}

function row(label: string, value: string, y: number, p: BoardDef["palette"], bold = false): string {
    return (
        t(label, 18, y, 12, p.text, bold ? 700 : 400, "start") +
        t(value, 202, y, 12, p.text, 700, "end")
    );
}

export function tileCardSvg(board: BoardDef, index: number): string {
    const tile = board.tiles[index];
    const p = board.palette;
    const W = 220;
    const H = 300;
    if (!tile) return head(board, W, H) + `<rect width="${W}" height="${H}" fill="${p.tileFill}"/></svg>`;
    let out = head(board, W, H) + `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="10" fill="${p.tileFill}" stroke="${p.line}" stroke-width="3"/>`;
    if (tile.kind === "property") {
        const gc = board.groups.find((g) => g.id === tile.group)?.color ?? p.accent;
        const fg = onColor(gc);
        out += `<path d="M1.5 11.5a10 10 0 0110-10H208.5a10 10 0 0110 10V76H1.5z" fill="${gc}" stroke="${p.line}" stroke-width="3"/>`;
        out += t("TITLE DEED", 110, 18, 9, fg, 700, "middle", ` letter-spacing="2" opacity=".8"`);
        const nm = wrapText(tile.name, 190, 20, 2, { bold: true, minSize: 13 });
        const y0 = nm.lines.length > 1 ? 38 : tile.subtitle ? 46 : 52;
        nm.lines.forEach((l, i) => (out += t(l, 110, y0 + i * nm.size * 1.1, nm.size, fg, 800)));
        if (tile.subtitle) out += t(tile.subtitle, 110, 71, 11, fg, 400, "middle", ` opacity=".85"`);
        out += t(`Rent ${formatMoney(board, tile.rent[0])}`, 110, 98, 15, p.text, 800);
        const hl = board.labels.house;
        const rows: [string, number][] = [
            [`With 1 ${hl}`, tile.rent[1]], [`With 2 ${hl}s`, tile.rent[2]], [`With 3 ${hl}s`, tile.rent[3]], [`With 4 ${hl}s`, tile.rent[4]], [`With ${board.labels.hotel.toUpperCase()}`, tile.rent[5]],
        ];
        rows.forEach(([l, v], i) => (out += row(l, formatMoney(board, v), 122 + i * 18, p, i === 4)));
        out += `<path d="M18 218H202" stroke="${p.line}" stroke-width="1" opacity=".4"/>`;
        out += row(`${hl} cost`, `${formatMoney(board, tile.houseCost)} each`, 238, p);
        out += row(`${board.labels.hotel} cost`, `${formatMoney(board, tile.houseCost)} + 4 ${hl}s`, 256, p);
        out += row("Mortgage value", formatMoney(board, Math.floor(tile.price / 2)), 276, p);
        out += t(`Price ${formatMoney(board, tile.price)}`, 202, 294, 9, p.mutedText, 400, "end").replace(`y="294"`, `y="293"`);
        return out + "</svg>";
    }
    if (tile.kind === "railroad" || tile.kind === "utility") {
        const rail = tile.kind === "railroad";
        const band = rail ? p.line : p.accent;
        out += `<path d="M1.5 11.5a10 10 0 0110-10H208.5a10 10 0 0110 10V76H1.5z" fill="${band}" stroke="${p.line}" stroke-width="3"/>`;
        out += icon(tile.icon ?? (rail ? "train" : "bulb"), 88, 10, 44, onColor(band));
        const nm = wrapText(tile.name, 190, 19, 2, { bold: true, minSize: 13 });
        nm.lines.forEach((l, i) => (out += t(l, 110, 98 + i * nm.size * 1.1, nm.size, p.text, 800)));
        const y = 98 + nm.lines.length * nm.size * 1.1 + 12;
        if (rail) {
            [25, 50, 100, 200].forEach((v, i) => (out += row(i === 0 ? `Rent (1 ${board.labels.railroad})` : `If ${i + 1} ${board.labels.railroad}s owned`, formatMoney(board, v), y + i * 22, p)));
        } else {
            const ls = [`If one ${board.labels.utility} is owned, rent is 4 times the dice roll.`, `If both are owned, rent is 10 times the dice roll.`];
            let yy = y;
            for (const s of ls) {
                const w = wrapText(s, 184, 12, 3);
                w.lines.forEach((l, i) => (out += t(l, 110, yy + i * 15, 12, p.text)));
                yy += w.lines.length * 15 + 10;
            }
        }
        out += `<path d="M18 252H202" stroke="${p.line}" stroke-width="1" opacity=".4"/>`;
        out += row("Mortgage value", formatMoney(board, Math.floor(tile.price / 2)), 274, p);
        out += t(`Price ${formatMoney(board, tile.price)}`, 202, 293, 9, p.mutedText, 400, "end");
        return out + "</svg>";
    }
    // Everything else: a simple icon card.
    const hue = tile.kind === "chest" ? p.accent2 : p.accent;
    const sub: Record<string, string> = {
        go: `Collect ${formatMoney(board, 200)} salary as you pass.`,
        tax: tile.kind === "tax" ? `Pay ${formatMoney(board, tile.amount)} to the bank.` : "",
        chance: `Draw a ${board.labels.chance} card.`,
        chest: `Draw a ${board.labels.chest} card.`,
        jail: `Just visiting, unless you are in ${board.labels.jail}.`,
        "free-parking": "A free place to rest. Nothing happens.",
        "go-to-jail": `Go directly to ${board.labels.jail}. Do not pass GO.`,
    };
    out += `<circle cx="110" cy="104" r="62" fill="${hue}" opacity=".18"/><circle cx="110" cy="104" r="62" fill="none" stroke="${hue}" stroke-width="3"/>`;
    out += icon(tile.icon ?? defaultIcon(tile.kind), 66, 60, 88, hue);
    const nm = wrapText(tile.name, 190, 22, 2, { bold: true, minSize: 14 });
    nm.lines.forEach((l, i) => (out += t(l, 110, 206 + i * nm.size * 1.1, nm.size, p.text, 800)));
    const w = wrapText(sub[tile.kind] ?? "", 184, 12, 3);
    w.lines.forEach((l, i) => (out += t(l, 110, 240 + nm.lines.length * 6 + i * 16, 12, p.mutedText)));
    return out + "</svg>";
}

function defaultIcon(kind: string): string {
    return ({ go: "go-arrow", jail: "jail-bars", "free-parking": "parking", "go-to-jail": "police", chance: "chance", chest: "chest", tax: "tax" } as Record<string, string>)[kind] ?? "star";
}

// ------------------------------------------------------------------ preview

export function boardPreviewSvg(board: BoardDef): string {
    const p = board.palette;
    const S = 150 / BOARD;
    const bx = 8;
    const by = 5;
    const art = centerArt(board);
    let tiles = "";
    for (let i = 0; i < 40; i++) {
        const tile = board.tiles[i];
        if (!tile) continue;
        const r = tilePlacement(i).rect;
        tiles += `<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${r.width}" height="${r.height}" fill="${p.tileFill}" stroke="${p.line}" stroke-width="5"/>`;
        if (tile.kind === "property") {
            const b = colorBarRect(i);
            const gc = board.groups.find((g) => g.id === tile.group)?.color ?? p.accent;
            tiles += `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${b.width}" height="${b.height}" fill="${gc}"/>`;
        } else if (tilePlacement(i).corner) {
            tiles += `<rect x="${n1(r.x + 12)}" y="${n1(r.y + 12)}" width="${r.width - 24}" height="${r.height - 24}" fill="${i % 20 === 0 ? p.accent2 : p.accent}" opacity=".55"/>`;
        } else if (tile.kind === "chance" || tile.kind === "chest") {
            tiles += `<circle cx="${n1(r.x + r.width / 2)}" cy="${n1(r.y + r.height / 2)}" r="26" fill="${tile.kind === "chest" ? p.accent2 : p.accent}" opacity=".7"/>`;
        }
    }
    const title = wrapText(board.name, 74, 17, 3, { bold: true, minSize: 11 });
    let tok = "";
    const cols = ["#e5484d", "#3b82f6", "#f5b63a"];
    board.tokens.slice(0, 3).forEach((tk, i) => (tok += tokenGroup(board.artTheme, tk.id, cols[i]!, 164 + i * 24, 112 - (i === 1 ? 2 : 0), 24)));
    return (
        head(board, 240, 160, art.defs.replace(/id="(\w+)"/g, 'id="p-$1"').replace(/url\(#(\w+)\)/g, "url(#p-$1)")) +
        `<rect width="240" height="160" rx="12" fill="${shade(p.boardFill, -0.05)}"/>` +
        `<rect x="${bx - 3}" y="${by - 3}" width="156" height="156" rx="6" fill="${p.line}" opacity=".25"/>` +
        `<g transform="translate(${bx} ${by}) scale(${S.toFixed(5)})">` +
        `<g transform="translate(160 160)">${art.body.replace(/url\(#(\w+)\)/g, "url(#p-$1)")}</g>${tiles}</g>` +
        title.lines.map((l, i) => t(l, 200, 30 + i * 19, title.size, p.text, 800)).join("") +
        t(`${board.tokens.length} tokens`, 200, 100, 10, p.mutedText) +
        tok +
        `</svg>`
    );
}

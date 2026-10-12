// Visual QA for tokens and dice: npx tsx scripts/scene-preview.ts
//   -> .gallery/tokens-on-board.html  (classic + thailand boards with tokens placed via tokenRect, plus a turn ring)
//   -> .gallery/dice-preview.html     (filmstrip of diceTumble/shadowTumble, sampled like Drawdy does)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOARDS } from "../src/boards";
import { BOARD, tokenRect } from "../src/boards/layout";
import { boardSvg, diceFaceSvg, diceShadowSvg, svgDataUrl, tokenSvg, turnRingSvg } from "../src/art";
import { turnRingRect } from "../src/scene/build";
import { diceTumble, shadowTumble } from "../src/scene/dice-anim";

const out = join(process.cwd(), ".gallery");
mkdirSync(out, { recursive: true });
const colors = ["#e5484d", "#3b82f6", "#2fa84f", "#f5b63a", "#a855f7", "#f97316"];

// ---- tokens on boards -----------------------------------------------------

/** [tile, tokens standing there, jailed] */
const SCENARIOS: [number, number, boolean][] = [
    [1, 1, false],
    [3, 2, false],
    [6, 4, false],
    [12, 2, false],
    [16, 3, false],
    [24, 4, false],
    [27, 6, false],
    [34, 3, false],
    [0, 2, false],
    [20, 6, false],
    [10, 3, true],
    [10, 2, false],
    [30, 1, false],
];

function boardPage(boardIndex: number): string {
    const b = BOARDS[boardIndex]!;
    let html = `<div style="position:relative;width:${BOARD}px;height:${BOARD}px">` +
        `<img src="${svgDataUrl(boardSvg(b))}" width="${BOARD}" height="${BOARD}" style="position:absolute;left:0;top:0">`;
    const at = (r: { x: number; y: number; width: number; height: number }, svg: string) =>
        `<img src="${svgDataUrl(svg)}" style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px">`;
    let n = 0;
    let first = true;
    for (const [tile, count, jailed] of SCENARIOS) {
        for (let slot = 0; slot < count; slot++) {
            const tok = b.tokens[(n + slot) % b.tokens.length]!;
            const color = colors[(n + slot) % colors.length]!;
            const r = tokenRect(tile, slot, jailed, count);
            html += at(r, tokenSvg(b, tok.id, color));
            if (first) {
                html += at(turnRingRect(r), turnRingSvg(color));
                first = false;
            }
        }
        n += count;
    }
    return html + `</div>`;
}

const head = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}</style>`;
BOARDS.forEach((b, i) => {
    if (b.id === "classic" || b.id === "thailand") writeFileSync(join(out, `tokens-on-board-${b.id}.html`), head + boardPage(i));
});
writeFileSync(
    join(out, "tokens-on-board.html"),
    head + ["classic", "thailand"].map((id) => boardPage(BOARDS.findIndex((b) => b.id === id))).join("")
);

// ---- dice filmstrip ---------------------------------------------------------

type Track = number[];
/** Catmull-Rom through evenly spaced keyframes (what Drawdy does over linear time). */
function sample(track: Track, u: number): number {
    const n = track.length - 1;
    const f = Math.min(n - 1e-9, Math.max(0, u * n));
    const i = Math.floor(f);
    const t = f - i;
    const p0 = track[Math.max(0, i - 1)]!, p1 = track[i]!, p2 = track[i + 1]!, p3 = track[Math.min(n, i + 2)]!;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3);
}

const FRAMES = 14;
const CELL_W = 460, CELL_H = 220, SIZE = 72, FLOOR = 150;
const SEED = 4242;
let strip = "";
for (let f = 0; f < FRAMES; f++) {
    const u = f / (FRAMES - 1);
    let cell = "";
    for (const die of [0, 1] as const) {
        const restX = CELL_W / 2 + (die === 0 ? -SIZE - 10 : 10) + 0;
        const place = (anim: ReturnType<typeof diceTumble>, svg: string, w: number, h: number, restY: number) => {
            const t = anim.animation.transform as Record<string, Track>;
            const g = (k: string, d: number) => (t[k] ? sample(t[k]!, u) : d);
            const sx = g("width", 1), sy = g("height", 1);
            return `<img src="${svgDataUrl(svg)}" style="position:absolute;left:${restX + g("x", 0) - 0}px;top:${restY + g("y", 0)}px;width:${w}px;height:${h}px;` +
                `opacity:${Math.min(1, Math.max(0, g("opacity", 1)))};transform:rotate(${g("rotation", 0)}rad) scale(${sx},${sy})">`;
        };
        cell += place(shadowTumble(SEED, die), diceShadowSvg(), SIZE + 8, 28, FLOOR + SIZE - 20 - 4);
        cell += place(diceTumble(SEED, die), diceFaceSvg(die === 0 ? 5 : 3), SIZE, SIZE, FLOOR - 4);
    }
    strip += `<div style="position:relative;width:${CELL_W}px;height:${CELL_H}px;overflow:hidden;background:#e9e4d8;border:1px solid #999;box-sizing:border-box">` +
        `<span style="position:absolute;left:4px;top:2px;font:12px sans-serif">${f + 1}  t=${Math.round(u * 1100)}ms</span>${cell}</div>`;
}
writeFileSync(
    join(out, "dice-preview.html"),
    head + `<div style="display:flex;flex-wrap:wrap;width:${CELL_W * 3}px">${strip}</div>`
);
console.log("wrote tokens-on-board.html and dice-preview.html in", out);

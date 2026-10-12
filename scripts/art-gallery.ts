// Visual QA: npx tsx scripts/art-gallery.ts  ->  .gallery/index.html (+ per-board SVG files)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOARDS } from "../src/boards";
import { actionButtonSvg, boardPreviewSvg, boardSvg, diceFaceSvg, hotelSvg, houseSvg, svgDataUrl, tileCardSvg, tokenSvg } from "../src/art";

const out = join(process.cwd(), ".gallery");
mkdirSync(out, { recursive: true });
const colors = ["#e5484d", "#3b82f6", "#2fa84f", "#f5b63a", "#a855f7", "#f97316"];
const img = (svg: string, w: number, h: number) => `<img width="${w}" height="${h}" src="${svgDataUrl(svg)}">`;

let html = `<!doctype html><meta charset="utf-8"><title>Board Tycoon art</title><style>body{font:14px sans-serif;background:#ddd;margin:20px}.row{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;align-items:center}.dark{background:#222;padding:6px}h2{margin-top:32px}</style>`;
html += `<h2>Misc</h2><div class="row">${[1, 2, 3, 4, 5, 6].map((v) => img(diceFaceSvg(v), 64, 64)).join("")}${img(houseSvg(), 44, 44)}${img(houseSvg(), 18, 18)}${img(hotelSvg(), 88, 44)}${img(hotelSvg(), 44, 22)}${img(hotelSvg("#d9342b", true), 44, 88)}${img(hotelSvg("#d9342b", true), 22, 44)}${img(actionButtonSvg(), 48, 48)}${img(actionButtonSvg(), 24, 24)}</div>`;
for (const b of BOARDS) {
    const svg = boardSvg(b);
    writeFileSync(join(out, `${b.id}-board.svg`), svg);
    writeFileSync(join(out, `${b.id}-preview.svg`), boardPreviewSvg(b));
    const bytes = Buffer.byteLength(svg);
    console.log(`${b.id}: board ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB), data url ${svgDataUrl(svg).length}`);
    html += `<h2>${b.name} (${b.id}) - ${(bytes / 1024).toFixed(1)} KB</h2>`;
    html += `<div class="row">${img(boardSvg(b), 900, 900)}${img(boardPreviewSvg(b), 480, 320)}</div>`;
    html += `<div class="row">${b.tokens.map((t) => `<div title="${t.id}">${img(tokenSvg(b, t.id, colors[0]!), 96, 96)}</div>`).join("")}</div>`;
    html += `<div class="row dark">${b.tokens.map((t, i) => img(tokenSvg(b, t.id, colors[i % 6]!), 44, 44)).join("")}</div>`;
    html += `<div class="row">${colors.map((c) => img(tokenSvg(b, b.tokens[0]!.id, c), 44, 44)).join("")}</div>`;
    const picks = [1, 11, 5, 12, 7, 2, 4, 0, 20].filter((i) => b.tiles[i]);
    html += `<div class="row">${picks.map((i) => img(tileCardSvg(b, i), 220, 300)).join("")}</div>`;
}
writeFileSync(join(out, "index.html"), html);
console.log("wrote", join(out, "index.html"));

import { shade } from "./util";

export function houseSvg(color = "#2fa84f"): string {
    const d = shade(color, -0.45);
    const l = shade(color, 0.35);
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">` +
        `<path d="M4 12h16v10H4z" fill="${color}" stroke="${d}" stroke-width="1.8" stroke-linejoin="round"/>` +
        `<path d="M1.5 12.5L12 2.5l10.5 10z" fill="${shade(color, -0.2)}" stroke="${d}" stroke-width="1.8" stroke-linejoin="round"/>` +
        `<rect x="9.5" y="15" width="5" height="7" fill="${d}"/>` +
        `<rect x="5.5" y="14" width="3" height="3" fill="${l}"/><rect x="15.5" y="14" width="3" height="3" fill="${l}"/>` +
        `</svg>`
    ).replace(/(\d)\.500/g, "$1.5");
}

/** Landscape (44x22) by default; `vertical` gives the 22x44 variant for left/right tiles. */
export function hotelSvg(color = "#d9342b", vertical = false): string {
    const w = vertical ? 22 : 44;
    const h = vertical ? 44 : 22;
    const d = shade(color, -0.5);
    const win = "#ffe9a8";
    const cols = vertical ? 2 : 5;
    const rows = vertical ? 4 : 2;
    const ww = vertical ? 4 : 4;
    const gx = (w - 4 - cols * ww) / (cols + 1);
    const top = vertical ? 11 : 6;
    const gy = (h - 3 - top - rows * 4) / (rows + 1);
    let wins = "";
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) wins += `<rect x="${(2 + gx + c * (ww + gx)).toFixed(1)}" y="${(top + gy + r * (4 + gy)).toFixed(1)}" width="${ww}" height="4" rx=".6" fill="${win}"/>`;
    const sign = vertical
        ? `<rect x="4" y="2" width="14" height="8" rx="2" fill="#fff" stroke="${d}" stroke-width="1.2"/><text x="11" y="8.8" font-family="Arial,sans-serif" font-size="8" font-weight="900" text-anchor="middle" fill="${color}">H</text>`
        : `<rect x="15" y="1" width="14" height="5.5" rx="1.5" fill="#fff" stroke="${d}" stroke-width="1.1"/><text x="22" y="5.8" font-family="Arial,sans-serif" font-size="5.5" font-weight="900" text-anchor="middle" fill="${color}">H</text>`;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
        `<rect x="1.5" y="${vertical ? 8 : 5}" width="${w - 3}" height="${h - (vertical ? 9.5 : 6.5)}" rx="2" fill="${color}" stroke="${d}" stroke-width="1.8"/>` +
        wins + sign +
        `</svg>`
    ).replace(/(\d)\.500/g, "$1.5").replace(/(\d)\.800/g, "$1.8").replace(/(\d)\.100/g, "$1.1");
}

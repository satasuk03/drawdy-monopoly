// Themed artwork for the open center of the board (900x900, local coords).

import type { BoardDef } from "../boards/types";
import { n1, rng, shade } from "./util";

export type CenterArt = { defs: string; body: string };

const W = 900;

/** Dispatch on board.artTheme; unknown themes get a plain accent frame. */
export function centerArt(board: BoardDef): CenterArt {
    switch (board.artTheme) {
        case "classic":
            return classic(board);
        case "thailand":
            return thailand(board);
        case "space":
            return space(board);
        case "fantasy":
            return fantasy(board);
        default:
            return { defs: "", body: `<rect width="${W}" height="${W}" fill="${board.palette.centerFill}"/>` };
    }
}

function frame(board: BoardDef, extra = ""): string {
    const p = board.palette;
    return (
        `<rect x="12" y="12" width="876" height="876" rx="10" fill="none" stroke="${p.accent2}" stroke-width="3"/>` +
        `<rect x="22" y="22" width="856" height="856" rx="6" fill="none" stroke="${p.line}" stroke-width="1" opacity=".55"/>` +
        extra
    );
}

// ---------------------------------------------------------------- classic

function classic(board: BoardDef): CenterArt {
    const p = board.palette;
    const defs =
        `<linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(p.centerFill, 0.35)}"/><stop offset=".6" stop-color="${p.centerFill}"/><stop offset="1" stop-color="${shade(p.centerFill, -0.12)}"/></linearGradient>` +
        `<pattern id="win" width="16" height="22" patternUnits="userSpaceOnUse"><rect x="4" y="5" width="7" height="10" fill="${p.accent2}" opacity=".75"/></pattern>`;
    let rays = "";
    for (let i = 0; i < 18; i++) {
        const a0 = Math.PI + (i / 18) * Math.PI;
        const a1 = a0 + (Math.PI / 18) * 0.5;
        rays += `M450 900L${n1(450 + Math.cos(a0) * 900)} ${n1(900 + Math.sin(a0) * 900)}L${n1(450 + Math.cos(a1) * 900)} ${n1(900 + Math.sin(a1) * 900)}z`;
    }
    // Skyline: [x, width, height, tiers]
    const blds: [number, number, number, number][] = [
        [40, 60, 90, 1], [100, 54, 140, 2], [154, 50, 110, 1], [204, 64, 190, 3], [268, 52, 130, 2], [320, 70, 230, 3],
        [390, 120, 300, 3], [510, 70, 230, 3], [580, 52, 130, 2], [632, 64, 190, 3], [696, 50, 110, 1], [746, 54, 140, 2], [800, 60, 90, 1],
    ];
    let sky = "";
    let wins = "";
    for (const [x, w, h, tiers] of blds) {
        sky += `<path d="M${x} 880V${n1(880 - h * 0.6)}${tierPath(x, w, h, tiers)}V880z"/>`;
        wins += `<rect x="${x + 4}" y="${n1(880 - h * 0.6 + 8)}" width="${w - 8}" height="${n1(h * 0.6 - 20)}"/>`;
    }
    let arcs = "";
    for (let i = 0; i < 5; i++) arcs += `<path d="M${450 - 70 - i * 26} 24a${70 + i * 26} ${70 + i * 26} 0 0 0 ${(70 + i * 26) * 2} 0" />`;
    let cf = "";
    for (const [cx, cy, sx, sy] of [[24, 24, 1, 1], [876, 24, -1, 1]] as const) {
        for (let i = 1; i <= 4; i++) cf += `<path d="M${cx} ${cy + sy * i * 26}a${i * 26} ${i * 26} 0 0 ${sx > 0 ? 0 : 1} ${sx * i * 26} ${-sy * i * 26}"/>`;
    }
    const body =
        `<rect width="900" height="900" fill="url(#cbg)"/>` +
        `<path d="${rays}" fill="${p.accent2}" opacity=".14"/>` +
        `<g fill="none" stroke="${p.accent2}" stroke-width="2" opacity=".7">${arcs}${cf}</g>` +
        `<g fill="${shade(p.line, 0.1)}" opacity=".92">${sky}</g>` +
        `<g fill="url(#win)">${wins}</g>` +
        `<rect x="22" y="878" width="856" height="2" fill="${p.accent2}"/>` +
        frame(board);
    return { defs, body };
}

function tierPath(x: number, w: number, h: number, tiers: number): string {
    // Left side steps up, spire, right side steps down (relative to the start at bottom-left).
    const base = 880 - h * 0.6;
    let d = "";
    let l = x;
    let r = x + w;
    const ys: number[] = [];
    for (let t = 0; t < tiers; t++) {
        if (t > 0) {
            l += w * 0.14;
            r -= w * 0.14;
        }
        const ny = 880 - h * (0.6 + (0.4 * (t + 1)) / tiers);
        ys.push(ny);
        d += `${t === 0 ? "" : `H${n1(l)}`}V${n1(ny)}`;
    }
    const top = ys[ys.length - 1]!;
    const spire = tiers >= 3 ? 36 : 14;
    d += `H${n1(l)}`; // already at l
    d += `L${n1((l + r) / 2)} ${n1(top - spire)}L${n1(r)} ${n1(top)}`;
    for (let t = tiers - 1; t >= 1; t--) {
        d += `V${n1(ys[t - 1]!)}H${n1(r + w * 0.14)}`;
        r += w * 0.14;
    }
    d += `V${n1(base)}H${x + w}`;
    return d;
}

// --------------------------------------------------------------- thailand

function lotus(cx: number, cy: number, s: number, c1: string, c2: string): string {
    const petal = (rot: number, fill: string, len: number) =>
        `<path d="M0 0C${n1(-0.32 * len)} ${n1(-0.4 * len)} ${n1(-0.25 * len)} ${n1(-0.8 * len)} 0 ${n1(-len)}C${n1(0.25 * len)} ${n1(-0.8 * len)} ${n1(0.32 * len)} ${n1(-0.4 * len)} 0 0z" fill="${fill}" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" transform="rotate(${rot})"/>`;
    return (
        `<g transform="translate(${cx} ${cy}) scale(${s})">` +
        petal(-62, c2, 34) + petal(62, c2, 34) + petal(-32, c1, 40) + petal(32, c1, 40) + petal(0, c1, 46) +
        `</g>`
    );
}

function stupa(x: number, base: number, s: number, fill: string, trim: string): string {
    // Bell-shaped chedi centered on x, standing on y=base, height ~ 300*s.
    return (
        `<g transform="translate(${x} ${base}) scale(${s})">` +
        `<path d="M-90 0V-14H90V0zM-76 -14V-30H76V-14zM-62 -30V-46H62V-30z" fill="${fill}"/>` +
        `<path d="M-48 -46C-52 -110 -30 -150 0 -158C30 -150 52 -110 48 -46z" fill="${fill}"/>` +
        `<path d="M-52 -92H52M-44 -122H44" stroke="${trim}" stroke-width="5" fill="none"/>` +
        `<path d="M-14 -158H14L10 -176H-10zM-9 -176H9L6 -190H-6zM-5 -190H5L0 -250z" fill="${fill}"/>` +
        `<rect x="-90" y="-8" width="180" height="3" fill="${trim}"/><rect x="-62" y="-40" width="124" height="3" fill="${trim}"/>` +
        `</g>`
    );
}

function thailand(board: BoardDef): CenterArt {
    const p = board.palette;
    const dark = shade(p.line, 0.05);
    const defs =
        `<radialGradient id="cbg" cx=".5" cy=".4" r=".75"><stop offset="0" stop-color="${shade(p.centerFill, 0.4)}"/><stop offset="1" stop-color="${shade(p.centerFill, -0.08)}"/></radialGradient>` +
        `<pattern id="lat" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M22 4L40 22 22 40 4 22z" fill="none" stroke="${p.accent}" stroke-width="1.4"/><circle cx="22" cy="22" r="3" fill="${p.accent}"/></pattern>` +
        `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(p.accent, 0.4)}"/><stop offset="1" stop-color="${shade(p.accent, -0.25)}"/></linearGradient>`;
    let waves = "";
    for (let r = 0; r < 4; r++) {
        waves += `<path d="M22 ${816 + r * 14}`;
        for (let x = 0; x < 856; x += 56) waves += `q14 -${10 - r * 2} 28 0t28 0`;
        waves += `" />`;
    }
    let petals = "";
    for (let i = 0; i < 15; i++) petals += `<path d="M${40 + i * 56} 22q28 34 56 0" />`;
    const body =
        `<rect width="900" height="900" fill="url(#cbg)"/>` +
        `<rect x="22" y="22" width="856" height="856" fill="url(#lat)" opacity=".16"/>` +
        `<circle cx="450" cy="190" r="150" fill="none" stroke="${p.accent}" stroke-width="2" opacity=".35"/><circle cx="450" cy="190" r="112" fill="${p.accent}" opacity=".12"/>` +
        `<g fill="none" stroke="${p.accent2}" stroke-width="2.5" opacity=".7">${petals}</g>` +
        `<rect x="22" y="780" width="856" height="98" fill="${p.accent}" opacity=".22"/>` +
        stupa(450, 800, 1.5, "url(#gold)", dark) + stupa(190, 800, 0.95, "url(#gold)", dark) + stupa(710, 800, 0.95, "url(#gold)", dark) +
        stupa(62, 800, 0.5, "url(#gold)", dark) + stupa(838, 800, 0.5, "url(#gold)", dark) +
        `<g fill="none" stroke="#3d9bd1" stroke-width="2.5" opacity=".55" stroke-linecap="round">${waves}</g>` +
        lotus(120, 850, 1.2, "#fff4f8", p.accent2) + lotus(330, 862, 0.9, "#fff4f8", p.accent2) + lotus(570, 862, 0.9, "#fff4f8", p.accent2) + lotus(780, 850, 1.2, "#fff4f8", p.accent2) +
        frame(board);
    return { defs, body };
}

// ------------------------------------------------------------------ space

function space(board: BoardDef): CenterArt {
    const p = board.palette;
    const defs =
        `<radialGradient id="cbg" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="${shade(p.centerFill, 0.12)}"/><stop offset="1" stop-color="${shade(p.centerFill, -0.5)}"/></radialGradient>` +
        `<radialGradient id="n1"><stop offset="0" stop-color="${p.accent2}" stop-opacity=".42"/><stop offset="1" stop-color="${p.accent2}" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="n2"><stop offset="0" stop-color="${p.accent}" stop-opacity=".32"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="n3"><stop offset="0" stop-color="#7a4dff" stop-opacity=".4"/><stop offset="1" stop-color="#7a4dff" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="pl" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffd9a0"/><stop offset=".55" stop-color="#e08a4f"/><stop offset="1" stop-color="#6a2f58"/></radialGradient>` +
        `<radialGradient id="mn" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#f4f4ff"/><stop offset="1" stop-color="#7d86b0"/></radialGradient>`;
    const rnd = rng(7);
    let stars = "";
    let big = "";
    for (let i = 0; i < 150; i++) {
        const x = 24 + rnd() * 852, y = 24 + rnd() * 852;
        const r = rnd();
        if (r > 0.94) big += `<path d="M${n1(x)} ${n1(y - 7)}Q${n1(x)} ${n1(y)} ${n1(x + 7)} ${n1(y)}Q${n1(x)} ${n1(y)} ${n1(x)} ${n1(y + 7)}Q${n1(x)} ${n1(y)} ${n1(x - 7)} ${n1(y)}Q${n1(x)} ${n1(y)} ${n1(x)} ${n1(y - 7)}z"/>`;
        else stars += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(0.6 + r * 1.6)}" opacity="${n1(0.35 + rnd() * 0.65)}"/>`;
    }
    const body =
        `<rect width="900" height="900" fill="url(#cbg)"/>` +
        `<circle cx="180" cy="200" r="340" fill="url(#n1)"/><circle cx="740" cy="620" r="380" fill="url(#n2)"/><circle cx="640" cy="130" r="300" fill="url(#n3)"/>` +
        `<g fill="#fff">${stars}</g><g fill="#fff" opacity=".95">${big}</g>` +
        `<g fill="none" stroke="${p.accent}" stroke-width="1.5" opacity=".28"><ellipse cx="450" cy="450" rx="380" ry="150" transform="rotate(-24 450 450)"/><ellipse cx="450" cy="450" rx="300" ry="110" transform="rotate(-24 450 450)" stroke-dasharray="6 10"/></g>` +
        // ringed planet (back ring, body, front ring)
        `<g transform="translate(738 112) rotate(-22) scale(.8)">` +
        `<ellipse rx="150" ry="34" fill="none" stroke="#f1c98c" stroke-width="14" opacity=".55"/>` +
        `<circle r="72" fill="url(#pl)"/>` +
        `<path d="M-148 5a148 34 0 0 0 296 0" fill="none" stroke="#f1c98c" stroke-width="14" opacity=".9"/>` +
        `<path d="M-150 6a150 36 0 0 0 300 0" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>` +
        `</g>` +
        `<circle cx="140" cy="720" r="46" fill="url(#mn)"/><circle cx="124" cy="708" r="9" fill="#6f78a3" opacity=".6"/><circle cx="156" cy="736" r="6" fill="#6f78a3" opacity=".6"/><circle cx="150" cy="702" r="4" fill="#6f78a3" opacity=".6"/>` +
        frame(board);
    return { defs, body };
}

// ---------------------------------------------------------------- fantasy

function fantasy(board: BoardDef): CenterArt {
    const p = board.palette;
    const rnd = rng(11);
    let specks = "";
    for (let i = 0; i < 90; i++) specks += `<circle cx="${n1(30 + rnd() * 840)}" cy="${n1(30 + rnd() * 840)}" r="${n1(0.6 + rnd() * 1.6)}"/>`;
    const defs =
        `<radialGradient id="cbg" cx=".5" cy=".5" r=".72"><stop offset="0" stop-color="${shade(p.centerFill, 0.3)}"/><stop offset=".7" stop-color="${p.centerFill}"/><stop offset="1" stop-color="${shade(p.centerFill, -0.28)}"/></radialGradient>` +
        `<linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5e8a4a"/><stop offset="1" stop-color="#3b5e33"/></linearGradient>`;
    const tower = (x: number, w: number, h: number, roof: number) =>
        `<rect x="${x}" y="${690 - h}" width="${w}" height="${h + 40}" fill="#7d7a8c"/>` +
        `<path d="M${x - 5} ${690 - h}L${x + w / 2} ${690 - h - roof}L${x + w + 5} ${690 - h}z" fill="${p.accent}"/>` +
        `<rect x="${x + w / 2 - 3}" y="${690 - h + 14}" width="6" height="14" rx="3" fill="#2b2338"/>`;
    const castle =
        `<g>` +
        `<rect x="350" y="640" width="200" height="90" fill="#8d8a9c"/>` +
        `<path d="M350 640h200v-10h-14v-10h-14v10h-14v-10h-14v10h-14v-10h-14v10h-14v-10h-14v10h-14v-10h-14v10h-14v-10h-14v10h-14z" fill="#8d8a9c"/>` +
        tower(318, 44, 150, 56) + tower(538, 44, 150, 56) + tower(412, 76, 230, 82) +
        `<path d="M432 730v-40a18 18 0 0136 0v40z" fill="#2b2338"/>` +
        `<path d="M450 520v-34" stroke="#2b2338" stroke-width="3"/><path d="M450 486l32 9-32 9z" fill="${p.accent2}"/>` +
        `</g>`;
    const body =
        `<rect width="900" height="900" fill="url(#cbg)"/>` +
        `<g fill="${p.line}" opacity=".14">${specks}</g>` +
        `<path d="M22 640L130 520 210 600 300 470 400 620 500 540 600 640 700 500 878 660V760H22z" fill="${shade(p.accent, 0.3)}" opacity=".35"/>` +
        `<circle cx="150" cy="170" r="62" fill="${p.accent2}" opacity=".5"/><circle cx="150" cy="170" r="48" fill="#ffe9a8" opacity=".8"/>` +
        `<path d="M22 740C150 700 260 690 450 700C640 690 760 700 878 740V878H22z" fill="url(#hill)"/>` +
        castle +
        `<path d="M22 800C200 770 320 790 450 790C580 790 700 770 878 800V878H22z" fill="#2f4a2a" opacity=".6"/>` +
        // dragon silhouette
        `<g transform="translate(700 112) scale(1.15)" fill="${p.accent}" stroke="${shade(p.accent, -0.4)}" stroke-width="2" stroke-linejoin="round">` +
        `<path d="M-60 30C-30 20 -10 24 10 14L30 -4 52 -10 66 -2 54 6 62 16 46 14 30 26 8 40C-14 52 -40 50 -70 42z"/>` +
        `<path d="M-6 20C-16 -20 -36 -48 -62 -58 -40 -36 -34 -22 -36 -2 -26 -14 -14 -12 -10 -2 -4 -16 8 -22 22 -12z"/>` +
        `<path d="M-60 36Q-84 50 -100 40Q-84 40 -70 32z"/><circle cx="52" cy="-2" r="1.8" fill="#fff"/>` +
        `</g>` +
        `<g fill="none" stroke="${p.accent2}" stroke-width="2" opacity=".6"><path d="M60 60h60M60 60v60M840 60h-60M840 60v60M60 840h60M60 840v-60M840 840h-60M840 840v-60"/></g>` +
        frame(board);
    return { defs, body };
}

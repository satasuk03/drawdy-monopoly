// Player tokens: 64x64 viewBox, recognisable silhouettes tinted with the
// player's color and a dark outline. Standalone images (tokenSvgFor) add a white
// halo and pedestal so they read on any tile.

import { shade } from "./util";

type Pal = { c: string; d: string; l: string };
type Draw = (p: Pal) => string;

const W = "#ffffff";
const INK = "#2a2230";
const GOLD = "#f2c14e";
const GLASS = "#bfe6f7";

function st(p: Pal, w = 2.2): string {
    return `stroke="${p.d}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
}
const path = (d: string, fill: string, p: Pal, w = 2.2) => `<path d="${d}" fill="${fill}" ${st(p, w)}/>`;
const circ = (x: number, y: number, r: number, fill: string, p: Pal, w = 2.2) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${st(p, w)}/>`;
const ell = (x: number, y: number, rx: number, ry: number, fill: string, p: Pal, w = 2.2) =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${st(p, w)}/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, p: Pal, r = 1.5, sw = 2.2) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${st(p, sw)}/>`;
const dot = (x: number, y: number, r: number, fill = INK) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const wheel = (x: number, y: number, r: number, p: Pal) => circ(x, y, r, INK, p, 1.8) + dot(x, y, r * 0.4, "#c9c9d1");
const line = (d: string, p: Pal, w = 2) => `<path d="${d}" fill="none" ${st(p, w)}/>`;

const TOKENS: Record<string, Record<string, Draw>> = {
    classic: {
        car: (p) =>
            path("M6 44V36q0-3 3-4l7-2 6-9h20l7 9 7 2q3 1 3 4v8z", p.c, p) +
            path("M24 23.5h8V30H19.5zM35 23.5h6.5L46 30H35z", GLASS, p, 1.4) +
            wheel(18, 44, 6.5, p) + wheel(47, 44, 6.5, p) + `<path d="M9 37h6" stroke="${p.l}" stroke-width="2.5" stroke-linecap="round"/>`,
        "top-hat": (p) =>
            ell(32, 46, 25, 7, p.c, p) +
            path("M18 45V15q0-4 4-4h20q4 0 4 4v30q-14 5-28 0z", p.c, p) +
            `<path d="M18 37q14 5 28 0v-7q-14 5-28 0z" fill="${W}" ${st(p, 1.8)}/>` +
            `<path d="M22 14v20" stroke="${p.l}" stroke-width="3" stroke-linecap="round"/>`,
        dog: (p) =>
            path("M12 52V38q0-8 8-10h14q10 0 14 8l4 4v12z", p.c, p) +
            path("M10 36l-4-12 6 3 3 9z", p.c, p) +
            circ(44, 26, 11, p.c, p) +
            path("M36 17l-6 2-1 12 7-3z", p.d, p, 1.5) + path("M50 18l5 3-1 9-6-4z", p.d, p, 1.5) +
            ell(50, 31, 6, 4.5, p.l, p, 1.6) + dot(53, 30, 2) + dot(44, 24, 2) + dot(44.7, 23.3, .6, W) +
            line("M20 52V46M32 52V46", p, 2),
        ship: (p) =>
            path("M5 38h54l-9 14H15z", p.c, p) +
            rect(20, 27, 24, 11, W, p, 2) + rect(36, 29, 10, 6, GLASS, p, 1, 1.4) +
            rect(26, 15, 10, 12, p.c, p, 2) + `<path d="M26 20h10" stroke="${W}" stroke-width="2"/>` +
            `<path d="M32 12q-4-4 0-8q-2 4 2 6" fill="none" stroke="#aaa" stroke-width="2" stroke-linecap="round"/>` +
            dot(22, 32, 1.7, GLASS) + dot(28, 32, 1.7, GLASS) +
            line("M3 56q5-3 10 0t10 0t10 0t10 0t10 0t10 0", p, 1.5),
        boot: (p) =>
            path("M18 6h18v24l14 6q8 3 8 11v4H16z", p.c, p) +
            path("M16 47h42v6q0 2-2 2H18q-2 0-2-2z", INK, p, 1.8) +
            line("M18 14h16M18 21h16M18 28h16", p, 1.8) +
            `<path d="M21 9v36" stroke="${p.l}" stroke-width="3" stroke-linecap="round"/>`,
        cat: (p) =>
            path("M44 52q12 0 12-12q0-8-6-8", "none", p, 4.5) +
            path("M14 52q-2-22 18-22t18 22z", p.c, p) +
            circ(32, 24, 12, p.c, p) +
            path("M21 17l-2-12 10 6zM43 17l2-12-10 6z", p.c, p) +
            path("M22 14l-1-5 5 3zM42 14l1-5-5 3z", W, p, 1) +
            `<ellipse cx="27.5" cy="24" rx="2" ry="2.8" fill="${INK}"/><ellipse cx="36.5" cy="24" rx="2" ry="2.8" fill="${INK}"/>` +
            path("M30.5 28.5h3l-1.5 2z", "#ff8aa0", p, 1) +
            line("M20 28l-8-1.5M20 31l-8 2M44 28l8-1.5M44 31l8 2", p, 1.2),
        thimble: (p) =>
            path("M15 53l3-25q0-17 14-17t14 17l3 25z", p.c, p) +
            rect(13, 47, 38, 8, p.d, p, 2, 1.8) +
            [0, 1, 2].map((r) => [0, 1, 2, 3].map((k) => dot(24 + k * 5.3 - (r % 2) * 2.6, 22 + r * 8, 1.5, p.d)).join("")).join("") +
            `<path d="M21 28q1-12 6-14" stroke="${p.l}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
        wheelbarrow: (p) =>
            path("M8 24h38l-6 18H17z", p.c, p) +
            line("M8 24L3 16M46 24l10-6M40 42l8 12M17 42l-5 12", p, 2.5) +
            wheel(50, 48, 8, p) +
            `<path d="M12 28h30" stroke="${p.l}" stroke-width="2.5" stroke-linecap="round"/>`,
    },
    thailand: {
        "tuk-tuk": (p) =>
            path("M8 20q0-8 8-8h22q8 0 10 8z", p.c, p) +
            path("M10 20h40v24H14q-4 0-4-4z", GOLD, p) +
            path("M14 22h14v10H14zM32 22h14v10H32z", GLASS, p, 1.4) +
            path("M50 28h6q3 1 3 4v10H50z", p.c, p) +
            line("M10 20v6", p, 2) + wheel(18, 46, 7, p) + wheel(48, 46, 6, p),
        elephant: (p) =>
            path("M14 48V30q0-12 14-12h12q14 0 14 14v16h-9V40H34v8h-9V40h-2v8z", p.c, p) +
            circ(46, 24, 11, p.c, p) +
            path("M54 28q6 6 2 18q-1 5-5 3", "none", p, 6) + path("M54 28q6 6 2 18q-1 5-5 3", "none", { ...p, d: p.c }, 3) +
            ell(37, 28, 7, 10, p.l, p, 1.8) +
            path("M51 36q4 3 8 1", "none", { ...p, d: W }, 3) +
            dot(49, 21, 1.8) + line("M14 34q-6 4-4 12", p, 2.5),
        "longtail-boat": (p) =>
            path("M4 36q6-2 14 4h30l10-8q-2 14-12 16H18q-10 0-14-12z", p.c, p) +
            path("M20 38V26h20v12", GOLD, p, 2) + path("M17 26h26l-4-6H21z", p.c, p) +
            line("M48 38l10-16", p, 2.5) + circ(58, 21, 3, GOLD, p, 1.6) +
            line("M2 54q6-4 12 0t12 0t12 0t12 0t12 0", { ...p, d: "#3d8fd1" }, 2.5),
        durian: (p) => {
            let sp = "";
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                const cx = 32 + Math.cos(a) * 17, cy = 34 + Math.sin(a) * 20;
                const ox = 32 + Math.cos(a) * 24, oy = 34 + Math.sin(a) * 27;
                const tx = -Math.sin(a) * 4, ty = Math.cos(a) * 4;
                sp += `M${(cx + tx).toFixed(1)} ${(cy + ty).toFixed(1)}L${ox.toFixed(1)} ${oy.toFixed(1)}L${(cx - tx).toFixed(1)} ${(cy - ty).toFixed(1)}z`;
            }
            return path(sp, p.d, p, 1.5) + ell(32, 34, 19, 22, p.c, p) +
                `<path d="M22 20q-4 14 2 26M32 14v40M42 20q4 14-2 26" fill="none" stroke="${p.d}" stroke-width="1.6" opacity=".55"/>` +
                `<path d="M22 24q2-6 6-8" stroke="${p.l}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
                line("M32 12v-6", p, 3);
        },
        songthaew: (p) =>
            path("M4 24h42v22H4z", p.c, p) + path("M46 28h8l6 8v10H46z", p.c, p) +
            path("M8 29h8v7H8zM20 29h8v7h-8zM32 29h8v7h-8z", GLASS, p, 1.3) + path("M49 31h4l3 5h-7z", GLASS, p, 1.3) +
            path("M4 24q0-6 6-6h30q6 0 6 6z", GOLD, p, 2) +
            wheel(16, 48, 6.5, p) + wheel(50, 48, 6.5, p),
        chedi: (p) =>
            rect(10, 50, 44, 6, GOLD, p, 1.5) + rect(15, 44, 34, 7, p.c, p, 1.5) + rect(20, 38, 24, 7, GOLD, p, 1.5) +
            path("M22 38q-2-14 10-18q12 4 10 18z", p.c, p) +
            rect(27, 12, 10, 8, GOLD, p, 1) + path("M32 3l4 9h-8z", p.c, p, 1.8) +
            `<path d="M26 34q0-8 4-12" stroke="${p.l}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
        "mango-sticky-rice": (p) =>
            path("M6 40h52q-2 14-26 14T6 40z", p.c, p) +
            path("M12 40q0-14 20-14t20 14z", W, p, 2) +
            [[22, 34], [30, 30], [38, 33], [44, 37], [27, 37]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3" ry="1.8" fill="#f1eadf"/>`).join("") +
            path("M14 28q8-14 22-6q-4 10-22 6z", "#ffb52e", p, 1.8) +
            path("M30 24q10-12 22 0q-8 8-22 0z", "#ffc94d", p, 1.8),
        "siamese-cat": (p) =>
            path("M48 54q10-2 8-16", "none", p, 4.5) +
            path("M16 54q-2-20 16-20t16 20z", p.l, p) +
            circ(32, 24, 12, p.l, p) +
            path("M21 17l-3-12 11 6zM43 17l3-12-11 6z", p.d, p) +
            ell(32, 29, 6.5, 5, p.d, p, 1) + `<ellipse cx="27" cy="23" rx="2" ry="1.5" fill="#4aa8ff"/><ellipse cx="37" cy="23" rx="2" ry="1.5" fill="#4aa8ff"/>` +
            dot(32, 27.5, 1.2, W) + path("M16 54h12M36 54h12", "none", p, 4),
    },
    space: {
        rocket: (p) =>
            path("M32 4q12 10 12 28v14H20V32Q20 14 32 4z", W, p) +
            path("M20 34L8 48l12-3zM44 34l12 14-12-3z", p.c, p) +
            path("M26 46h12l-3 6h-6z", p.d, p, 1.5) +
            path("M28 52q4 10 8 0z", "#ffb52e", p, 1.5) +
            circ(32, 24, 5.5, GLASS, p) + path("M23 14q9-8 18 0q-9-2-18 0z", p.c, p, 1.2) + rect(20, 38, 24, 5, p.c, p, 1, 1.8),
        ufo: (p) =>
            path("M20 28q0-14 12-14t12 14z", GLASS, p) +
            ell(32, 33, 26, 9, p.c, p) +
            [14, 24, 32, 40, 50].map((x, i) => dot(x, 34 + (i === 2 ? 2 : i % 2 ? 1 : 0), 2, i % 2 ? GOLD : W)).join("") +
            path("M25 42l-5 14h24l-5-14z", "#ffffff", { ...p, d: "none" }, 0).replace('fill="#ffffff"', 'fill="#ffffff" opacity=".35"'),
        astronaut: (p) =>
            rect(14, 24, 8, 18, p.d, p, 2) +
            path("M20 26h24v20q0 4-4 4H24q-4 0-4-4z", p.c, p) +
            line("M20 32l-8 8M44 32l8 8", p, 6) + line("M20 32l-8 8M44 32l8 8", { ...p, d: W }, 3) +
            rect(22, 50, 8, 8, W, p, 2) + rect(34, 50, 8, 8, W, p, 2) +
            circ(32, 16, 12, W, p) + ell(32, 16, 8, 6.5, "#27324d", p, 1.6) + `<path d="M27 14q3-3 7-1" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7"/>` +
            rect(28, 33, 8, 6, W, p, 1, 1.5),
        satellite: (p) =>
            rect(24, 22, 16, 20, p.c, p, 3) +
            rect(2, 26, 18, 12, "#2f6fcb", p, 1.2) + rect(44, 26, 18, 12, "#2f6fcb", p, 1.2) +
            `<path d="M8 26v12M14 26v12M50 26v12M56 26v12M2 32h18M44 32h18" stroke="${p.d}" stroke-width="1" opacity=".7"/>` +
            line("M20 32h4M40 32h4", p, 2) +
            line("M32 22v-8M26 12q6-6 12 0", p, 2.5) + dot(32, 14, 2.4, GOLD) +
            circ(32, 32, 4, GLASS, p, 1.6),
        comet: (p) =>
            path("M44 12Q12 18 6 56Q22 34 46 28z", p.l, p) +
            path("M46 22Q24 30 14 48Q30 36 46 32z", W, { ...p, d: "none" }, 0).replace('fill="#ffffff"', 'fill="#ffffff" opacity=".5"') +
            circ(44, 24, 13, p.c, p) + dot(40, 20, 3, p.l) + dot(49, 28, 2.2, p.d) + dot(41, 29, 1.6, p.d),
        alien: (p) =>
            path("M32 6q22 0 22 24q0 14-14 22h-16q-14-8-14-22q0-24 22-24z", p.c, p) +
            path("M14 28q4 10 14 6q-2-10-14-6zM50 28q-4 10-14 6q2-10 14-6z", INK, p, 1.5) +
            dot(21, 30, 1.5, W) + dot(43, 30, 1.5, W) +
            line("M28 44q4 2 8 0", p, 1.8) + line("M24 8L20 0M40 8l4-8", p, 2) + dot(20, 1.5, 2.5, GOLD) + dot(44, 1.5, 2.5, GOLD),
        rover: (p) =>
            path("M10 26h34l6 12H6z", p.c, p) +
            path("M16 28h10v7H14z", GLASS, p, 1.3) +
            line("M34 26l8-12h8", p, 2.5) + rect(48, 10, 8, 6, W, p, 1, 1.6) + line("M16 26l-4-10", p, 2) + dot(12, 14, 2, GOLD) +
            [14, 32, 50].map((x) => wheel(x, 47, 6, p)).join("") + line("M14 40v1M32 40v1M50 40v1", p, 2),
        "space-station": (p) =>
            rect(24, 24, 16, 16, p.c, p, 4) + rect(8, 28, 48, 8, W, p, 2, 1.8) +
            rect(2, 8, 14, 16, "#2f6fcb", p, 1) + rect(48, 8, 14, 16, "#2f6fcb", p, 1) +
            rect(2, 40, 14, 16, "#2f6fcb", p, 1) + rect(48, 40, 14, 16, "#2f6fcb", p, 1) +
            circ(32, 32, 5, GLASS, p, 1.6) + `<path d="M4 16h10M50 16h10M4 48h10M50 48h10" stroke="${p.d}" stroke-width=".9"/>`,
    },
    fantasy: {
        dragon: (p) =>
            path("M10 44q-2-10 8-14l10-2q10-10 14-14l-3-8 8 4q10 2 10 12l-6 4q-4 12-12 16l-6 6H14z", p.c, p) +
            path("M22 30L14 8l18 12zM30 28l8-20 6 14z", p.d, p, 1.8) +
            path("M10 46q-8 2-6-8", "none", p, 4.5) + path("M44 14l8-8 2 8z", W, p, 1.2) +
            dot(46, 20, 1.8) + path("M52 24l5 1-3 3z", "#ff7a2e", p, 1.2) + path("M20 52v-6M34 52v-6", "none", p, 4),
        "wizard-hat": (p) =>
            ell(32, 48, 27, 7, p.c, p) +
            path("M14 47q4-14 10-26q4-12 16-16q-2 8 2 18q4 12 8 24q-18 6-36 0z", p.c, p) +
            `<path d="M17 40q15 5 30 0" fill="none" stroke="${GOLD}" stroke-width="4"/>` +
            path("M30 28l1.4 3 3.2.3-2.4 2.1.7 3.2-2.9-1.7-2.9 1.7.7-3.2-2.4-2.1 3.2-.3z", GOLD, p, 1),
        sword: (p) =>
            path("M52 6l6 6-22 28-8-8z", "#d9dde6", p) + `<path d="M50 10l-18 22" stroke="#fff" stroke-width="1.5" opacity=".8"/>` +
            path("M24 28l12 12-4 4-12-12z", p.c, p) + line("M24 34l-10 10", p, 5) + line("M24 34l-10 10", { ...p, d: p.c }, 2.5) +
            circ(12, 46, 4.5, GOLD, p) + line("M8 56l6-6", p, 3),
        shield: (p) =>
            path("M32 6l22 6v18q0 18-22 28Q10 48 10 30V12z", p.c, p, 2.6) +
            path("M32 12l16 4.5v13q0 12-16 20Q16 41 16 29.5v-13z", p.l, p, 1.6) +
            path("M30 20h4v8h8v4h-8v12h-4V32h-8v-4h8z", W, p, 1.6),
        potion: (p) =>
            rect(26, 6, 12, 6, "#a8743f", p, 2) + path("M27 12h10v10q14 4 14 20q0 14-19 14T13 42q0-16 14-20z", "#e9f6ff", p) +
            path("M16 38q16-6 32 0q2 18-16 18T16 38z", p.c, p, 1.6) +
            dot(26, 46, 2, W) + dot(36, 42, 1.5, W) + dot(38, 50, 2.2, W) + `<path d="M20 34q-2 4-1 8" stroke="#fff" stroke-width="2" fill="none" opacity=".8" stroke-linecap="round"/>`,
        crown: (p) =>
            path("M8 46L6 16l16 14L32 8l10 22L58 16l-2 30z", p.c, p) +
            rect(8, 46, 48, 8, GOLD, p, 2) +
            dot(6, 15, 3.2, W) + dot(32, 8, 3.2, W) + dot(58, 15, 3.2, W) +
            circ(32, 38, 3.5, "#e23d4a", p, 1.4) + circ(18, 38, 2.6, "#3d8fd1", p, 1.2) + circ(46, 38, 2.6, "#3d8fd1", p, 1.2),
        unicorn: (p) =>
            path("M16 56l2-22q-4-6 2-14l12-6q4-8 12-6l4 10q6 4 4 14l-10 8-2 16z", p.c, p) +
            path("M42 14l6-12 4 14z", GOLD, p, 1.8) +
            path("M26 14q-10 6-10 20q4-8 12-10q2-8-2-10z", p.d, p, 1.5) +
            path("M24 20q-8 8-4 24", "none", { ...p, d: GOLD }, 3) +
            dot(46, 22, 1.8) + path("M50 30l4 2", "none", p, 2),
        castle: (p) =>
            path("M6 54V22h8v-6h4v6h4v-6h4v6h4v-6h4v6h4v-6h4v6h8v32z", p.c, p, 2) +
            path("M6 54V22h12v32zM46 54V22h12v32z", p.l, p, 2).replace(/fill="[^"]+"/, `fill="${p.c}"`) +
            path("M24 54V40q0-6 8-6t8 6v14z", INK, p, 1.8) +
            rect(10, 28, 4, 8, INK, p, 1, 1) + rect(50, 28, 4, 8, INK, p, 1, 1) +
            line("M12 16V6l7 3-7 3", p, 2) + line("M52 16V6l-7 3 7 3", p, 2),
    },
};

function pawn(p: Pal): string {
    return circ(32, 18, 9, p.c, p) + path("M32 26q-12 14-14 26h28q-2-12-14-26z", p.c, p) + ell(32, 53, 17, 5, p.c, p) +
        `<path d="M27 15q1-4 5-4" stroke="${p.l}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
}

function tokenInner(artTheme: string, tokenId: string, color: string): string {
    const p: Pal = { c: color, d: shade(color, -0.6), l: shade(color, 0.45) };
    const draw = TOKENS[artTheme]?.[tokenId] ?? findAny(tokenId) ?? pawn;
    return (
        `<ellipse cx="32" cy="57.5" rx="22" ry="4.5" fill="#000" opacity=".12"/>` +
        `<ellipse cx="32" cy="57.5" rx="17" ry="3.2" fill="#000" opacity=".2"/>` +
        draw(p)
    );
}

/**
 * Standalone token image: sticker style so it pops on any tile. A white halo
 * (dilated silhouette) and a drop shadow surround the drawing, which sits on a
 * white pedestal ringed in the player's color. The drawing is scaled to 84%
 * inside the 64x64 box so the halo isn't clipped.
 */
export function tokenSvgFor(artTheme: string, tokenId: string, color: string): string {
    const p: Pal = { c: color, d: shade(color, -0.6), l: shade(color, 0.45) };
    const draw = TOKENS[artTheme]?.[tokenId] ?? findAny(tokenId) ?? pawn;
    const filter =
        `<filter id="h" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
        `<feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="d"/>` +
        `<feFlood flood-color="#fff" result="w"/><feComposite in="w" in2="d" operator="in" result="halo"/>` +
        `<feDropShadow in="halo" dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".45" result="sh"/>` +
        `<feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    const pedestal =
        `<ellipse cx="32" cy="58.5" rx="23" ry="6.5" fill="#000" opacity=".25"/>` +
        `<ellipse cx="32" cy="57" rx="23" ry="6.5" fill="#fff" stroke="${color}" stroke-width="3"/>`;
    // Scale about the bottom centre so the figure keeps standing on the pedestal.
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
        `<defs>${filter}</defs>` +
        `<g transform="translate(32 58) scale(.86) translate(-32 -58)">` +
        pedestal +
        `<g transform="translate(0 -3)" filter="url(#h)">${draw(p)}</g>` +
        `</g></svg>`
    );
}

/** Token as a <g> placed at (x,y) with the given pixel size (for composing larger SVGs). */
export function tokenGroup(artTheme: string, tokenId: string, color: string, x: number, y: number, size: number): string {
    return `<g transform="translate(${x} ${y}) scale(${Math.round((size / 64) * 1000) / 1000})">${tokenInner(artTheme, tokenId, color)}</g>`;
}

function findAny(id: string): Draw | undefined {
    for (const t of Object.values(TOKENS)) if (t[id]) return t[id];
    return undefined;
}

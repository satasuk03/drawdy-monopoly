const PIPS: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export function diceFaceSvg(value: number, palette: { face: string; pip: string } = { face: "#ffffff", pip: "#1f1d2b" }): string {
    const v = Math.min(6, Math.max(1, Math.round(value) || 1));
    const pips = PIPS[v]!
        .map(([x, y]) => {
            const cx = 31 + x * 15;
            const cy = 31 + y * 15;
            const r = v === 1 ? 9 : 5.8;
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.pip}"/><circle cx="${cx - r * 0.35}" cy="${cy - r * 0.4}" r="${r * 0.25}" fill="#fff" opacity=".45"/>`;
        })
        .join("");
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
        `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.face}"/><stop offset="1" stop-color="#dcdbe8"/></linearGradient></defs>` +
        `<rect x="6" y="8" width="54" height="54" rx="12" fill="#000" opacity=".2"/>` +
        `<rect x="4" y="4" width="54" height="54" rx="12" fill="url(#f)" stroke="#8c8aa0" stroke-width="2"/>` +
        `<rect x="6.5" y="6.5" width="49" height="49" rx="10" fill="none" stroke="#fff" stroke-width="1.6" opacity=".8"/>` +
        pips +
        `</svg>`
    );
}

/** Soft elliptical floor shadow under a die (64x32). Fades to transparent at the edge. */
export function diceShadowSvg(): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" width="64" height="32">` +
        `<defs><radialGradient id="s"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".6" stop-color="#000" stop-opacity=".25"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
        `<ellipse cx="32" cy="16" rx="32" ry="16" fill="url(#s)"/>` +
        `</svg>`
    );
}

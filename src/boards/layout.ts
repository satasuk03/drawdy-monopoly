// Board geometry in board-local units (1 unit = 1 canvas px at zoom 1).
// The board art (one big SVG) and the scene renderer (tokens, chips, houses)
// both place things with these functions, so they always line up.
//
// Tile 0 (GO) is the bottom-right corner. Play runs clockwise as seen on
// screen: along the bottom to the left, up the left side, along the top to the
// right, down the right side — the classic layout.

export const CORNER = 160;
export const TILE = 100;
export const BOARD = CORNER * 2 + TILE * 9; // 1220
/** Depth of the color bar on property tiles, measured from the inner edge. */
export const COLOR_BAR = 30;

export type Side = "bottom" | "left" | "top" | "right";

export type Rect = { x: number; y: number; width: number; height: number };

export type TilePlacement = {
    index: number;
    rect: Rect;
    /** Which board edge the tile sits on; corners report the side they start. */
    side: Side;
    corner: boolean;
    /**
     * Rotation in degrees that turns "upright" tile art (color bar at top,
     * text reading down) so it faces the board center: bottom 0, left 90,
     * top 180, right 270.
     */
    rotation: number;
};

export function sideOf(index: number): Side {
    if (index < 10) return "bottom";
    if (index < 20) return "left";
    if (index < 30) return "top";
    return "right";
}

export function tilePlacement(index: number): TilePlacement {
    const i = ((index % 40) + 40) % 40;
    const side = sideOf(i);
    const k = i % 10; // 0 = corner, 1..9 along the side
    const corner = k === 0;
    const far = BOARD - CORNER;
    let rect: Rect;
    switch (side) {
        case "bottom":
            rect = corner
                ? { x: far, y: far, width: CORNER, height: CORNER }
                : { x: far - k * TILE, y: far, width: TILE, height: CORNER };
            return { index: i, rect, side, corner, rotation: 0 };
        case "left":
            rect = corner
                ? { x: 0, y: far, width: CORNER, height: CORNER }
                : { x: 0, y: far - k * TILE, width: CORNER, height: TILE };
            return { index: i, rect, side, corner, rotation: 90 };
        case "top":
            rect = corner
                ? { x: 0, y: 0, width: CORNER, height: CORNER }
                : { x: CORNER + (k - 1) * TILE, y: 0, width: TILE, height: CORNER };
            return { index: i, rect, side, corner, rotation: 180 };
        case "right":
            rect = corner
                ? { x: far, y: 0, width: CORNER, height: CORNER }
                : { x: far, y: CORNER + (k - 1) * TILE, width: CORNER, height: TILE };
            return { index: i, rect, side, corner, rotation: 270 };
    }
}

/** The color-bar strip of a property tile (inner edge, facing the center). */
export function colorBarRect(index: number): Rect {
    const { rect, side } = tilePlacement(index);
    switch (side) {
        case "bottom":
            return { x: rect.x, y: rect.y, width: rect.width, height: COLOR_BAR };
        case "top":
            return { x: rect.x, y: rect.y + rect.height - COLOR_BAR, width: rect.width, height: COLOR_BAR };
        case "left":
            return { x: rect.x + rect.width - COLOR_BAR, y: rect.y, width: COLOR_BAR, height: rect.height };
        case "right":
            return { x: rect.x, y: rect.y, width: COLOR_BAR, height: rect.height };
    }
}

/** Band along the outer edge of a tile where the owner's marker goes. */
export function ownerChipRect(index: number): Rect {
    const { rect, side } = tilePlacement(index);
    const d = 18;
    const inset = 6;
    switch (side) {
        case "bottom":
            return { x: rect.x + inset, y: rect.y + rect.height - d - 4, width: rect.width - inset * 2, height: d };
        case "top":
            return { x: rect.x + inset, y: rect.y + 4, width: rect.width - inset * 2, height: d };
        case "left":
            return { x: rect.x + 4, y: rect.y + inset, width: d, height: rect.height - inset * 2 };
        case "right":
            return { x: rect.x + rect.width - d - 4, y: rect.y + inset, width: d, height: rect.height - inset * 2 };
    }
}

/** Slots for up to 5 buildings (4 houses or 1 hotel) inside the color bar. */
export function buildingSlots(index: number): Rect[] {
    const bar = colorBarRect(index);
    const size = 18;
    const horizontal = bar.width > bar.height;
    const slots: Rect[] = [];
    for (let n = 0; n < 4; n++) {
        const along = 6 + n * (size + 4);
        slots.push(
            horizontal
                ? { x: bar.x + along, y: bar.y + (bar.height - size) / 2, width: size, height: size }
                : { x: bar.x + (bar.width - size) / 2, y: bar.y + along, width: size, height: size }
        );
    }
    return slots;
}

/** One hotel, centered in the color bar. */
export function hotelSlot(index: number): Rect {
    const bar = colorBarRect(index);
    const horizontal = bar.width > bar.height;
    const w = horizontal ? 44 : 22;
    const h = horizontal ? 22 : 44;
    return { x: bar.x + (bar.width - w) / 2, y: bar.y + (bar.height - h) / 2, width: w, height: h };
}

/** Largest token size (a token standing alone). */
export const TOKEN_SIZE = 64;

/** Token edge length when `count` tokens share a tile: fewer tokens, bigger tokens. */
export function tokenSize(count: number): number {
    if (count <= 1) return 64;
    if (count === 2) return 58;
    if (count <= 4) return 50;
    return 44;
}

/** The part of a tile outside the color bar, where tokens stand. Corners are used whole. */
function tileBody(index: number): Rect {
    const { rect, side, corner } = tilePlacement(index);
    if (corner) return rect;
    switch (side) {
        case "bottom":
            return { x: rect.x, y: rect.y + COLOR_BAR, width: rect.width, height: rect.height - COLOR_BAR };
        case "top":
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height - COLOR_BAR };
        case "left":
            return { x: rect.x, y: rect.y, width: rect.width - COLOR_BAR, height: rect.height };
        case "right":
            return { x: rect.x + COLOR_BAR, y: rect.y, width: rect.width - COLOR_BAR, height: rect.height };
    }
}

/** Square of size `s` centered on (cx, cy), pushed inside `within`. */
function squareAt(cx: number, cy: number, s: number, within: Rect): Rect {
    const x = Math.min(Math.max(cx - s / 2, within.x), within.x + within.width - s);
    const y = Math.min(Math.max(cy - s / 2, within.y), within.y + within.height - s);
    return { x, y, width: s, height: s };
}

/**
 * Where token `slot` (0..5, the n-th of `count` tokens standing together on
 * this tile) goes. One token is centered; more spread out over the tile body
 * (2 along its long axis, 3–4 as 2×2, 5–6 as 2×3; corners use a 3-column grid).
 * On tile 10, `jailed` tokens sit in the cell (upper-right of the corner),
 * visitors along the outer L.
 */
export function tokenRect(index: number, slot: number, jailed = false, count = 1): Rect {
    const tile = tilePlacement(index).rect;
    const n = Math.max(1, Math.min(6, count));
    const k = Math.min(Math.max(slot, 0), n - 1);
    let s = tokenSize(n);
    if (index === 10) {
        if (jailed) {
            // Cell interior is x 54..152, y 28..116 (below the label).
            if (n > 1) s = Math.min(s, 46);
            const cols = n === 1 ? 1 : 2;
            const rows = Math.ceil(n / cols);
            const col = k % cols;
            const row = Math.floor(k / cols);
            const cx = tile.x + 103 + (cols === 1 ? 0 : (col - 0.5) * s * 1.05);
            const cy = tile.y + 68 + (row - (rows - 1) / 2) * s * 0.7;
            return squareAt(cx, cy, s, tile);
        }
        // Visiting: the L-shaped strip (44 wide) along the left and bottom edges.
        s = Math.min(s, 46);
        const left = tile.x + (44 - s) / 2;
        const bottom = tile.y + 116 + (44 - s) / 2;
        const pitch = s * 0.95;
        const m = Math.ceil(k / 2); // 0 = the corner, then alternately up the left strip and along the bottom
        const x = k % 2 === 0 ? left + m * pitch : left;
        const y = k % 2 === 1 ? bottom - m * pitch : bottom;
        return squareAt(x + s / 2, y + s / 2, s, tile);
    }

    const body = tileBody(index);
    const cx = body.x + body.width / 2;
    const cy = body.y + body.height / 2;
    if (n === 1) return squareAt(cx, cy, s, tile);

    if (tilePlacement(index).corner) {
        // 3-column grid, rows centered; a short last row is centered too.
        const rows = Math.ceil(n / 3);
        const row = Math.floor(k / 3);
        const inRow = Math.min(3, n - row * 3);
        const pitch = 54;
        return squareAt(cx + ((k % 3) - (inRow - 1) / 2) * pitch, cy + (row - (rows - 1) / 2) * pitch, s, tile);
    }

    // Side tile: lay out on (across, along) axes, `along` = the body's long axis.
    const horizontal = body.width > body.height; // left/right tiles run along x
    const across = horizontal ? body.height : body.width;
    const along = horizontal ? body.width : body.height;
    let u: number; // position across the tile
    let v: number; // position along the tile
    if (n === 2) {
        u = across / 2;
        v = along * (k === 0 ? 0.25 : 0.75);
    } else {
        const lines = n <= 4 ? 2 : 3;
        u = across * (0.26 + 0.48 * (k % 2));
        v = along * ((Math.floor(k / 2) + 0.5) / lines);
    }
    return horizontal
        ? squareAt(body.x + v, body.y + u, s, tile)
        : squareAt(body.x + u, body.y + v, s, tile);
}

/** The open center of the board. */
export const CENTER: Rect = { x: CORNER, y: CORNER, width: TILE * 9, height: TILE * 9 };

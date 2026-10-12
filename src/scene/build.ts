// What the canvas *should* look like for a GameState: a flat list of element
// specs with deterministic ids. Pure (no Drawdy calls), so every authority —
// including one that just took over — computes the same ids and can find and
// fix what a previous authority drew.
//
// Ids are content-addressed where content can't be updated in place (Drawdy
// can't change text or component schemas): a scoreboard row's id includes a
// hash of its text, a die's id includes its value and roll. When content
// changes, the id changes, and the reconciler removes the old element and
// adds the new one (owner markers too). Things that only change position
// (tokens) keep their id and are updated.

import type {
    DomElementSchema,
    DrawdyElementSchema,
    LocalAnimation,
    UpdateableProperties,
} from "@drawdy/driver-protocol";
import { boardSvg, diceFaceSvg, diceShadowSvg, hotelSvg, houseSvg, ownerBadgeSvg, svgDataUrl, tokenSvg, turnRingSvg } from "../art/index";
import { formatMoney, type BoardDef } from "../boards/types";
import { ts } from "../i18n/scene";
import {
    BOARD,
    CENTER,
    buildingSlots,
    hotelSlot,
    ownerChipRect,
    tokenRect,
    type Rect,
} from "../boards/layout";
import type { GameState, Player } from "../engine/types";
import { frameElementId, META_KEY, sceneElementId, shortHash, type GameEnvelope } from "../sync/envelope";

/** Frame padding around the board. Frame (x, y) = board origin − PAD. */
export const PAD = 40;
export const PANEL_GAP = 40;
export const PANEL_W = 400;
export const DIE_SIZE = 72;

export type Point = { x: number; y: number };

export function frameRect(origin: Point): Rect {
    return {
        x: origin.x - PAD,
        y: origin.y - PAD,
        width: PAD + BOARD + PANEL_GAP + PANEL_W + PAD,
        height: PAD + BOARD + PAD,
    };
}

export function originFromFrame(frameX: number, frameY: number): Point {
    return { x: frameX + PAD, y: frameY + PAD };
}

export function boardRect(origin: Point): Rect {
    return { x: origin.x, y: origin.y, width: BOARD, height: BOARD };
}

function offset(r: Rect, o: Point): Rect {
    return { x: r.x + o.x, y: r.y + o.y, width: r.width, height: r.height };
}

export type SpecRole = "board" | "chip" | "building" | "token" | "turn-ring" | "die-shadow" | "die" | "panel" | "score";

/** Live properties: what update-drawdy-elements accepts (width/height resize components, absent from older typings). */
export type LiveProps = UpdateableProperties & { width?: number; height?: number };

/** One element the renderer wants on the canvas. */
export type ElementSpec = {
    id: string;
    role: SpecRole;
    /** Used to create it (frameId already set). */
    schema: DrawdyElementSchema;
    /** Live properties enforced on every pass (style / position). Compared by JSON to skip no-op updates. */
    props: LiveProps;
    /** For tokens and the turn ring: the seat, so moves can be animated. */
    seat?: number;
    /** For dice and their shadows: which die (0 or 1), so each gets its own throw. */
    die?: 0 | 1;
    /** For scoreboard text: which line it is (with `seat` for player rows), so a change can be animated. */
    part?: "status" | "name" | "detail" | "footer";
    /** For buildings: the slot on the tile, so several placed at once drop in one after another. */
    slot?: number;
    /** For owner chips: the tile, so an ownership change can be animated. */
    tile?: number;
};

export function propsKey(props: LiveProps): string {
    return JSON.stringify(props);
}

// ---------------------------------------------------------------------------
// helpers

function imageSchema(url: string, w: number, h: number): DomElementSchema {
    return {
        type: "image",
        child: url,
        // Pointer events off: the art is decoration; the frame is what users select.
        styles: { width: [w, "px"], height: [h, "px"], pointerEvents: "none" },
    };
}

function imageComponent(id: string, frameId: string, r: Rect, url: string): DrawdyElementSchema {
    return {
        type: "component",
        drawdyElementId: id,
        frameId,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        schema: imageSchema(url, r.width, r.height),
    };
}

function textEl(id: string, frameId: string, x: number, y: number, text: string, fontSize: number, color: string): DrawdyElementSchema {
    return { type: "text", drawdyElementId: id, frameId, x, y, text, fontSize, color, textAlign: "left" };
}

function isOwnable(board: BoardDef, i: number): boolean {
    const k = board.tiles[i]?.kind;
    return k === "property" || k === "railroad" || k === "utility";
}

export function tileName(board: BoardDef, i: number): string {
    return board.tiles[i]?.name ?? ts(board.lang, "tile", { n: i });
}

function playerName(board: BoardDef, state: GameState, seat: number | null | undefined): string {
    if (seat === null || seat === undefined) return ts(board.lang, "nobody");
    return state.players[seat]?.name || ts(board.lang, "player", { n: seat + 1 });
}

/** One-line status for the frame name and the scoreboard. */
export function statusText(board: BoardDef, state: GameState): string {
    const ph = state.phase;
    const lang = board.lang;
    const cur = playerName(board, state, state.current);
    switch (ph.kind) {
        case "lobby": {
            const n = state.players.length;
            return ts(lang, n === 1 ? "lobbyOne" : "lobbyMany", { n });
        }
        case "pre-roll":
            return ts(lang, "turn", { name: cur });
        case "post-roll":
            return ts(lang, ph.rollAgain ? "doubles" : "turn", { name: cur });
        case "buy-decision":
            return ts(lang, "considering", { name: cur, tile: tileName(board, ph.tile) });
        case "auction":
            return ts(lang, "auction", { tile: tileName(board, ph.auction.tile) });
        case "debt":
            return ts(lang, "mustRaise", { name: playerName(board, state, ph.debt.debtor), amount: formatMoney(board, ph.debt.amount) });
        case "game-over":
            return ph.winner === null ? ts(lang, "gameOver") : ts(lang, "wins", { name: playerName(board, state, ph.winner) });
    }
}

export function frameTitle(board: BoardDef, state: GameState): string {
    return `Board Tycoon · ${board.name} — ${statusText(board, state)}`;
}

/** Id of the latest dice log entry: makes each roll fresh dice elements, and seeds their throw. */
export function rollKey(state: GameState): number {
    for (let i = state.log.length - 1; i >= 0; i--) {
        const e = state.log[i];
        if (e && e.tone === "dice") return e.id;
    }
    return 0;
}

export type TokenSlot = { tile: number; slot: number; jailed: boolean; /** Tokens sharing this tile group. */ count: number };

/** Slot (0..5) of each active player on their tile; jailed and visiting tokens on 10 are separate groups. */
export function tokenSlots(state: GameState): Map<number, TokenSlot> {
    const counts = new Map<string, number>();
    const out = new Map<number, TokenSlot>();
    const keyOf = (s: { tile: number; jailed: boolean }) => `${s.tile}:${s.jailed ? 1 : 0}`;
    for (const p of state.players) {
        if (p.bankrupt) continue;
        const jailed = p.inJail;
        const tile = jailed ? 10 : p.position;
        const key = keyOf({ tile, jailed });
        const slot = counts.get(key) ?? 0;
        counts.set(key, slot + 1);
        out.set(p.seat, { tile, slot, jailed, count: 0 });
    }
    for (const s of out.values()) s.count = counts.get(keyOf(s)) ?? 1;
    return out;
}

export function tokenElementId(gameId: string, p: Player): string {
    return sceneElementId(gameId, "tok", p.seat, shortHash(`${p.token}|${p.color}`));
}

export function tokenPosition(origin: Point, tile: number, slot: number, jailed: boolean, count = 1): Point {
    const r = tokenRect(tile, slot, jailed, count);
    return { x: r.x + origin.x, y: r.y + origin.y };
}

export function turnRingId(gameId: string, p: Player): string {
    return sceneElementId(gameId, "ring", p.seat, shortHash(p.color));
}

/** The ring is a bit larger than the token and centered on it. */
export function turnRingRect(token: Rect): Rect {
    const size = Math.round(token.width * 1.4 * 10) / 10;
    return { x: token.x + (token.width - size) / 2, y: token.y + (token.height - size) / 2, width: size, height: size };
}

// ---------------------------------------------------------------------------
// the scene

// "board-img", not "board": the art used to be a component, which Drawdy
// draws smaller than its box when zoomed out. A new id makes the renderer
// rebuild the stack on games drawn before the switch.
export function boardArtId(gameId: string): string {
    return sceneElementId(gameId, "board-img");
}

/** Everything the renderer draws for `state` (not the frame, not intent elements). Order = z-order for adds. */
export function desiredScene(board: BoardDef, state: GameState, origin: Point): ElementSpec[] {
    const gameId = state.gameId;
    const frameId = frameElementId(gameId);
    const specs: ElementSpec[] = [];
    const pal = board.palette;

    // Board art: a native image, so it scales with the canvas at every zoom.
    // Components still draw above it.
    const art = boardRect(origin);
    specs.push({
        id: boardArtId(gameId),
        role: "board",
        schema: {
            type: "image",
            drawdyElementId: boardArtId(gameId),
            frameId,
            x: art.x,
            y: art.y,
            width: art.width,
            height: art.height,
            url: svgDataUrl(boardSvg(board)),
        },
        props: {},
    });

    // Owner markers: an image component per owned tile (components draw above
    // the board art; plain shapes would sit under it). Content-addressed by
    // owner color and mortgage, so a change swaps the element. Created
    // invisible; the renderer reveals it, stamping it down when it can animate.
    for (let i = 0; i < 40; i++) {
        const own = state.ownership[String(i)];
        if (!own || !isOwnable(board, i)) continue;
        const color = state.players[own.owner]?.color ?? "#888888";
        const id = sceneElementId(gameId, "own", i, shortHash(`${color}|${own.mortgaged ? 1 : 0}`));
        const r = offset(ownerChipRect(i), origin);
        const schema = imageComponent(id, frameId, r, svgDataUrl(ownerBadgeSvg(color, own.mortgaged, r.width, r.height)));
        specs.push({ id, role: "chip", tile: i, schema: { ...schema, opacity: 0 }, props: { opacity: 1 } });
    }

    // Buildings.
    for (const [key, own] of Object.entries(state.ownership)) {
        const tile = Number(key);
        if (!own || own.houses <= 0) continue;
        // Created invisible; the renderer reveals them (dropping them in when it can animate).
        if (own.houses >= 5) {
            const id = sceneElementId(gameId, "hotel", tile);
            const schema = imageComponent(id, frameId, offset(hotelSlot(tile), origin), svgDataUrl(hotelSvg(undefined, hotelSlot(tile).height > hotelSlot(tile).width)));
            specs.push({ id, role: "building", slot: 4, schema: { ...schema, opacity: 0 }, props: { opacity: 1 } });
        } else {
            const slots = buildingSlots(tile);
            for (let n = 0; n < own.houses && n < slots.length; n++) {
                const id = sceneElementId(gameId, "house", tile, n);
                const schema = imageComponent(id, frameId, offset(slots[n]!, origin), svgDataUrl(houseSvg()));
                specs.push({ id, role: "building", slot: n, schema: { ...schema, opacity: 0 }, props: { opacity: 1 } });
            }
        }
    }

    // Tokens.
    const slots = tokenSlots(state);
    for (const p of state.players) {
        const s = slots.get(p.seat);
        if (!s) continue; // bankrupt
        const id = tokenElementId(gameId, p);
        const r = offset(tokenRect(s.tile, s.slot, s.jailed, s.count), origin);
        specs.push({
            id,
            role: "token",
            seat: p.seat,
            schema: imageComponent(id, frameId, r, svgDataUrl(tokenSvg(board, p.token, p.color))),
            props: { transform: { x: r.x, y: r.y }, width: r.width, height: r.height },
        });
    }

    // Turn marker: a pulsing ring around the current player's token (active game only).
    const cur = state.players[state.current];
    const curSlot = cur ? slots.get(cur.seat) : undefined;
    if (cur && curSlot && !cur.bankrupt && state.phase.kind !== "lobby" && state.phase.kind !== "game-over") {
        const id = turnRingId(gameId, cur);
        const r = turnRingRect(offset(tokenRect(curSlot.tile, curSlot.slot, curSlot.jailed, curSlot.count), origin));
        specs.push({
            id,
            role: "turn-ring",
            seat: cur.seat,
            schema: imageComponent(id, frameId, r, svgDataUrl(turnRingSvg(cur.color))),
            props: { transform: { x: r.x, y: r.y }, width: r.width, height: r.height },
        });
    }

    // Dice, centered low in the middle of the board.
    if (state.dice) {
        const rk = rollKey(state);
        const cx = origin.x + CENTER.x + CENTER.width / 2;
        const y = origin.y + CENTER.y + CENTER.height * 0.66;
        const spots = [0, 1].map((i) => ({ x: i === 0 ? cx - DIE_SIZE - 10 : cx + 10, y }));
        // Shadows first so they draw under the dice. Both start invisible: the renderer fades them in.
        state.dice.forEach((v, i) => {
            const id = sceneElementId(gameId, "dshadow", i, v, rk);
            const r = { x: spots[i]!.x - 4, y: spots[i]!.y + DIE_SIZE - 20, width: DIE_SIZE + 8, height: 28 };
            specs.push({
                id,
                role: "die-shadow",
                die: i as 0 | 1,
                schema: { ...imageComponent(id, frameId, r, svgDataUrl(diceShadowSvg())), opacity: 0 },
                props: {},
            });
        });
        state.dice.forEach((v, i) => {
            const id = sceneElementId(gameId, "die", i, v, rk);
            const r = { x: spots[i]!.x, y: spots[i]!.y, width: DIE_SIZE, height: DIE_SIZE };
            specs.push({
                id,
                role: "die",
                die: i as 0 | 1,
                schema: { ...imageComponent(id, frameId, r, svgDataUrl(diceFaceSvg(v))), opacity: 0 },
                props: {},
            });
        });
    }

    // Scoreboard panel.
    const px = origin.x + BOARD + PANEL_GAP;
    const py = origin.y;
    const panelId = sceneElementId(gameId, "panel");
    specs.push({
        id: panelId,
        role: "panel",
        schema: {
            type: "shape",
            componentType: "rect",
            drawdyElementId: panelId,
            frameId,
            x: px,
            y: py,
            width: PANEL_W,
            height: BOARD,
            strokeColor: pal.line,
            fillColor: pal.tileFill,
            strokeWidth: 2,
            fillStyle: "solid",
            cornerRadius: 16,
            roughness: 0,
        },
        props: {},
    });
    const scoreText = (role: string, x: number, y: number, text: string, size: number, color: string, tag: Pick<ElementSpec, "part" | "seat">, ...key: (string | number)[]) => {
        const id = sceneElementId(gameId, role, ...key, shortHash(`${text}|${size}|${color}|${x - origin.x}|${y - origin.y}`));
        specs.push({ id, role: "score", ...tag, schema: textEl(id, frameId, x, y, text, size, color), props: {} });
    };
    scoreText("sbt", px + 24, py + 24, board.name, 30, pal.text, {});
    scoreText("sbs", px + 24, py + 72, statusText(board, state), 18, pal.mutedText, { part: "status" });

    const counts = new Map<number, number>();
    for (const own of Object.values(state.ownership)) counts.set(own.owner, (counts.get(own.owner) ?? 0) + 1);
    const active = state.phase.kind !== "lobby" && state.phase.kind !== "game-over";
    state.players.forEach((p, i) => {
        const y = py + 130 + i * 86;
        const swId = sceneElementId(gameId, "sw", p.seat, shortHash(p.color));
        specs.push({
            id: swId,
            role: "score",
            schema: {
                type: "shape",
                componentType: "circle",
                drawdyElementId: swId,
                frameId,
                x: px + 24,
                y: y + 4,
                width: 26,
                height: 26,
                strokeColor: pal.line,
                fillColor: p.color,
                strokeWidth: 2,
                fillStyle: "solid",
                roughness: 0,
            },
            props: { opacity: p.bankrupt ? 0.35 : 1 },
        });
        const turn = active && state.current === p.seat ? "▶ " : "";
        const name = `${turn}${p.name || ts(board.lang, "player", { n: p.seat + 1 })}${p.bankrupt ? ts(board.lang, "bankruptTag") : ""}`;
        scoreText("sbn", px + 64, y, name, 24, p.color, { part: "name", seat: p.seat }, p.seat);
        const n = counts.get(p.seat) ?? 0;
        const extras: string[] = [];
        if (p.inJail) extras.push(board.labels.jail);
        const cards = p.jailCards.chance + p.jailCards.chest;
        if (cards > 0) extras.push(ts(board.lang, cards === 1 ? "jailCardsOne" : "jailCardsMany", { n: cards }));
        const detail = p.bankrupt
            ? ts(board.lang, "outOfGame")
            : [formatMoney(board, p.cash), ts(board.lang, n === 1 ? "propsOne" : "propsMany", { n }), ...extras].join(" · ");
        scoreText("sbd", px + 64, y + 34, detail, 18, pal.text, { part: "detail", seat: p.seat }, p.seat);
    });

    const footer = [ts(board.lang, "round", { n: state.round + 1 })];
    if (state.settings.freeParkingJackpot) footer.push(ts(board.lang, "jackpot", { amount: formatMoney(board, state.jackpot) }));
    if (state.phase.kind !== "lobby") footer.push(ts(board.lang, "supply", { houses: state.housesLeft, hotels: state.hotelsLeft }));
    scoreText("sbf", px + 24, py + BOARD - 52, footer.join(" · "), 16, pal.mutedText, { part: "footer" });

    return specs;
}

/**
 * Elements to add for a brand-new game, in one atomic batch: the frame (with
 * the envelope in its meta) followed by the full initial scene. The caller
 * locks them afterwards (creation schemas can't carry `locked`).
 */
export function createGameScene(
    board: BoardDef,
    gameId: string,
    origin: Point,
    envelope: GameEnvelope
): { elements: DrawdyElementSchema[]; specs: ElementSpec[] } {
    const fr = frameRect(origin);
    const frame: DrawdyElementSchema = {
        type: "frame",
        drawdyElementId: frameElementId(gameId),
        name: frameTitle(board, envelope.state),
        position: [fr.x, fr.y],
        width: fr.width,
        height: fr.height,
        rotation: 0,
        meta: { [META_KEY]: envelope },
    };
    const specs = desiredScene(board, envelope.state, origin);
    return { elements: [frame, ...specs.map((s) => s.schema)], specs };
}

/** Money that changed hands between two states: `null` is the bank. */
export type CashFlow = { from: number | null; to: number | null; amount: number };

/**
 * Who paid whom, reconstructed from cash deltas: the biggest payers are
 * matched with the biggest receivers first, whatever is left over went to or
 * came from the bank. Exact for the common cases (rent, buying, salary, a
 * trade); a plausible picture for multi-party cards.
 */
export function cashFlows(prev: GameState, next: GameState): CashFlow[] {
    const payers: { seat: number; left: number }[] = [];
    const takers: { seat: number; left: number }[] = [];
    for (const p of next.players) {
        const before = prev.players[p.seat];
        if (!before) continue;
        const d = p.cash - before.cash;
        if (d < 0) payers.push({ seat: p.seat, left: -d });
        else if (d > 0) takers.push({ seat: p.seat, left: d });
    }
    payers.sort((a, b) => b.left - a.left || a.seat - b.seat);
    takers.sort((a, b) => b.left - a.left || a.seat - b.seat);
    const flows: CashFlow[] = [];
    for (const p of payers) {
        for (const t of takers) {
            if (p.left <= 0) break;
            const amount = Math.min(p.left, t.left);
            if (amount <= 0) continue;
            flows.push({ from: p.seat, to: t.seat, amount });
            p.left -= amount;
            t.left -= amount;
        }
        if (p.left > 0) flows.push({ from: p.seat, to: null, amount: p.left });
    }
    for (const t of takers) if (t.left > 0) flows.push({ from: null, to: t.seat, amount: t.left });
    return flows;
}

/** Gentle breathing of the turn ring: scales up and dims, bouncing back and forth forever. */
export function turnRingPulse(): LocalAnimation {
    return {
        time: { durationMs: 900, curve: "ease-in-out", repeat: "ping-pong" },
        animation: { transform: { width: [1, 1.12], height: [1, 1.12], opacity: [1, 0.55] }, curve: "linear" },
    };
}

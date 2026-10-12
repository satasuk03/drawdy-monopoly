// What the canvas *should* look like for a GameState: a flat list of element
// specs with deterministic ids. Pure (no Drawdy calls), so every authority —
// including one that just took over — computes the same ids and can find and
// fix what a previous authority drew.
//
// Ids are content-addressed where content can't be updated in place (Drawdy
// can't change text or component schemas): a scoreboard row's id includes a
// hash of its text, a die's id includes its value and roll. When content
// changes, the id changes, and the reconciler removes the old element and
// adds the new one. Things that only change style or position (owner chips,
// tokens) keep their id and are updated.

import type {
    DomElementSchema,
    DrawdyElementSchema,
    LocalAnimation,
    UpdateableProperties,
} from "@drawdy/driver-protocol";
import { boardSvg, diceFaceSvg, diceShadowSvg, hotelSvg, houseSvg, svgDataUrl, tokenSvg, turnRingSvg } from "../art/index";
import { formatMoney, type BoardDef } from "../boards/types";
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
    return board.tiles[i]?.name ?? `Tile ${i}`;
}

function playerName(state: GameState, seat: number | null | undefined): string {
    if (seat === null || seat === undefined) return "Nobody";
    return state.players[seat]?.name || `Player ${seat + 1}`;
}

/** One-line status for the frame name and the scoreboard. */
export function statusText(board: BoardDef, state: GameState): string {
    const ph = state.phase;
    const cur = playerName(state, state.current);
    switch (ph.kind) {
        case "lobby": {
            const n = state.players.length;
            return `Lobby (${n} player${n === 1 ? "" : "s"})`;
        }
        case "pre-roll":
            return `${cur}'s turn`;
        case "post-roll":
            return ph.rollAgain ? `${cur} rolled doubles` : `${cur}'s turn`;
        case "buy-decision":
            return `${cur} is considering ${tileName(board, ph.tile)}`;
        case "auction":
            return `Auction: ${tileName(board, ph.auction.tile)}`;
        case "debt":
            return `${playerName(state, ph.debt.debtor)} must raise ${formatMoney(board, ph.debt.amount)}`;
        case "game-over":
            return ph.winner === null ? "Game over" : `${playerName(state, ph.winner)} wins!`;
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

export function boardArtId(gameId: string): string {
    return sceneElementId(gameId, "board");
}

/** Everything the renderer draws for `state` (not the frame, not intent elements). Order = z-order for adds. */
export function desiredScene(board: BoardDef, state: GameState, origin: Point): ElementSpec[] {
    const gameId = state.gameId;
    const frameId = frameElementId(gameId);
    const specs: ElementSpec[] = [];
    const pal = board.palette;

    // Board art.
    specs.push({
        id: boardArtId(gameId),
        role: "board",
        schema: imageComponent(boardArtId(gameId), frameId, boardRect(origin), svgDataUrl(boardSvg(board))),
        props: {},
    });

    // Owner chips: one per ownable tile, styled by ownership.
    for (let i = 0; i < 40; i++) {
        if (!isOwnable(board, i)) continue;
        const id = sceneElementId(gameId, "chip", i);
        const r = offset(ownerChipRect(i), origin);
        const own = state.ownership[String(i)];
        const color = own ? state.players[own.owner]?.color ?? "#888888" : "#888888";
        const props: UpdateableProperties = own
            ? own.mortgaged
                ? { fillColor: color, strokeColor: color, opacity: 0.45, strokeDash: "dashed" }
                : { fillColor: color, strokeColor: color, opacity: 1, strokeDash: "solid" }
            : { fillColor: color, strokeColor: color, opacity: 0, strokeDash: "solid" };
        specs.push({
            id,
            role: "chip",
            schema: {
                type: "shape",
                componentType: "rect",
                drawdyElementId: id,
                frameId,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                strokeColor: props.strokeColor!,
                fillColor: props.fillColor!,
                strokeWidth: 2,
                strokeDash: props.strokeDash,
                fillStyle: "solid",
                cornerRadius: 4,
                roughness: 0,
                opacity: props.opacity,
            },
            props,
        });
    }

    // Buildings.
    for (const [key, own] of Object.entries(state.ownership)) {
        const tile = Number(key);
        if (!own || own.houses <= 0) continue;
        if (own.houses >= 5) {
            const id = sceneElementId(gameId, "hotel", tile);
            specs.push({ id, role: "building", schema: imageComponent(id, frameId, offset(hotelSlot(tile), origin), svgDataUrl(hotelSvg(undefined, hotelSlot(tile).height > hotelSlot(tile).width))), props: {} });
        } else {
            const slots = buildingSlots(tile);
            for (let n = 0; n < own.houses && n < slots.length; n++) {
                const id = sceneElementId(gameId, "house", tile, n);
                specs.push({ id, role: "building", schema: imageComponent(id, frameId, offset(slots[n]!, origin), svgDataUrl(houseSvg())), props: {} });
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
    const scoreText = (role: string, x: number, y: number, text: string, size: number, color: string, ...key: (string | number)[]) => {
        const id = sceneElementId(gameId, role, ...key, shortHash(`${text}|${size}|${color}|${x - origin.x}|${y - origin.y}`));
        specs.push({ id, role: "score", schema: textEl(id, frameId, x, y, text, size, color), props: {} });
    };
    scoreText("sbt", px + 24, py + 24, board.name, 30, pal.text);
    scoreText("sbs", px + 24, py + 72, statusText(board, state), 18, pal.mutedText);

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
        const name = `${turn}${p.name || `Player ${p.seat + 1}`}${p.bankrupt ? " (bankrupt)" : ""}`;
        scoreText("sbn", px + 64, y, name, 24, p.color, p.seat);
        const n = counts.get(p.seat) ?? 0;
        const extras: string[] = [];
        if (p.inJail) extras.push(board.labels.jail);
        const cards = p.jailCards.chance + p.jailCards.chest;
        if (cards > 0) extras.push(`${cards} jail card${cards === 1 ? "" : "s"}`);
        const detail = p.bankrupt
            ? "Out of the game"
            : [formatMoney(board, p.cash), `${n} propert${n === 1 ? "y" : "ies"}`, ...extras].join(" · ");
        scoreText("sbd", px + 64, y + 34, detail, 18, pal.text, p.seat);
    });

    const footer = [`Round ${state.round + 1}`];
    if (state.settings.freeParkingJackpot) footer.push(`Jackpot ${formatMoney(board, state.jackpot)}`);
    if (state.phase.kind !== "lobby") footer.push(`Houses ${state.housesLeft} · Hotels ${state.hotelsLeft}`);
    scoreText("sbf", px + 24, py + BOARD - 52, footer.join(" · "), 16, pal.mutedText);

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

/** Gentle breathing of the turn ring: scales up and dims, bouncing back and forth forever. */
export function turnRingPulse(): LocalAnimation {
    return {
        time: { durationMs: 900, curve: "ease-in-out", repeat: "ping-pong" },
        animation: { transform: { width: [1, 1.12], height: [1, 1.12], opacity: [1, 0.55] }, curve: "linear" },
    };
}

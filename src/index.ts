// Board Tycoon driver entry: wires Drawdy events to the sync sessions, the
// scene renderer and the control-panel webview.
//
//   scene events ──► sync/session (one per game frame) ──► scene/renderer (authority only)
//                                   │
//   webview ◄──── GameView ◄────────┘
//
// Rules of the house: every await can fail, one game's failure must not
// affect another, and nothing ever throws out of activate/onEvent.

import type {
    CollaborationUserPresence,
    DriverModule,
    DriverSubscriptionEvent,
    ModuleStyling,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import * as dd from "./dd";
import { actionButtonSvg, boardPreviewSvg, tokenSvg } from "./art/index";
import { BOARDS, getBoard } from "./boards/index";
import { localizeBoard } from "./boards/localize";
import { normalizeLang, type Lang } from "./i18n/lang";
import { ts } from "./i18n/scene";
import { tilePlacement } from "./boards/layout";
import type { BoardDef } from "./boards/types";
import { applyAction, createGame, needsToAct, seatView } from "./engine/index";
import { DEFAULT_SETTINGS, type Action, type GameSettings, type GameState, type SeatView } from "./engine/types";
import { createGameScene, frameRect, originFromFrame, PAD, statusText, type Point } from "./scene/build";
import { SceneRenderer } from "./scene/renderer";
import {
    frameElementId,
    gamePrefix,
    intentElementId,
    isIntentElementId,
    makeGameId,
    META_KEY,
    metaKind,
    newEnvelope,
    parseEnvelope,
    parseIntentRecord,
    SEP,
    shortHash,
    type IntentRecord,
} from "./sync/envelope";
import { GameSession, type SessionIO } from "./sync/session";
import type { BoardSummary, DriverToWebview, GameSummary, GameView, Me, WebviewToDriver } from "./ui/messages";
import { WEBVIEW_HTML } from "./ui/webview-html";

const VIEW_THROTTLE_MS = 50;
const TOAST_MS = 3500;
const NEUTRAL_TOKEN_COLOR = "#6b7280";
const FALLBACK_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#9333ea", "#0891b2"];

type Game = {
    gameId: string;
    frameId: string;
    board: BoardDef;
    session: GameSession;
    renderer: SceneRenderer;
};

const games = new Map<string, Game>();
/** Intent records seen before their game's frame (event ordering isn't guaranteed). */
const orphanIntents = new Map<string, IntentRecord[]>();
/** Games whose initial add is in flight (see createNewGame). */
const creating = new Set<string>();
/** intent element id → userId, so removals can be routed. */
const intentOwners = new Map<string, string>();

let styling: ModuleStyling | null = null;
let buttonId = "board-tycoon:button";
let webviewId = "board-tycoon:panel";
let toastId = "board-tycoon:toast";

let me: Me = { userId: "local", name: "Player", color: "#2563eb" };
/** shared = collaboration works; solo = unavailable (hot-seat, I'm always authority). */
let collab: "shared" | "solo" = "solo";
let presentIds: string[] = [];
let identityPromise: Promise<void> | null = null;

let selected: string | null = null;
let panelReady = false;
let viewTimer: ReturnType<typeof setTimeout> | null = null;
let lastGamesJson = "";
let lastViewJson = "";
let boardSummaries: BoardSummary[] | null = null;
let toastSeq = 0;

// ---------------------------------------------------------------------------
// module

export const activate: DriverModule["activate"] = async (ctx) => {
    try {
        dd.init(ctx);
        styling = ctx.styling;
        const id = ctx.manifest.driverId;
        buttonId = `${id}:action-button`;
        webviewId = `${id}:panel`;
        toastId = `${id}:toast`;

        await dd.tryCmd("command:dom:create-action-button", { domElementId: buttonId, svg: actionButtonSvg() });
        await dd.trySub("subscription:dom:element-clicked", { domElementId: buttonId });
        await dd.trySub("subscription:webview:message", { webviewDomId: webviewId });
        await dd.trySub("subscription:dom:theme-changed");

        // Subscribe first, then read: an element landing in between is seen
        // twice, which ingestion tolerates (it's idempotent).
        for (const type of [
            "subscription:scene:elements-added",
            "subscription:scene:elements-updated",
            "subscription:scene:elements-removed",
            "subscription:scene:elements-replaced",
        ] as const) {
            await dd.trySub(type, { properties: ["type", "meta"] });
        }
        await dd.trySub("subscription:scene:drawdy-element-selection");

        const existing = await dd.tryCmd("command:scene:get-drawdy-elements", { properties: ["type", "meta"] });
        if (existing) await ingestElements(existing.drawdyElements);
    } catch (e) {
        dd.logError(e, "activate");
    }
};

export const onEvent: DriverModule["onEvent"] = async (e) => {
    try {
        await handleEvent(e);
    } catch (err) {
        dd.logError(err, `event ${e.type}`);
    }
};

async function handleEvent(e: DriverSubscriptionEvent): Promise<void> {
    switch (e.type) {
        case "subscription:dom:element-clicked":
            if (e.body.domElementId === buttonId) await openPanel();
            return;
        case "subscription:webview:message":
            if (e.body.webviewDomId === webviewId) await handleMessage(e.body.message);
            return;
        case "subscription:dom:theme-changed":
            styling = e.body.styling;
            post({ type: "theme", themeTokens: themeTokens(), themeMode: styling.theme });
            return;
        case "subscription:scene:elements-added":
        case "subscription:scene:elements-updated":
            await ingestElements(e.body.drawdyElements);
            return;
        case "subscription:scene:elements-removed":
            handleRemoved(e.body.drawdyElements.map((x) => x.id));
            return;
        case "subscription:scene:elements-replaced":
            await handleReplaced(e.body.drawdyElements);
            return;
        case "subscription:collaboration:presence-changed":
            setPresence(e.body.users);
            return;
        case "subscription:scene:drawdy-element-selection":
            selectFromCanvas(e.body.drawdyElementIds);
            return;
        default:
            return;
    }
}

// ---------------------------------------------------------------------------
// identity & presence

/** Resolve who I am (and start presence tracking) once, lazily: it may prompt for the collaboration permission. */
function identity(): Promise<void> {
    identityPromise ??= resolveIdentity();
    return identityPromise;
}

async function resolveIdentity(): Promise<void> {
    try {
        const v = await dd.cmd("command:collaboration:get-all-users-in-board");
        const self = v.users.find((u) => u.isSelf) ?? v.users[0];
        if (self && self.id) {
            me = { userId: self.id, name: self.name || "Player", color: isHex(self.color) ? self.color : me.color };
        }
        collab = "shared";
        presentIds = uniqueSorted(v.users.map((u) => u.id));
        await dd.trySub("subscription:collaboration:presence-changed");
    } catch (e) {
        // Unauthorized (denied / not declared) or unavailable: hot-seat mode.
        if (!dd.isDdError(e, "unauthorized")) dd.logError(e, "collaboration");
        collab = "solo";
        presentIds = [];
    }
}

function setPresence(users: readonly CollaborationUserPresence[]): void {
    if (collab !== "shared") return;
    // Fires on every cursor move: only act when the set of people changes.
    const ids = uniqueSorted(users.map((u) => u.id));
    if (ids.join("\n") === presentIds.join("\n")) return;
    presentIds = ids;
    for (const g of games.values()) safely(() => g.session.setPresence(presentIds), "presence");
    scheduleView();
}

function sessionPresence(): string[] | null {
    return collab === "shared" ? presentIds : null;
}

// ---------------------------------------------------------------------------
// scene ingestion

async function ingestElements(els: readonly SubscribedDrawdyElement[]): Promise<void> {
    const frames: SubscribedDrawdyElement[] = [];
    const intents: SubscribedDrawdyElement[] = [];
    for (const el of els) {
        const k = metaKind(el.meta);
        if (k === "game") frames.push(el);
        else if (k === "intent") intents.push(el);
    }
    if (frames.length === 0 && intents.length === 0) return;
    await identity();
    for (const el of frames) safely(() => ingestFrame(el), "frame");
    for (const el of intents) safely(() => ingestIntent(el), "intent");
}

function ingestFrame(el: SubscribedDrawdyElement): void {
    const env = parseEnvelope(el.meta);
    if (!env) return;
    const gameId = env.state.gameId;
    // A pasted copy of a frame carries the same meta under a new id: not a game.
    if (el.id !== frameElementId(gameId) || creating.has(gameId)) return;
    let g = games.get(gameId);
    if (!g) {
        const base = getBoard(env.state.boardId);
        if (!base) return;
        g = createRuntime(gameId, localizeBoard(base, env.state.lang));
    }
    g.session.ingestEnvelope(env);
    const waiting = orphanIntents.get(gameId);
    if (waiting) {
        orphanIntents.delete(gameId);
        for (const rec of waiting) g.session.ingestIntentRecord(rec);
    }
    scheduleView();
}

function ingestIntent(el: SubscribedDrawdyElement): void {
    const rec = parseIntentRecord(el.meta);
    if (!rec || el.id !== intentElementId(rec.gameId, rec.userId)) return;
    intentOwners.set(el.id, rec.userId);
    const g = games.get(rec.gameId);
    if (g) {
        g.session.ingestIntentRecord(rec);
    } else {
        const list = (orphanIntents.get(rec.gameId) ?? []).filter((r) => r.userId !== rec.userId);
        list.push(rec);
        orphanIntents.set(rec.gameId, list);
    }
}

function gameIdOf(elementId: string): string | null {
    const i = elementId.indexOf(SEP);
    return i > 0 ? elementId.slice(0, i) : null;
}

function handleRemoved(ids: readonly string[]): void {
    for (const id of ids) {
        const gameId = gameIdOf(id);
        const g = gameId ? games.get(gameId) : undefined;
        if (!g) continue;
        safely(() => {
            if (id === g.frameId) {
                teardown(g.gameId);
            } else if (isIntentElementId(g.gameId, id)) {
                const owner = intentOwners.get(id);
                if (owner) g.session.intentElementRemoved(owner);
            } else if (g.session.isAuthority()) {
                g.renderer.elementsRemoved([id]);
            }
        }, "removed");
    }
}

async function handleReplaced(els: readonly SubscribedDrawdyElement[]): Promise<void> {
    const alive = new Set(els.map((e) => e.id));
    for (const g of [...games.values()]) {
        if (!alive.has(g.frameId)) teardown(g.gameId);
        else g.renderer.invalidate();
    }
    await ingestElements(els);
    for (const g of games.values()) {
        const env = g.session.envelope;
        if (env && g.session.isAuthority()) g.renderer.render(env.state);
    }
    scheduleView();
}

// ---------------------------------------------------------------------------
// game runtimes

function createRuntime(gameId: string, board: BoardDef): Game {
    const frameId = frameElementId(gameId);
    const renderer = new SceneRenderer(board, gameId);
    const session: GameSession = new GameSession({
        gameId,
        myUserId: me.userId,
        board,
        applyAction,
        io: sessionIO(gameId, frameId),
        events: {
            onEnvelope(prev, next) {
                if (session.isAuthority()) renderer.render(next.state);
                if (prev) bigMoments(board, prev.state, next.state);
            },
            onAuthorityChange(isMe) {
                if (isMe) {
                    renderer.restart();
                    const env = session.envelope;
                    if (env) renderer.render(env.state);
                } else {
                    renderer.stop();
                }
            },
            onReassert() {
                renderer.invalidate();
                const env = session.envelope;
                if (env) renderer.render(env.state);
            },
            onIntentRejected(message) {
                if (selected === gameId) post({ type: "error", message });
            },
            onChange() {
                scheduleView();
            },
        },
    });
    if (!session.isAuthority()) renderer.stop();
    const g: Game = { gameId, frameId, board, session, renderer };
    games.set(gameId, g);
    session.setPresence(sessionPresence());
    return g;
}

function teardown(gameId: string): void {
    const g = games.get(gameId);
    if (!g) return;
    g.session.dispose();
    g.renderer.stop();
    games.delete(gameId);
    for (const [id] of intentOwners) if (id.startsWith(gamePrefix(gameId))) intentOwners.delete(id);
    if (selected === gameId) selected = null;
    scheduleView();
}

function sessionIO(gameId: string, frameId: string): SessionIO {
    return {
        async writeEnvelope(envelope) {
            await dd.cmd("command:scene:update-drawdy-elements", {
                updates: [{ drawdyElementId: frameId, properties: { meta: { [META_KEY]: envelope } } }],
            });
        },
        async writeIntents(record, knownToExist) {
            const id = intentElementId(gameId, record.userId);
            const meta = { [META_KEY]: record };
            if (knownToExist) {
                try {
                    const v = await dd.cmd("command:scene:update-drawdy-elements", {
                        updates: [{ drawdyElementId: id, properties: { meta } }],
                    });
                    if (!v || v.updated > 0) return;
                } catch (e) {
                    if (!dd.isDdError(e, "not-found") && !dd.isDdError(e, "bad-argument")) throw e;
                }
            }
            // Create it: a tiny invisible locked shape in the frame's corner.
            const origin = await readOrigin(frameId);
            if (!origin) throw new Error("game frame not found");
            try {
                await dd.cmd("command:scene:add-drawdy-elements", {
                    elements: [
                        {
                            type: "shape",
                            componentType: "rect",
                            drawdyElementId: id,
                            frameId,
                            x: origin.x - PAD + 2,
                            y: origin.y - PAD + 2,
                            width: 4,
                            height: 4,
                            strokeColor: "#000000",
                            fillColor: "#000000",
                            strokeWidth: 1,
                            roughness: 0,
                            opacity: 0,
                            meta,
                        },
                    ],
                });
            } catch (e) {
                const existing = dd.isDdError(e, "bad-argument") ? e.body?.existingIds : undefined;
                if (!Array.isArray(existing) || !existing.includes(id)) throw e;
                await dd.cmd("command:scene:update-drawdy-elements", {
                    updates: [{ drawdyElementId: id, properties: { meta } }],
                });
            }
            await dd.tryCmd("command:scene:update-drawdy-elements", {
                updates: [{ drawdyElementId: id, properties: { locked: true } }],
            });
        },
    };
}

async function readOrigin(frameId: string): Promise<Point | null> {
    const v = await dd.tryCmd("command:scene:get-drawdy-elements", {
        properties: ["x", "y"],
        drawdyElementIds: [frameId],
    });
    const f = v?.drawdyElements.find((e) => e.id === frameId);
    if (!f || typeof f.x !== "number" || typeof f.y !== "number") return null;
    return originFromFrame(f.x, f.y);
}

// ---------------------------------------------------------------------------
// webview

async function openPanel(): Promise<void> {
    const v = await dd.tryCmd("command:webview:create", {
        webviewDomId: webviewId,
        htmlContent: WEBVIEW_HTML,
        keepStateWhenClosed: true,
    });
    if (v && v.created === false && panelReady) {
        // Re-shown kept-alive panel: refresh everything it shows.
        if (styling) post({ type: "theme", themeTokens: themeTokens(), themeMode: styling.theme });
        forceView();
    }
    void identity();
}

/** The panel user's language: driver messages to the panel and the theme picker use it. */
let uiLang: Lang = "en";

/** Returns true when it changed. */
function setUiLang(raw: unknown): boolean {
    if (raw === undefined) return false;
    const l = normalizeLang(raw);
    if (l === uiLang) return false;
    uiLang = l;
    boardSummaries = null;
    return true;
}

function post(message: DriverToWebview): void {
    void dd.tryCmd("command:webview:post-message", { webviewDomId: webviewId, message });
}

function themeTokens(): Record<string, string> {
    const t = (styling as unknown as { tokens?: unknown } | null)?.tokens;
    if (!t || typeof t !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
}

/** Theme picker entries in the panel's language. */
function summaries(): BoardSummary[] {
    if (boardSummaries) return boardSummaries;
    boardSummaries = BOARDS.map((base) => localizeBoard(base, uiLang)).map((b) => ({
        id: b.id,
        name: b.name,
        tagline: b.tagline,
        previewSvg: safeStr(() => boardPreviewSvg(b)),
        tokens: b.tokens.map((t) => ({ id: t.id, name: t.name, svg: safeStr(() => tokenSvg(b, t.id, NEUTRAL_TOKEN_COLOR)) })),
        currencySymbol: b.currency.symbol,
    }));
    return boardSummaries;
}

function isMessage(m: unknown): m is WebviewToDriver {
    return typeof m === "object" && m !== null && typeof (m as { type?: unknown }).type === "string";
}

async function handleMessage(raw: unknown): Promise<void> {
    if (!isMessage(raw)) return;
    const msg = raw;
    switch (msg.type) {
        case "ready": {
            panelReady = true;
            setUiLang(msg.lang);
            await identity();
            post({
                type: "init",
                me,
                boards: summaries(),
                defaultSettings: DEFAULT_SETTINGS,
                themeTokens: themeTokens(),
                themeMode: styling?.theme ?? "light",
            });
            if (selected === null && games.size === 1) selected = [...games.keys()][0]!;
            forceView();
            return;
        }
        case "select-game": {
            selected = typeof msg.gameId === "string" && games.has(msg.gameId) ? msg.gameId : null;
            scheduleView();
            return;
        }
        case "create-game":
            await createNewGame(String(msg.boardId), msg.settings, normalizeLang(msg.lang ?? uiLang));
            return;
        case "lang":
            if (setUiLang(msg.lang)) post({ type: "boards", boards: summaries() });
            return;
        case "action":
            await handleAction(String(msg.gameId), msg.action);
            return;
        case "focus":
            await focusGame(String(msg.gameId), typeof msg.tile === "number" ? msg.tile : undefined);
            return;
        case "delete-game":
            await deleteGame(String(msg.gameId));
            return;
        default:
            return;
    }
}

function scheduleView(): void {
    if (viewTimer !== null) return;
    viewTimer = setTimeout(() => {
        viewTimer = null;
        flushView();
    }, VIEW_THROTTLE_MS);
}

function forceView(): void {
    lastGamesJson = "";
    lastViewJson = "";
    scheduleView();
}

function flushView(): void {
    if (!panelReady) return;
    try {
        if (selected !== null && !games.has(selected)) selected = null;
        const list: GameSummary[] = [];
        for (const g of games.values()) {
            const env = g.session.envelope;
            if (!env) continue;
            list.push({
                gameId: g.gameId,
                boardId: g.board.id,
                boardName: g.board.name,
                phase: env.state.phase.kind,
                playerNames: env.state.players.map((p) => p.name),
            });
        }
        const gamesMsg: DriverToWebview = { type: "games", games: list, selected };
        const gj = JSON.stringify(gamesMsg);
        if (gj !== lastGamesJson) {
            lastGamesJson = gj;
            post(gamesMsg);
        }
        const g = selected ? games.get(selected) : undefined;
        const viewMsg: DriverToWebview = { type: "view", view: g ? buildView(g) : null };
        const vj = JSON.stringify(viewMsg);
        if (vj !== lastViewJson) {
            lastViewJson = vj;
            post(viewMsg);
        }
    } catch (e) {
        dd.logError(e, "view");
    }
}

function buildView(g: Game): GameView | null {
    const env = g.session.envelope;
    if (!env) return null;
    const state = env.state;
    const board = g.board;
    const seatViews: SeatView[] = state.players.map((p) => {
        try {
            return seatView(board, state, p.seat);
        } catch (e) {
            dd.logError(e, "seatView");
            return { seat: p.seat, netWorth: p.cash, legal: [], buildable: [], sellable: [], mortgageable: [], unmortgageable: [] };
        }
    });
    const mySeats = state.players.filter((p) => p.userId === me.userId).map((p) => p.seat);
    let acting: number[] = [];
    try {
        acting = needsToAct(state);
    } catch (e) {
        dd.logError(e, "needsToAct");
    }
    const activeSeat = mySeats.find((s) => acting.includes(s)) ?? mySeats[0] ?? null;
    const tokenSvgs: Record<string, string> = {};
    for (const p of state.players) tokenSvgs[p.token] = safeStr(() => tokenSvg(board, p.token, p.color));
    return {
        state,
        board,
        mySeats,
        activeSeat,
        seatViews,
        tokenSvgs,
        presentUserIds: collab === "shared" ? presentIds : [],
        isCreator: state.creatorUserId === me.userId,
        pending: g.session.pending(),
    };
}

// ---------------------------------------------------------------------------
// panel actions

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[];

/** Keep only known settings with the right primitive type (the panel is another process). */
function cleanSettings(raw: unknown): Partial<GameSettings> {
    const out: Record<string, unknown> = {};
    if (typeof raw !== "object" || raw === null) return {};
    for (const k of SETTING_KEYS) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === typeof DEFAULT_SETTINGS[k] && (typeof v !== "number" || Number.isFinite(v))) out[k] = v;
    }
    return out as Partial<GameSettings>;
}

async function createNewGame(boardId: string, rawSettings: unknown, lang: Lang): Promise<void> {
    const base = getBoard(boardId) ?? BOARDS[0];
    if (!base) return;
    const board = localizeBoard(base, lang);
    await identity();

    // Center the new frame in the current viewport.
    const size = frameRect({ x: 0, y: 0 });
    let center = { x: 0, y: 0 };
    const vp = await dd.tryCmd("command:camera:get-viewport-rect");
    if (vp) center = { x: vp.rect.x + vp.rect.width / 2, y: vp.rect.y + vp.rect.height / 2 };
    const origin: Point = {
        x: Math.round(center.x - size.width / 2 + PAD),
        y: Math.round(center.y - size.height / 2 + PAD),
    };

    const gameId = makeGameId(dd.generateId());
    // The engine is deterministic; all randomness enters through this seed.
    const seed = parseInt(shortHash(`${dd.generateId()}|${Date.now()}|${Math.random()}`), 36) >>> 0;
    let state: GameState;
    try {
        state = createGame({ gameId, board, creatorUserId: me.userId, seed, lang, settings: cleanSettings(rawSettings) });
    } catch (e) {
        post({ type: "error", message: ts(uiLang, "cantCreate", { error: e instanceof Error ? e.message : String(e) }) });
        return;
    }
    const frameId = frameElementId(gameId);
    const envelope = newEnvelope(state, me.userId, { frame: frameId, origin });
    const { elements, specs } = createGameScene(board, gameId, origin, envelope);

    // While the add is in flight its elements-added echo must not spawn a
    // second runtime for this game: ingestFrame skips ids in `creating`.
    creating.add(gameId);
    try {
        await dd.cmd("command:scene:add-drawdy-elements", { elements });
    } catch (e) {
        const msg = dd.isDdError(e, "unauthorized")
            ? ts(uiLang, "needScene")
            : ts(uiLang, "cantPlace", { error: e instanceof Error ? e.message : String(e) });
        post({ type: "error", message: msg });
        return;
    } finally {
        creating.delete(gameId);
    }
    const g = createRuntime(gameId, board);
    g.session.initCreated(envelope);
    // The renderer drew nothing: the batch above is the initial scene. Tell it so
    // (synchronously, before the pass started by initCreated reaches its diff).
    g.renderer.adoptCreated(specs, state);
    await dd.tryCmd("command:scene:update-drawdy-elements", {
        updates: elements.map((el) => ({ drawdyElementId: el.drawdyElementId, properties: { locked: true } })),
    });
    selected = gameId;
    scheduleView();
    await dd.tryCmd("command:scene:set-selection", { drawdyElementIds: [frameId] });
    await dd.tryCmd("command:camera:fly-to-rect", { rect: frameRect(origin), flyDurationMs: 600, zoom: 1 });
}

async function handleAction(gameId: string, raw: unknown): Promise<void> {
    const g = games.get(gameId);
    if (!g) {
        post({ type: "error", message: ts(uiLang, "gameGone") });
        return;
    }
    if (typeof raw !== "object" || raw === null || typeof (raw as { type?: unknown }).type !== "string") return;
    let action = raw as Action;
    const env = g.session.envelope;
    if (action.type === "join" && env) {
        const taken = new Set(env.state.players.map((p) => p.token));
        const n = env.state.players.length;
        action = {
            ...action,
            userId: me.userId,
            name: (typeof action.name === "string" && action.name.trim()) || (n === 0 ? me.name : `${me.name} ${n + 1}`),
            color: isHex(action.color) ? action.color : freeColor(env.state),
            token:
                typeof action.token === "string" && action.token
                    ? action.token
                    : g.board.tokens.find((t) => !taken.has(t.id))?.id ?? g.board.tokens[0]?.id ?? "",
        };
    }
    const r = g.session.submit(action);
    if (!r.ok) post({ type: "error", message: r.error });
}

async function focusGame(gameId: string, tile?: number): Promise<void> {
    const g = games.get(gameId);
    if (!g) return;
    const origin = (await readOrigin(g.frameId)) ?? g.session.envelope?.ids.origin;
    if (!origin) return;
    let rect = frameRect(origin);
    let zoom = 1;
    if (tile !== undefined && tile >= 0 && tile < 40) {
        const r = tilePlacement(tile).rect;
        const m = 120;
        rect = { x: origin.x + r.x - m, y: origin.y + r.y - m, width: r.width + 2 * m, height: r.height + 2 * m };
        zoom = 1.6;
    }
    await dd.tryCmd("command:camera:fly-to-rect", { rect, flyDurationMs: 500, zoom });
}

async function deleteGame(gameId: string): Promise<void> {
    const g = games.get(gameId);
    if (!g) return;
    const state = g.session.envelope?.state;
    if (collab === "shared" && state && state.creatorUserId !== me.userId) {
        post({ type: "error", message: ts(uiLang, "creatorOnlyDelete") });
        return;
    }
    const all = await dd.tryCmd("command:scene:get-drawdy-elements", { properties: ["type"] });
    const prefix = gamePrefix(gameId);
    const ids = (all?.drawdyElements ?? []).map((e) => e.id).filter((id) => id.startsWith(prefix));
    if (!ids.includes(g.frameId)) ids.push(g.frameId);
    teardown(gameId);
    await dd.tryCmd("command:scene:remove-drawdy-elements", { drawdyElementIds: ids });
}

function selectFromCanvas(ids: readonly string[]): void {
    for (const id of ids) {
        const gameId = gameIdOf(id);
        if (gameId && games.has(gameId)) {
            if (selected !== gameId) {
                selected = gameId;
                scheduleView();
            }
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// big-moment toasts (the panel does per-log toasts; this is for everyone looking at the canvas)

function bigMoments(board: BoardDef, prev: GameState, next: GameState): void {
    const lines: string[] = [];
    for (const p of next.players) {
        const before = prev.players[p.seat];
        if (p.bankrupt && before && !before.bankrupt) lines.push(ts(board.lang, "bankrupt", { name: p.name }));
    }
    if (next.phase.kind === "game-over" && prev.phase.kind !== "game-over") lines.push(statusText(board, next));
    if (lines.length > 0) void showToast(`${board.name}: ${lines.join(" ")}`);
}

async function showToast(text: string): Promise<void> {
    const seq = ++toastSeq;
    const size = await dd.tryCmd("command:dom:window-size");
    const width = 360;
    const x = size ? Math.max(8, Math.round(size.width / 2 - width / 2)) : 200;
    const ok = await dd.tryCmd("command:dom:upsert-floating-element", {
        domId: toastId,
        position: { x, y: 72 },
        asPopover: false,
        schema: {
            type: "box",
            styles: {
                width: [width, "px"],
                padding: [12, "px"],
                backgroundColor: "#111827",
                borderRadius: [10, "px"],
                pointerEvents: "none",
            },
            children: [
                {
                    type: "text",
                    child: text,
                    styles: { color: "#ffffff", fontSize: [14, "px"], fontWeight: "semibold", textAlign: "center" },
                },
            ],
        },
    });
    if (!ok) return;
    setTimeout(() => {
        if (seq === toastSeq) void dd.tryCmd("command:dom:remove-floating-element", { domId: toastId });
    }, TOAST_MS);
}

// ---------------------------------------------------------------------------
// small helpers

function safely(fn: () => void, context: string): void {
    try {
        fn();
    } catch (e) {
        dd.logError(e, context);
    }
}

function safeStr(fn: () => string): string {
    try {
        return fn();
    } catch (e) {
        dd.logError(e, "art");
        return "";
    }
}

/** My own color if nobody has it, else the first unused fallback (the engine rejects duplicate colors). */
function freeColor(state: GameState): string {
    const taken = new Set(state.players.map((p) => p.color.toLowerCase()));
    const options = [me.color, ...FALLBACK_COLORS];
    return options.find((c) => isHex(c) && !taken.has(c.toLowerCase())) ?? FALLBACK_COLORS[0]!;
}

function isHex(c: unknown): c is string {
    return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
}

function uniqueSorted(ids: string[]): string[] {
    return [...new Set(ids.filter((x) => typeof x === "string" && x))].sort();
}

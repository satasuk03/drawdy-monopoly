// Renders GameState onto the canvas. Only the authority runs a renderer.
//
// The renderer keeps a cache of the element ids it believes exist (id →
// props key). Each pass diffs the desired scene (scene/build.ts) against that
// cache and issues the minimal commands: remove what's no longer wanted, add
// what's missing, update what changed, then animate token moves.
//
// Robustness rules:
//  - All passes run on one serialized queue; a new state while a pass runs
//    just replaces the target (coalescing), so animations never interleave.
//  - The cache is rebuilt from the scene (by id prefix) when we take over or
//    after any failure, so a new authority finds and fixes what the previous
//    one drew. Unknown elements get their props re-applied.
//  - If someone deletes one of our elements, the removal event drops it from
//    the cache and the next pass re-adds it.
//  - add-drawdy-elements fails atomically when an id exists; we read
//    `body.existingIds`, update those instead and add the rest.

import type { DrawdyElementSchema, UpdateableProperties } from "@drawdy/driver-protocol";
import { cmd, isDdError, logError, sleep } from "../dd";
import type { BoardDef } from "../boards/types";
import type { GameState } from "../engine/types";
import { tokenRect } from "../boards/layout";
import { frameElementId, isRenderElementId } from "../sync/envelope";
import {
    boardArtId,
    desiredScene,
    frameTitle,
    originFromFrame,
    propsKey,
    rollKey,
    turnRingPulse,
    turnRingRect,
    tokenSlots,
    type ElementSpec,
    type LiveProps,
    type Point,
} from "./build";
import { DICE_ANIM_MS, diceTumble, shadowTumble } from "./dice-anim";

/** Per-tile hop duration when a token walks. */
export const HOP_MS = 90;
/** Moves longer than this (or backwards) jump straight to the target. */
export const MAX_HOPS = 12;

const UNKNOWN = "?";
const MAX_RETRIES = 3;

type Update = { drawdyElementId: string; properties: LiveProps };

/** One stop of a token walk: top-left position, plus the size when it changes. */
type Hop = Point & { width?: number; height?: number };

/** The dice settle slightly before the animation ends; token walks start then. */
const DICE_SETTLE_MS = DICE_ANIM_MS - 150;

export class SceneRenderer {
    readonly gameId: string;
    readonly frameId: string;
    private board: BoardDef;

    /** id → propsKey of what we last applied ("?" = exists, props unknown). */
    private cache = new Map<string, string>();
    private cacheReady = false;
    private lastFrameName: string | null = null;
    /** The state the canvas currently shows (null = unknown → no animation, full resync). */
    private shown: GameState | null = null;
    private target: GameState | null = null;
    private running = false;
    private stopped = false;
    private retries = 0;
    private mismatchRetries = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private clearTimers = new Set<ReturnType<typeof setTimeout>>();

    constructor(board: BoardDef, gameId: string) {
        this.board = board;
        this.gameId = gameId;
        this.frameId = frameElementId(gameId);
    }

    /** Render `state` (coalesced: if a pass is running, only the latest target is drawn next). */
    render(state: GameState): void {
        if (this.stopped) return;
        this.target = state;
        void this.run();
    }

    /** Treat the canvas as unknown: next pass rediscovers our elements and re-applies everything. */
    invalidate(): void {
        this.cacheReady = false;
        this.shown = null;
    }

    /** We just created these elements in one batch (game creation). */
    adoptCreated(specs: ElementSpec[], state: GameState): void {
        this.cache.clear();
        for (const s of specs) this.cache.set(s.id, propsKey(s.props));
        this.cacheReady = true;
        this.shown = state;
        this.lastFrameName = frameTitle(this.board, state);
    }

    /** Scene removal events: forget ids we own so the next pass re-adds them. Returns true if any were ours. */
    elementsRemoved(ids: readonly string[]): boolean {
        let ours = false;
        for (const id of ids) {
            if (this.cache.delete(id)) ours = true;
        }
        if (ours && !this.stopped) {
            const s = this.target ?? this.shown;
            if (s) this.render(s);
        }
        return ours;
    }

    /** Stop rendering (lost authority / game removed). A running pass finishes its current command. */
    stop(): void {
        this.stopped = true;
        this.target = null;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        for (const t of this.clearTimers) clearTimeout(t);
        this.clearTimers.clear();
    }

    /** Resume after stop() (regained authority). Always starts from a fresh scene read. */
    restart(): void {
        this.stopped = false;
        this.invalidate();
    }

    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.target && !this.stopped) {
                const next = this.target;
                this.target = null;
                const prev = this.shown;
                try {
                    await this.reconcile(prev, next);
                    this.shown = next;
                    this.retries = 0;
                    if (this.cacheReady) this.mismatchRetries = 0;
                } catch (e) {
                    logError(e, "render");
                    this.invalidate();
                    if (!this.target && this.retries < MAX_RETRIES && !this.stopped) {
                        this.retries++;
                        const retryState = next;
                        if (this.retryTimer) clearTimeout(this.retryTimer);
                        this.retryTimer = setTimeout(() => {
                            this.retryTimer = null;
                            if (!this.target) this.render(retryState);
                        }, 800 * this.retries);
                    }
                }
            }
        } finally {
            this.running = false;
        }
    }

    /** Where the board is now (the frame may have been moved), or null if the frame is gone. */
    private async readOrigin(): Promise<Point | null> {
        const v = await cmd("command:scene:get-drawdy-elements", {
            properties: ["x", "y"],
            drawdyElementIds: [this.frameId],
        });
        const f = v.drawdyElements.find((e) => e.id === this.frameId);
        if (!f || typeof f.x !== "number" || typeof f.y !== "number") return null;
        return originFromFrame(f.x, f.y);
    }

    /** Rebuild the cache from the scene: every element with our id prefix. */
    private async discover(): Promise<void> {
        const v = await cmd("command:scene:get-drawdy-elements", { properties: ["type"] });
        this.cache.clear();
        for (const e of v.drawdyElements) {
            if (isRenderElementId(this.gameId, e.id)) this.cache.set(e.id, UNKNOWN);
        }
        this.cacheReady = true;
    }

    /**
     * One pass: make the canvas show `next`, animating from `prev` when the
     * canvas is known to show `prev`.
     */
    private async reconcile(prev: GameState | null, next: GameState): Promise<void> {
        const origin = await this.readOrigin();
        if (!origin) return; // frame gone; the driver tears the game down on the removal event
        if (!this.cacheReady) {
            await this.discover();
            prev = null; // positions unknown: no animation this pass
        }
        const specs = desiredScene(this.board, next, origin);
        const desired = new Map(specs.map((s) => [s.id, s]));

        // If the board art went missing, re-adding it alone would cover
        // everything else (newer elements draw on top). Rebuild the stack.
        if (!this.cache.has(boardArtId(this.gameId)) && this.cache.size > 0) {
            const all = [...this.cache.keys()];
            this.cache.clear();
            await this.remove(all);
            prev = null;
        }

        // 1. Remove what's no longer wanted.
        const stale = [...this.cache.keys()].filter((id) => !desired.has(id));
        for (const id of stale) this.cache.delete(id);
        await this.remove(stale);

        // 2. Plan token walks (only for tokens already on the canvas).
        const walks = prev ? this.planWalks(prev, next, origin, specs) : new Map<string, Hop[]>();

        // 3. Add what's missing.
        const toAdd = specs.filter((s) => !this.cache.has(s.id));
        const added = await this.add(toAdd);

        // 4. Update what changed (including existing ids an add bumped into), and lock new elements.
        const updates: Update[] = [];
        for (const s of specs) {
            const key = propsKey(s.props);
            const isNew = added.has(s.id);
            if (walks.has(s.id)) continue; // positioned by the walk below
            if (isNew) {
                const props: LiveProps = { ...s.props, locked: true };
                if (s.role === "turn-ring") props.localAnimation = turnRingPulse();
                updates.push({ drawdyElementId: s.id, properties: props });
            } else if (this.cache.get(s.id) !== key) {
                const props: LiveProps = { ...s.props };
                if (this.cache.get(s.id) === UNKNOWN) props.locked = true;
                if (Object.keys(props).length > 0) updates.push({ drawdyElementId: s.id, properties: props });
            }
        }
        await this.update(updates);
        for (const s of specs) if (!walks.has(s.id)) this.cache.set(s.id, propsKey(s.props));

        // 5. Fresh dice: reveal them. After a real roll they are thrown in (all at
        // once, same start frame), and tokens wait until the dice have landed.
        const fresh = specs.filter((s) => (s.role === "die" || s.role === "die-shadow") && added.has(s.id));
        if (fresh.length > 0) {
            const seed = rollKey(next);
            await this.update(
                fresh.map((s) => ({
                    drawdyElementId: s.id,
                    properties: prev
                        ? { opacity: 1, localAnimation: (s.role === "die" ? diceTumble : shadowTumble)(seed, s.die ?? 0) }
                        : { opacity: 1 },
                }))
            );
            if (prev) {
                this.clearAnimationLater(fresh.map((s) => s.id));
                await sleep(DICE_SETTLE_MS);
            }
        }

        // 6. Walk tokens tile by tile.
        if (walks.size > 0) await this.walk(walks, desired);

        // 7. Frame name shows the status.
        const title = frameTitle(this.board, next);
        if (title !== this.lastFrameName) {
            await cmd("command:scene:update-drawdy-elements", {
                updates: [{ drawdyElementId: this.frameId, properties: { frameName: title, locked: true } }],
            });
            this.lastFrameName = title;
        }
    }

    /** Hop paths (canvas positions, last = final) for tokens that moved forward ≤ MAX_HOPS tiles; the turn ring follows its token. */
    private planWalks(prev: GameState, next: GameState, origin: Point, specs: ElementSpec[]): Map<string, Hop[]> {
        const walks = new Map<string, Hop[]>();
        const prevSlots = tokenSlots(prev);
        const ringOf = new Map<number, ElementSpec>();
        for (const s of specs) if (s.role === "turn-ring" && s.seat !== undefined) ringOf.set(s.seat, s);
        for (const s of specs) {
            if (s.role !== "token" || s.seat === undefined || !this.cache.has(s.id)) continue;
            const a = prev.players[s.seat];
            const b = next.players[s.seat];
            if (!a || !b || a.bankrupt || b.bankrupt || a.inJail || b.inJail) continue;
            if (a.token !== b.token || a.color !== b.color || !prevSlots.has(s.seat)) continue;
            const steps = (b.position - a.position + 40) % 40;
            if (steps < 1 || steps > MAX_HOPS) continue;
            const t = s.props.transform;
            if (!t || t.x === undefined || t.y === undefined) continue;
            // Intermediate tiles are passed alone (full size); the last hop lands on the real rect and size.
            const path: Hop[] = [];
            for (let k = 1; k < steps; k++) {
                const r = tokenRect((a.position + k) % 40, 0, false, 1);
                path.push({ x: r.x + origin.x, y: r.y + origin.y, width: r.width, height: r.height });
            }
            path.push({ x: t.x, y: t.y, width: s.props.width, height: s.props.height });
            walks.set(s.id, path);

            // The ring (if it's already on the canvas) keeps the same center as the token on every hop.
            const ring = ringOf.get(s.seat);
            if (ring && this.cache.has(ring.id)) {
                walks.set(
                    ring.id,
                    path.map((h) => {
                        const size = h.width ?? 64;
                        const r = turnRingRect({ x: h.x, y: h.y, width: size, height: h.height ?? size });
                        return { x: r.x, y: r.y, width: r.width, height: r.height };
                    })
                );
            }
        }
        return walks;
    }

    private async walk(walks: Map<string, Hop[]>, desired: Map<string, ElementSpec>): Promise<void> {
        const longest = Math.max(...[...walks.values()].map((p) => p.length));
        for (let k = 0; k < longest; k++) {
            if (this.stopped) break;
            const updates: Update[] = [];
            for (const [id, path] of walks) {
                const h = path[k];
                if (!h) continue;
                const properties: LiveProps = { transform: { x: h.x, y: h.y } };
                if (h.width !== undefined) properties.width = h.width;
                if (h.height !== undefined) properties.height = h.height;
                updates.push({ drawdyElementId: id, properties });
            }
            await this.update(updates);
            if (k < longest - 1) await sleep(HOP_MS);
        }
        for (const id of walks.keys()) {
            const s = desired.get(id);
            if (s) this.cache.set(id, propsKey(s.props));
        }
    }

    /**
     * After the dice animation has finished, drop it from the elements so a
     * reload (or a new collaborator) doesn't replay it. Best effort: the ids
     * are per roll, so by the time this fires they may already be gone — that,
     * or any other failure, is ignored.
     */
    private clearAnimationLater(ids: string[]): void {
        const timer = setTimeout(() => {
            this.clearTimers.delete(timer);
            if (this.stopped) return;
            cmd("command:scene:update-drawdy-elements", {
                updates: ids.map((id) => ({ drawdyElementId: id, properties: { localAnimation: null } })),
            }).catch(() => {});
        }, DICE_ANIM_MS + 300);
        this.clearTimers.add(timer);
    }

    // -- command wrappers --------------------------------------------------

    private async remove(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        try {
            await cmd("command:scene:remove-drawdy-elements", { drawdyElementIds: ids });
        } catch (e) {
            // Already gone is fine.
            if (!isDdError(e, "not-found")) throw e;
        }
    }

    /**
     * Add specs in one batch. Ids that already exist (someone else drew them,
     * or our cache was stale) are put in the cache as UNKNOWN so the update
     * step re-applies their props. Returns the ids actually added.
     */
    private async add(specs: ElementSpec[]): Promise<Set<string>> {
        const added = new Set<string>();
        let pending: DrawdyElementSchema[] = specs.map((s) => s.schema);
        for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
            try {
                await cmd("command:scene:add-drawdy-elements", { elements: pending });
                for (const el of pending) added.add(el.drawdyElementId);
                return added;
            } catch (e) {
                const existing = isDdError(e, "bad-argument") ? e.body?.existingIds : undefined;
                if (!Array.isArray(existing) || existing.length === 0) throw e;
                const taken = new Set(existing.map(String));
                for (const id of taken) this.cache.set(id, UNKNOWN);
                pending = pending.filter((el) => !taken.has(el.drawdyElementId));
            }
        }
        return added;
    }

    private async update(updates: Update[]): Promise<void> {
        if (updates.length === 0) return;
        const v = await cmd("command:scene:update-drawdy-elements", { updates: updates as { drawdyElementId: string; properties: UpdateableProperties }[] });
        if (v && typeof v.updated === "number" && v.updated < updates.length) {
            // Some element vanished under us; rediscover on the next pass.
            this.cacheReady = false;
            if (!this.target) this.retryLater();
        }
    }

    private retryLater(): void {
        // Bounded: if Drawdy's `updated` count means something other than we
        // assume, we must not rediscover the whole scene forever.
        if (this.retryTimer || this.stopped || this.mismatchRetries >= MAX_RETRIES) return;
        this.mismatchRetries++;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            const s = this.target ?? this.shown;
            if (s && !this.stopped) {
                this.shown = null;
                this.render(s);
            }
        }, 300);
    }
}

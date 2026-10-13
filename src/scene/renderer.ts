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

import type { DrawdyElementSchema, LocalAnimation, UpdateableProperties } from "@drawdy/driver-protocol";
import { cmd, isDdError, logError, sleep, tryCmd } from "../dd";
import type { BoardDef } from "../boards/types";
import type { GameState } from "../engine/types";
import { CENTER, tokenRect, type Rect } from "../boards/layout";
import { coinSvg, svgDataUrl, turnRingSvg } from "../art/index";
import { SEP, frameElementId, isRenderElementId, sceneElementId } from "../sync/envelope";
import {
    boardArtId,
    cashFlows,
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
import { DICE_ANIM_MS, diceAnimMs, diceTumble, shadowTumble } from "./dice-anim";
import {
    CONFETTI_MS,
    TOKEN_POOF_MS,
    buildingDrop,
    chipDeflate,
    chipStamp,
    coinFlight,
    coinFlightMs,
    confetti,
    ringPop,
    scorePunch,
    shockwave,
    shockwaveMs,
    slideIn,
    tokenDrop,
    tokenLeap,
    tokenPoof,
    tokenWalk,
    type Move,
} from "./fx";

/** Moves longer than this (or backwards) leap straight to the target. */
export const MAX_HOPS = 12;

/** Id kinds that wait for the action to finish before they're removed: scoreboard text, and tokens (they poof). */
const LATE_KINDS = new Set(["sbt", "sbs", "sbn", "sbd", "sbf", "tok"]);
const GAIN = "#1f9d55";
const LOSS = "#d64545";
const COIN = 44;
const MAX_COINS = 16;
const CONFETTI = 36;

const UNKNOWN = "?";
const MAX_RETRIES = 3;

type Update = { drawdyElementId: string; properties: LiveProps };

/** A token's planned move this pass: the baked animation, where it ends, and whether it lands with a bang. */
type PlannedMove = { seat: number; color: string; rect: Rect; big: boolean; move: Move };

function offset(r: Rect, o: Point): Rect {
    return { x: r.x + o.x, y: r.y + o.y, width: r.width, height: r.height };
}

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
    /** Per element: the pending follow-up (clear a finished animation, start the ring's breathing). */
    private followUps = new Map<string, ReturnType<typeof setTimeout>>();
    /** Follow-ups scheduled for the update about to be sent (that update must not cancel them). */
    private freshFollowUps = new Set<string>();
    private removeTimers = new Set<ReturnType<typeof setTimeout>>();
    /** Transient effect ids: unique per renderer instance, so a new authority never collides with leftovers. */
    private readonly fxNonce = Date.now().toString(36);
    private fxSeq = 0;

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
        for (const t of this.followUps.values()) clearTimeout(t);
        this.followUps.clear();
        for (const t of this.removeTimers) clearTimeout(t);
        this.removeTimers.clear();
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
     *
     * An animated pass is choreographed: owner markers stamp down and houses
     * drop in → fresh dice are thrown → once they land, tokens hop or leap,
     * and where they touch down a shockwave bursts and the turn ring pops →
     * coins fly from payer to payee → when the money arrives, the scoreboard
     * swaps its numbers with a punch. An unanimated pass (first render, after
     * a takeover) applies everything at once.
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
        const from = prev;

        // 1. Remove what's no longer wanted. When animating, old scoreboard
        // text stays until the action is over, and leaving tokens poof first.
        const stale = [...this.cache.keys()].filter((id) => !desired.has(id));
        for (const id of stale) this.cache.delete(id);
        const staleLate = from ? stale.filter((id) => LATE_KINDS.has(this.kindOf(id))) : [];
        await this.remove(stale.filter((id) => !staleLate.includes(id)));

        // 2. Plan token moves (only for tokens already on the canvas).
        const moves = from ? this.planMoves(from, next, origin, specs) : new Map<string, PlannedMove>();
        const landOf = new Map<number, number>();
        for (const m of moves.values()) landOf.set(m.seat, Math.max(landOf.get(m.seat) ?? 0, m.move.landMs));

        // 3. Add what's missing (scoreboard text waits when animating).
        const holdBack = (s: ElementSpec) => from !== null && s.role === "score";
        const added = await this.add(specs.filter((s) => !this.cache.has(s.id) && !holdBack(s)));

        // Rings whose token moves pop in where it lands, and name tags ride along, with the move batch below.
        const ringsLater = specs.filter((s) => s.role === "turn-ring" && s.seat !== undefined && landOf.has(s.seat));
        const tagsAlong = specs.filter((s) => s.role === "name-tag" && s.seat !== undefined && landOf.has(s.seat));
        const inMoveBatch = new Set([...moves.keys(), ...ringsLater.map((s) => s.id), ...tagsAlong.map((s) => s.id)]);

        // 4. Update what changed (including existing ids an add bumped into),
        // lock new elements, and bring new or changed pieces in with a flourish.
        const updates: Update[] = [];
        for (const s of specs) {
            if (holdBack(s) || inMoveBatch.has(s.id)) continue;
            const props = this.propsToApply(s, added.has(s.id));
            if (!props) continue;
            const anim = this.introFor(s, added.has(s.id), from, next);
            if (anim) props.localAnimation = anim;
            updates.push({ drawdyElementId: s.id, properties: props });
        }
        await this.update(updates);
        for (const s of specs) if (!holdBack(s) && !inMoveBatch.has(s.id)) this.cache.set(s.id, propsKey(s.props));

        // 5. Fresh dice: reveal them. After a real roll they are thrown in (all at
        // once, same start frame), and tokens wait until the dice have landed.
        const fresh = specs.filter((s) => (s.role === "die" || s.role === "die-shadow") && added.has(s.id));
        if (fresh.length > 0) {
            const seed = rollKey(next);
            const doubles = !!next.dice && next.dice[0] === next.dice[1];
            await this.update(
                fresh.map((s) => ({
                    drawdyElementId: s.id,
                    properties: from
                        ? { opacity: 1, localAnimation: (s.role === "die" ? diceTumble : shadowTumble)(seed, s.die ?? 0, doubles) }
                        : { opacity: 1 },
                }))
            );
            if (from) {
                for (const s of fresh) this.after(s.id, diceAnimMs(doubles) + 300, { localAnimation: null });
                await sleep(DICE_SETTLE_MS);
                if (this.stopped) return; // game deleted / authority lost while the dice rolled
            }
        }

        // 6. The action: moves, landing bursts, money, departures, confetti — one batch, timed by baked delays.
        let busy = 0;
        if (from) busy = await this.playAction(from, next, origin, desired, moves, ringsLater, tagsAlong, landOf, staleLate, added);

        // 7. When it's over: swap the scoreboard text.
        if (from) {
            if (busy > 0) await sleep(busy);
            if (this.stopped) return;
            await this.remove(staleLate);
            const late = specs.filter((s) => holdBack(s) && !this.cache.has(s.id));
            const addedLate = await this.add(late);
            const lateUpdates: Update[] = [];
            for (const s of specs) {
                if (!holdBack(s)) continue;
                const props = this.propsToApply(s, addedLate.has(s.id));
                if (!props) continue;
                const anim = addedLate.has(s.id) ? this.scoreAnim(s, from, next) : null;
                if (anim) {
                    props.localAnimation = anim;
                    this.after(s.id, anim.time.durationMs + 300, { localAnimation: null });
                }
                lateUpdates.push({ drawdyElementId: s.id, properties: props });
            }
            await this.update(lateUpdates);
            for (const s of specs) if (holdBack(s)) this.cache.set(s.id, propsKey(s.props));
        }

        // 8. Frame name shows the status.
        const title = frameTitle(this.board, next);
        if (title !== this.lastFrameName) {
            await cmd("command:scene:update-drawdy-elements", {
                updates: [{ drawdyElementId: this.frameId, properties: { frameName: title, locked: true } }],
            });
            this.lastFrameName = title;
        }
    }

    /** Props to (re)apply to a spec's element this pass, or null when it's up to date. */
    private propsToApply(s: ElementSpec, isNew: boolean): LiveProps | null {
        const cached = this.cache.get(s.id);
        if (isNew) {
            const props: LiveProps = { ...s.props, locked: true };
            if (s.role === "turn-ring") props.localAnimation = turnRingPulse();
            return props;
        }
        if (cached === propsKey(s.props)) return null;
        const props: LiveProps = { ...s.props };
        if (cached === UNKNOWN || cached === undefined) props.locked = true;
        return Object.keys(props).length > 0 ? props : null;
    }

    /** Entrance / change animation for a piece in step 4 (null = none). Schedules its own clean-up. */
    private introFor(s: ElementSpec, isNew: boolean, from: GameState | null, next: GameState): LocalAnimation | null {
        if (!from) return null;
        let anim: LocalAnimation | null = null;
        let then: LiveProps = { localAnimation: null };
        if (isNew && s.role === "turn-ring") {
            anim = ringPop();
            then = { localAnimation: turnRingPulse() };
        } else if (isNew && s.role === "building") {
            anim = buildingDrop(s.slot ?? 0, s.id.includes(`${SEP}hotel${SEP}`));
        } else if (isNew && (s.role === "token" || s.role === "name-tag")) {
            anim = tokenDrop(s.seat !== undefined ? s.seat * 80 : 0);
        } else if (isNew && s.role === "chip" && s.tile !== undefined) {
            const a = from.ownership[String(s.tile)];
            const b = next.ownership[String(s.tile)];
            if (a && b && a.owner === b.owner && !a.mortgaged && b.mortgaged) anim = chipDeflate();
            else anim = chipStamp();
        }
        if (anim) this.after(s.id, anim.time.durationMs + 300, then);
        return anim;
    }

    /** Pop for a scoreboard line that just changed; cash gains flash green, losses red. */
    private scoreAnim(s: ElementSpec, from: GameState, next: GameState): LocalAnimation | null {
        if (s.part === "detail" && s.seat !== undefined) {
            const a = from.players[s.seat];
            const b = next.players[s.seat];
            const d = a && b ? b.cash - a.cash : 0;
            return scorePunch(d > 0 ? GAIN : d < 0 ? LOSS : null, this.board.palette.text);
        }
        if (s.part === "name") return scorePunch(null, this.board.palette.text);
        if (s.part === "status" || s.part === "footer") return slideIn();
        return null;
    }

    /**
     * Steps 6: one update batch that sets every moving token to its final rect
     * with its baked hop/leap (FLIP: the element is already where it ends up,
     * the keyframes play the way there from where it was; they stay attached
     * until the next move swaps them), pops rings where tokens land, bursts
     * shockwaves, flies coins and poofs departing tokens. Transient effect elements are
     * added hidden first and removed when done. Returns how long to wait
     * before the scoreboard may change (the money has arrived).
     */
    private async playAction(
        from: GameState,
        next: GameState,
        origin: Point,
        desired: Map<string, ElementSpec>,
        moves: Map<string, PlannedMove>,
        ringsLater: ElementSpec[],
        tagsAlong: ElementSpec[],
        landOf: Map<number, number>,
        staleLate: string[],
        added: Set<string>
    ): Promise<number> {
        const batch: Update[] = [];
        const fx: { schema: DrawdyElementSchema; anim: LocalAnimation; lifeMs: number }[] = [];
        let busy = 0;

        for (const [id, m] of moves) {
            const s = desired.get(id)!;
            const props: LiveProps = { ...s.props, localAnimation: m.move.anim };
            if (this.cache.get(id) === UNKNOWN) props.locked = true;
            batch.push({ drawdyElementId: id, properties: props });
            busy = Math.max(busy, m.move.landMs);
            if (m.big) {
                const r = turnRingRect(m.rect);
                fx.push({ schema: this.fxImage(r, svgDataUrl(turnRingSvg(m.color))), anim: shockwave(m.move.landMs), lifeMs: shockwaveMs(m.move.landMs) });
            }
        }
        // A name tag follows its token's path (x/y only: it doesn't squash, lean
        // or spin). A tag that was just replaced (the tile got more or less
        // crowded, so its text changed) pops in when the token lands instead.
        for (const tag of tagsAlong) {
            const m = [...moves.values()].find((mv) => mv.seat === tag.seat);
            if (!m) continue;
            const { x, y } = m.move.anim.animation.transform;
            const anim: LocalAnimation = added.has(tag.id)
                ? ringPop(m.move.landMs)
                : { time: m.move.anim.time, animation: { transform: { ...(x ? { x } : {}), ...(y ? { y } : {}) }, curve: m.move.anim.animation.curve } };
            const props: LiveProps = { ...tag.props, localAnimation: anim };
            if (added.has(tag.id) || this.cache.get(tag.id) === UNKNOWN) props.locked = true;
            batch.push({ drawdyElementId: tag.id, properties: props });
        }
        for (const ring of ringsLater) {
            const props: LiveProps = { ...ring.props, localAnimation: ringPop(landOf.get(ring.seat!) ?? 0) };
            if (added.has(ring.id) || this.cache.get(ring.id) !== propsKey(ring.props)) props.locked = true;
            batch.push({ drawdyElementId: ring.id, properties: props });
            this.after(ring.id, props.localAnimation!.time.durationMs + 100, { localAnimation: turnRingPulse() });
        }

        // Money: coins fly once everyone has landed.
        const coinStart = busy;
        const seatPoint = (seat: number | null): Point => {
            const tok = seat === null ? undefined : [...desired.values()].find((s) => s.role === "token" && s.seat === seat);
            const t = tok?.props.transform;
            if (tok && t?.x !== undefined && t.y !== undefined) return { x: t.x + (tok.props.width ?? 64) / 2, y: t.y + (tok.props.height ?? 64) / 2 };
            return { x: origin.x + CENTER.x + CENTER.width / 2, y: origin.y + CENTER.y + CENTER.height / 2 };
        };
        const flows = cashFlows(from, next).filter((f) => f.amount > 0);
        const counts = flows.map((f) => Math.min(7, Math.max(2, Math.ceil(f.amount / 50))));
        const total = counts.reduce((a, b) => a + b, 0);
        const scale = total > MAX_COINS ? MAX_COINS / total : 1;
        flows.forEach((f, k) => {
            const a = seatPoint(f.from);
            const b = seatPoint(f.to);
            const n = Math.max(1, Math.round(counts[k]! * scale));
            for (let j = 0; j < n; j++) {
                const delay = coinStart + k * 140 + j * 60;
                const r = { x: b.x - COIN / 2, y: b.y - COIN / 2, width: COIN, height: COIN };
                const life = coinFlightMs(a, b, delay);
                fx.push({ schema: this.fxImage(r, svgDataUrl(coinSvg())), anim: coinFlight(a, b, delay, k * 7 + j + 1), lifeMs: life });
                busy = Math.max(busy, life);
            }
        });

        // Departing tokens (bankrupt, or a lobby player changing token/color).
        for (const id of staleLate) {
            if (this.kindOf(id) !== "tok") continue;
            batch.push({ drawdyElementId: id, properties: { localAnimation: tokenPoof() } });
            busy = Math.max(busy, TOKEN_POOF_MS);
        }

        // The end: confetti from the middle of the board.
        if (next.phase.kind === "game-over" && from.phase.kind !== "game-over") {
            const colors = [...next.players.map((p) => p.color), "#ffd23f", "#ffffff", "#ff5ca8", "#33d1ff"];
            const cx = origin.x + CENTER.x + CENTER.width / 2;
            const cy = origin.y + CENTER.y + CENTER.height / 2;
            const salt = rollKey(next);
            for (let i = 0; i < CONFETTI; i++) {
                const c = colors[i % colors.length]!;
                const w = 12 + (i % 3) * 4;
                fx.push({
                    schema: {
                        type: "shape",
                        componentType: i % 4 === 0 ? "circle" : "rect",
                        drawdyElementId: this.fxId(),
                        frameId: this.frameId,
                        x: cx - w / 2,
                        y: cy - w,
                        width: w,
                        height: w * 1.6,
                        strokeColor: c,
                        fillColor: c,
                        strokeWidth: 1,
                        fillStyle: "solid",
                        cornerRadius: 2,
                        roughness: 0,
                        opacity: 0,
                    },
                    anim: confetti(i, CONFETTI, salt),
                    lifeMs: CONFETTI_MS,
                });
            }
        }

        // Transient elements: add hidden, reveal with their animation in the same batch as the moves.
        if (fx.length > 0) {
            try {
                await cmd("command:scene:add-drawdy-elements", { elements: fx.map((f) => f.schema) });
                for (const f of fx) {
                    batch.push({ drawdyElementId: f.schema.drawdyElementId, properties: { opacity: 1, locked: true, localAnimation: f.anim } });
                }
                const byLife = new Map<number, string[]>();
                for (const f of fx) {
                    const at = Math.ceil((f.lifeMs + 200) / 500) * 500; // fewer timers: bucket removals
                    byLife.set(at, [...(byLife.get(at) ?? []), f.schema.drawdyElementId]);
                }
                for (const [at, ids] of byLife) this.removeLater(ids, at);
            } catch (e) {
                logError(e, "fx"); // effects are decoration; the game state is drawn regardless
            }
        }

        await this.update(batch);
        for (const id of moves.keys()) {
            const s = desired.get(id);
            if (s) this.cache.set(id, propsKey(s.props));
        }
        for (const s of [...ringsLater, ...tagsAlong]) this.cache.set(s.id, propsKey(s.props));
        return busy;
    }

    /**
     * How every token already on the canvas gets to its new rect: a walk
     * tile by tile for ordinary forward moves, a leap for everything else
     * (jail, cards, backwards), and a little skip for tokens shuffling over
     * on a tile to make room (after the newcomer lands).
     */
    private planMoves(prev: GameState, next: GameState, origin: Point, specs: ElementSpec[]): Map<string, PlannedMove> {
        const moves = new Map<string, PlannedMove>();
        const prevSlots = tokenSlots(prev);
        const nextSlots = tokenSlots(next);
        const shuffles: { id: string; seat: number; color: string; from: Rect; to: Rect; arriving: boolean }[] = [];
        for (const s of specs) {
            if (s.role !== "token" || s.seat === undefined || !this.cache.has(s.id)) continue;
            const a = prev.players[s.seat];
            const b = next.players[s.seat];
            const ps = prevSlots.get(s.seat);
            const ns = nextSlots.get(s.seat);
            if (!a || !b || !ps || !ns || a.bankrupt || b.bankrupt) continue;
            if (a.token !== b.token || a.color !== b.color) continue;
            const t = s.props.transform;
            if (!t || t.x === undefined || t.y === undefined) continue;
            const to: Rect = { x: t.x, y: t.y, width: s.props.width ?? 64, height: s.props.height ?? 64 };
            const fromRect = offset(tokenRect(ps.tile, ps.slot, ps.jailed, ps.count), origin);
            if (fromRect.x === to.x && fromRect.y === to.y && fromRect.width === to.width) continue;
            const steps = (b.position - a.position + 40) % 40;
            if (ps.tile === ns.tile && ps.jailed === ns.jailed) {
                shuffles.push({ id: s.id, seat: s.seat, color: b.color, from: fromRect, to, arriving: ns.count > ps.count });
            } else if (!a.inJail && !b.inJail && steps >= 1 && steps <= MAX_HOPS) {
                // Intermediate tiles are passed alone (full size); the last hop lands on the real rect and size.
                const stops: Rect[] = [fromRect];
                for (let k = 1; k < steps; k++) stops.push(offset(tokenRect((a.position + k) % 40, 0, false, 1), origin));
                stops.push(to);
                moves.set(s.id, { seat: s.seat, color: b.color, rect: to, big: true, move: tokenWalk(stops) });
            } else {
                moves.set(s.id, { seat: s.seat, color: b.color, rect: to, big: true, move: tokenLeap(fromRect, to) });
            }
        }
        const landed = Math.max(0, ...[...moves.values()].map((m) => m.move.landMs));
        for (const sh of shuffles) {
            const move = tokenLeap(sh.from, sh.to, sh.arriving ? Math.max(0, landed - 60) : 120);
            moves.set(sh.id, { seat: sh.seat, color: sh.color, rect: sh.to, big: false, move });
        }
        return moves;
    }

    /** The kind segment of one of our ids: `${gameId}:${kind}:…`. */
    private kindOf(id: string): string {
        return id.slice(this.gameId.length + SEP.length).split(SEP)[0] ?? "";
    }

    private fxId(): string {
        return sceneElementId(this.gameId, "fx", this.fxNonce, (this.fxSeq++).toString(36));
    }

    private fxImage(r: Rect, url: string): DrawdyElementSchema {
        const id = this.fxId();
        return {
            type: "component",
            drawdyElementId: id,
            frameId: this.frameId,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            opacity: 0,
            schema: { type: "image", child: url, styles: { width: [r.width, "px"], height: [r.height, "px"], pointerEvents: "none" } },
        };
    }

    /**
     * Apply `properties` to `id` after `ms` (clear a finished animation, start
     * the ring's breathing). Setting a new animation on the element through
     * update() cancels it, so a stale follow-up never clobbers a newer move.
     * Best effort: the element may be gone by then.
     */
    private after(id: string, ms: number, properties: LiveProps): void {
        const old = this.followUps.get(id);
        if (old) clearTimeout(old);
        const timer = setTimeout(() => {
            this.followUps.delete(id);
            if (this.stopped) return;
            cmd("command:scene:update-drawdy-elements", { updates: [{ drawdyElementId: id, properties }] }).catch(() => {});
        }, ms);
        this.followUps.set(id, timer);
        this.freshFollowUps.add(id);
    }

    /** Remove transient effect elements after `ms`. Leftovers (we lost authority) are swept by the next authority's discovery. */
    private removeLater(ids: string[], ms: number): void {
        const timer = setTimeout(() => {
            this.removeTimers.delete(timer);
            cmd("command:scene:remove-drawdy-elements", { drawdyElementIds: ids }).catch(() => {});
        }, ms);
        this.removeTimers.add(timer);
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
        // Look first: a failed add shows an error toast in the platform, so avoid expected collisions.
        if (pending.length > 0) {
            const found = await tryCmd("command:scene:get-drawdy-elements", {
                drawdyElementIds: pending.map((el) => el.drawdyElementId),
                properties: ["type"],
            });
            if (found) {
                const have = new Set(found.drawdyElements.map((e) => e.id));
                for (const id of have) this.cache.set(id, UNKNOWN);
                pending = pending.filter((el) => !have.has(el.drawdyElementId));
            }
        }
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
        for (const u of updates) {
            // A new animation supersedes any follow-up still pending for this element, unless the caller just scheduled it.
            if (u.properties.localAnimation === undefined) continue;
            const t = this.followUps.get(u.drawdyElementId);
            if (t && !this.freshFollowUps.has(u.drawdyElementId)) {
                clearTimeout(t);
                this.followUps.delete(u.drawdyElementId);
            }
        }
        this.freshFollowUps.clear();
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

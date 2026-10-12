// Juice: local animations for everything that changes on the board — tokens
// hopping tile to tile, leaps to jail, the turn ring popping in, owner chips
// stamping down, houses dropping in, coins flying between players, scoreboard
// numbers punching, confetti at the end.
//
// Drawdy spaces keyframes evenly over (linear) time and interpolates them with
// a Catmull-Rom spline, so every animation here is baked: a pose function of
// time in ms is sampled on a uniform grid. Pure and deterministic.
//
// Conventions (see the LocalAnimation docs): x/y are offsets in canvas units
// from where the element rests, width/height scale about its center, rotation
// is radians about its center, opacity multiplies. Every animation ends on the
// exact rest pose so holding the last frame shows the element where the layout
// put it.

import type { ColorComponents, LocalAnimation, LocalAnimationTransform } from "@drawdy/driver-protocol";
import type { Rect } from "../boards/layout";

/** Sampling step. Hop and phase lengths are multiples of it so impacts land on a keyframe. */
export const FX_STEP_MS = 20;

export type Pose = { x?: number; y?: number; sx?: number; sy?: number; rot?: number; op?: number };

const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1000) / 1000);
const snap = (ms: number) => Math.max(FX_STEP_MS * 2, Math.round(ms / FX_STEP_MS) * FX_STEP_MS);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** A damped wobble: starts at `amp`, rings at `periodMs`, dies out by ~4 decay constants. */
const wobble = (t: number, amp: number, periodMs: number, decayMs: number) => amp * Math.exp(-t / decayMs) * Math.cos((2 * Math.PI * t) / periodMs);

/**
 * Sample `pose` every FX_STEP_MS over `durationMs`. The last frame is forced
 * to the rest pose unless `endAtRest` is false (transient effects that end
 * invisible and are removed). Constant tracks are dropped.
 */
export function bake(durationMs: number, pose: (t: number) => Pose, endAtRest = true): LocalAnimation {
    const n = Math.max(2, Math.round(durationMs / FX_STEP_MS) + 1);
    const tracks: Record<"x" | "y" | "width" | "height" | "rotation" | "opacity", number[]> = { x: [], y: [], width: [], height: [], rotation: [], opacity: [] };
    for (let i = 0; i < n; i++) {
        const p = i === n - 1 && endAtRest ? {} : pose((i / (n - 1)) * durationMs);
        tracks.x.push(clean(p.x ?? 0));
        tracks.y.push(clean(p.y ?? 0));
        tracks.width.push(clean(p.sx ?? 1));
        tracks.height.push(clean(p.sy ?? 1));
        tracks.rotation.push(clean(p.rot ?? 0));
        tracks.opacity.push(clean(clamp(p.op ?? 1, 0, 1)));
    }
    const transform: LocalAnimationTransform = {};
    for (const [k, v] of Object.entries(tracks) as [keyof typeof tracks, number[]][]) {
        if (v.some((x) => x !== v[v.length - 1])) transform[k] = v;
    }
    return {
        time: { durationMs: (n - 1) * FX_STEP_MS, curve: "linear", repeat: "none" },
        animation: { transform, curve: "catmull" },
    };
}

/** Attach a color track (it replaces the element's color while the animation is attached). */
export function withColor(anim: LocalAnimation, key: "fillColor" | "textColor" | "strokeColor", colors: ColorComponents[]): LocalAnimation {
    return { ...anim, animation: { ...anim.animation, transform: { ...anim.animation.transform, [key]: { type: "rgb", components: colors } } } };
}

/** "#rrggbb" / "#rgb" → [r, g, b]; anything else → mid grey. */
export function hexRgb(hex: string): ColorComponents {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return [136, 136, 136];
    const s = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

// ---------------------------------------------------------------------------
// tokens

/** A token's whole move, baked: `anim` for the token and when it touches down for good. */
export type Move = { anim: LocalAnimation; landMs: number; durationMs: number };

const CROUCH_MS = 100;
const SETTLE_MS = 300;
const HOP_HEIGHT = 34;

/** Per-tile hop length: short walks are bouncy, long ones hurry a little. */
export function hopMs(steps: number): number {
    return snap(clamp(150 - steps * 3, 100, 140));
}

/** Squash (sq > 0) / stretch (sq < 0) with the bottom edge kept on the floor. */
function squash(sq: number, size: number, scale: number): Pose {
    const sy = 1 - sq;
    return { sx: (1 + sq) * scale, sy: sy * scale, y: (size * scale * (1 - sy)) / 2 };
}

/**
 * Hop along `stops` (rects on the canvas: where the token stands now, every
 * tile it passes, and last its final rect, which is also where the element
 * rests). Crouch, hop each tile with a little lean and squash on every
 * touch-down, then a springy settle. `delayMs` holds the start pose first.
 */
export function tokenWalk(stops: Rect[], delayMs = 0): Move {
    const end = stops[stops.length - 1]!;
    const c1 = center(end);
    const pts = stops.map((r) => {
        const c = center(r);
        return { dx: c.x - c1.x, dy: c.y - c1.y, sc: r.width / end.width };
    });
    const hops = stops.length - 1;
    const hop = hopMs(hops);
    const size = end.height;
    const delay = delayMs > 0 ? snap(delayMs) : 0;
    const takeoff = delay + CROUCH_MS;
    const landMs = takeoff + hops * hop;
    const durationMs = landMs + SETTLE_MS;
    const GROUND = 0.2; // share of each later hop spent squashed on the tile it just reached

    const anim = bake(durationMs, (t) => {
        if (t < takeoff) {
            const p = pts[0]!;
            const sq = t < delay ? 0 : 0.14 * Math.sin((Math.PI * (t - delay)) / CROUCH_MS);
            const s = squash(sq, size, p.sc);
            return { ...s, x: p.dx, y: p.dy + (s.y ?? 0) };
        }
        if (t < landMs) {
            const k = Math.min(hops - 1, Math.floor((t - takeoff) / hop));
            const s = (t - takeoff - k * hop) / hop;
            const a = pts[k]!;
            const b = pts[k + 1]!;
            if (k > 0 && s < GROUND) {
                const sq = 0.12 * Math.sin((Math.PI * s) / GROUND);
                const q = squash(sq, size, a.sc);
                return { ...q, x: a.dx, y: a.dy + (q.y ?? 0) };
            }
            const u = k > 0 ? (s - GROUND) / (1 - GROUND) : s;
            const dir = Math.sign(b.dx - a.dx) || (k % 2 ? 1 : -1) * 0.5;
            const sc = lerp(a.sc, b.sc, u);
            const stretch = -0.1 * Math.abs(1 - 2 * u);
            const q = squash(stretch, size, sc);
            return {
                ...q,
                x: lerp(a.dx, b.dx, u),
                y: lerp(a.dy, b.dy, u) - HOP_HEIGHT * 4 * u * (1 - u) + (q.y ?? 0),
                rot: 0.14 * dir * Math.sin(Math.PI * u),
            };
        }
        const q = squash(wobble(t - landMs, 0.24, 200, 85), size, 1);
        return q;
    });
    return { anim, landMs, durationMs: anim.time.durationMs };
}

/**
 * One big arc from `from` to the token's resting rect `to`: card jumps, going
 * to jail, getting out, backwards moves. Far leaps spin. Short ones (a token
 * sliding over to make room) are a quick skip, optionally after `delayMs`.
 */
export function tokenLeap(from: Rect, to: Rect, delayMs = 0): Move {
    const a = center(from);
    const b = center(to);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.hypot(dx, dy);
    const small = dist < 90;
    const sc0 = from.width / to.width;
    const delay = delayMs > 0 ? snap(delayMs) : 0;
    const crouch = small ? 0 : CROUCH_MS + 40;
    const flight = small ? snap(220) : snap(clamp(360 + dist * 0.45, 420, 860));
    const height = small ? 16 : clamp(50 + dist * 0.3, 60, 240);
    const spin = small || dist < 260 ? 0 : (dx > 0 ? -1 : 1) * 2 * Math.PI;
    const takeoff = delay + crouch;
    const landMs = takeoff + flight;
    const settle = small ? 180 : SETTLE_MS + 60;
    const size = to.height;

    const anim = bake(landMs + settle, (t) => {
        if (t < takeoff) {
            const sq = t < delay || crouch === 0 ? 0 : 0.2 * Math.sin((Math.PI * (t - delay)) / crouch);
            const s = squash(sq, size, sc0);
            // A spin runs -2π → 0 so it ends exactly at rest (-2π looks the same as 0 before takeoff).
            return { ...s, x: dx, y: dy + (s.y ?? 0), rot: -spin };
        }
        if (t < landMs) {
            const u = easeInOut((t - takeoff) / flight);
            const sc = lerp(sc0, 1, u) * (1 + (small ? 0 : 0.25) * Math.sin(Math.PI * u)); // grows toward the "camera" at the apex
            const q = squash(-0.12 * Math.abs(1 - 2 * u), size, sc);
            return { ...q, x: lerp(dx, 0, u), y: lerp(dy, 0, u) - height * 4 * u * (1 - u) + (q.y ?? 0), rot: -spin * (1 - u) };
        }
        return squash(wobble(t - landMs, small ? 0.12 : 0.3, 220, 90), size, 1);
    });
    return { anim, landMs, durationMs: anim.time.durationMs };
}

/** A token joining the game: drops in from above and splats. */
export function tokenDrop(delayMs = 0): LocalAnimation {
    const delay = snap(delayMs);
    const fall = 260;
    return bake(delay + fall + 320, (t) => {
        if (t < delay) return { op: 0 };
        if (t < delay + fall) {
            const u = (t - delay) / fall;
            return { y: -160 * (1 - u * u), op: Math.min(1, u * 3), sx: 0.9, sy: 1.15 };
        }
        const w = wobble(t - delay - fall, 0.3, 200, 80);
        return { sx: 1 + w, sy: 1 - w };
    });
}

/** A token leaving the game (bankrupt): shudder, spin away and shrink to nothing. */
export function tokenPoof(): LocalAnimation {
    return bake(620, (t) => {
        if (t < 180) return { x: 5 * Math.sin(t / 12), rot: 0.08 * Math.sin(t / 15) };
        const u = (t - 180) / 440;
        return { sx: Math.max(0.01, 1 - u), sy: Math.max(0.01, 1 - u), rot: u * 4 * Math.PI, y: -40 * u, op: 1 - u * u };
    }, false);
}

/** tokenPoof ends invisible; remove the element after this. */
export const TOKEN_POOF_MS = 620;

// ---------------------------------------------------------------------------
// turn ring

/** The ring pops in (with overshoot) after `delayMs`, hidden until then. */
export function ringPop(delayMs = 0): LocalAnimation {
    const delay = snap(delayMs);
    return bake(delay + 420, (t) => {
        if (t < delay) return { op: 0, sx: 0.3, sy: 0.3 };
        const u = (t - delay) / 420;
        const s = 0.3 + 0.7 * easeOutBack(Math.min(1, u * 1.25));
        return { sx: s, sy: s, op: Math.min(1, u * 4) };
    });
}

/** A shockwave ring that bursts out from where a token lands. */
export function shockwave(delayMs: number): LocalAnimation {
    const delay = snap(delayMs);
    return bake(delay + 480, (t) => {
        if (t < delay) return { op: 0, sx: 0.5, sy: 0.5 };
        const u = (t - delay) / 480;
        const s = 0.5 + 1.9 * (1 - (1 - u) ** 3);
        return { sx: s, sy: s, op: 0.9 * (1 - u) ** 1.5 };
    }, false);
}

/** Shockwave elements end invisible; remove them after this. */
export function shockwaveMs(delayMs: number): number {
    return snap(delayMs) + 480;
}

// ---------------------------------------------------------------------------
// board pieces

/** Owner marker stamped down: slams in big from nothing, overshoots and settles. */
export function chipStamp(delayMs = 0): LocalAnimation {
    const delay = snap(delayMs);
    return bake(delay + 520, (t) => {
        if (t < delay) return { sx: 0, sy: 0, op: 0 };
        const u = (t - delay) / 520;
        const s = u < 0.3 ? lerp(2.4, 0.8, easeInOut(u / 0.3)) : 1 + wobble((u - 0.3) * 520, -0.2, 190, 70);
        return { sx: s, sy: s, op: Math.min(1, u * 6) };
    });
}

/** Owner marker mortgaged (the hatched one replacing it): sags in with a sad wobble. */
export function chipDeflate(): LocalAnimation {
    return bake(480, (t) => {
        const u = t / 480;
        const s = u < 0.3 ? 1 - 0.4 * Math.sin((Math.PI * u) / 0.6) : 1 + wobble((u - 0.3) * 480, -0.25, 200, 80);
        return { sx: s, sy: s, rot: 0.25 * Math.sin(u * Math.PI * 3) * (1 - u) };
    });
}

/** A house or hotel dropping onto its tile, `index` staggers several placed at once. */
export function buildingDrop(index: number, big: boolean): LocalAnimation {
    const delay = snap(index * 90);
    const fall = big ? 300 : 240;
    const height = big ? 140 : 90;
    return bake(delay + fall + 340, (t) => {
        if (t < delay) return { op: 0, y: -height };
        if (t < delay + fall) {
            const u = (t - delay) / fall;
            return { y: -height * (1 - u * u), op: Math.min(1, u * 4), sx: 0.85, sy: 1.2, rot: (big ? 0.3 : 0.5) * (1 - u) * (index % 2 ? 1 : -1) };
        }
        const w = wobble(t - delay - fall, big ? 0.4 : 0.35, 180, 75);
        return { sx: 1 + w, sy: 1 - w, y: 0 };
    });
}

// ---------------------------------------------------------------------------
// money

/**
 * A coin flying from `from` to `to` (canvas centers) relative to where the
 * coin element rests (centered on `to`): it pops out, arcs over, spins, and
 * shrinks into the target. Ends invisible at rest; remove it afterwards.
 */
export function coinFlight(from: { x: number; y: number }, to: { x: number; y: number }, delayMs: number, salt: number): LocalAnimation {
    const delay = snap(delayMs);
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const dist = Math.hypot(dx, dy);
    const flight = snap(clamp(380 + dist * 0.25, 420, 720));
    const height = clamp(80 + dist * 0.25, 90, 260) * (0.8 + 0.4 * ((salt * 0.618) % 1));
    const spread = ((salt * 0.381) % 1) * 60 - 30;
    const pop = 120;
    return bake(delay + pop + flight + 60, (t) => {
        if (t < delay) return { op: 0, x: dx, y: dy, sx: 0, sy: 0 };
        if (t < delay + pop) {
            const u = (t - delay) / pop;
            const s = easeOutBack(u);
            return { x: dx + spread * 0.3 * u, y: dy - 30 * u, sx: s, sy: s, op: 1 };
        }
        if (t < delay + pop + flight) {
            const u = (t - delay - pop) / flight;
            const e = easeInOut(u);
            const s = 1 - 0.45 * u * u;
            return {
                x: lerp(dx + spread * 0.3, 0, e) + spread * Math.sin(Math.PI * u),
                y: lerp(dy - 30, 0, e) - height * 4 * u * (1 - u),
                sx: s * Math.abs(Math.cos(u * Math.PI * 3)) + 0.08, // a flat coin flipping end over end
                sy: s,
                op: 1,
            };
        }
        return { op: 0, sx: 0.2, sy: 0.2 };
    }, false);
}

export function coinFlightMs(from: { x: number; y: number }, to: { x: number; y: number }, delayMs: number): number {
    return snap(delayMs) + 120 + snap(clamp(380 + Math.hypot(from.x - to.x, from.y - to.y) * 0.25, 420, 720)) + 60;
}

/** Scoreboard number that just changed: punch in big, flashing gain/loss color into its own. */
export function scorePunch(flash: string | null, rest: string): LocalAnimation {
    const anim = bake(560, (t) => {
        const s = 1 + wobble(t, 0.28, 260, 120);
        return { sx: s, sy: s, x: t < 80 ? (flash ? 6 * Math.sin(t / 8) : 0) : 0 };
    });
    if (!flash) return anim;
    const n = anim.animation.transform.width?.length ?? 2;
    const a = hexRgb(flash);
    const b = hexRgb(rest);
    return withColor(anim, "textColor", Array.from({ length: n }, (_, i) => {
        const u = clamp((i / (n - 1) - 0.35) / 0.65, 0, 1);
        return [0, 1, 2].map((c) => Math.round(lerp(a[c]!, b[c]!, u))) as ColorComponents;
    }));
}

/** Text that replaced older text (status line, whose turn): slides in from the left. */
export function slideIn(): LocalAnimation {
    return bake(360, (t) => {
        const u = t / 360;
        return { x: -40 * (1 - easeOutBack(u)), op: Math.min(1, u * 2.5) };
    });
}

// ---------------------------------------------------------------------------
// game over

/** One confetti piece flung from the board center: up and out, tumbling, falling with gravity, fading. */
export function confetti(i: number, count: number, salt: number): LocalAnimation {
    const r = (k: number) => {
        let h = Math.imul((salt + 7) | 0, 0x9e3779b1) ^ Math.imul(i * 31 + k + 1, 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
    };
    const angle = (i / count) * Math.PI * 2 + r(1) * 0.6;
    const speed = 0.55 + r(2) * 0.7; // canvas units per ms
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 0.75;
    const g = 0.0014;
    const spin = (r(3) - 0.5) * 0.04;
    const delay = snap(r(4) * 160);
    const life = 1600;
    return bake(delay + life, (t) => {
        if (t < delay) return { op: 0, sx: 0, sy: 0 };
        const u = t - delay;
        const flutter = Math.abs(Math.cos(u / (60 + r(5) * 60)));
        return { x: vx * u, y: vy * u + 0.5 * g * u * u, rot: spin * u, sx: 1, sy: 0.2 + 0.8 * flutter, op: u > life * 0.65 ? 1 - (u - life * 0.65) / (life * 0.35) : 1 };
    }, false);
}

export const CONFETTI_MS = 1600 + 160 + FX_STEP_MS;

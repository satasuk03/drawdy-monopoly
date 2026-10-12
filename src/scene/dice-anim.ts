// Local animations for a freshly rolled pair of dice: thrown in from the side,
// dropped from a height with three decaying bounces, spinning down to rest.
// Drawdy interpolates keyframes with a Catmull-Rom spline over *linear* time,
// so all easing and physics is baked into the keyframe values here. Pure and
// deterministic (seeded hash, no Math.random): same roll → same throw.
//
// Every track ends on the exact rest pose (offset 0, scale 1, no rotation,
// opacity 1), so when the animation holds its last frame the die sits where
// the layout put it.

import type { LocalAnimation, LocalAnimationTransform } from "@drawdy/driver-protocol";

export const DICE_ANIM_MS = 1100;

const DROP_HEIGHT = 110;
const RESTITUTION = 0.45;
/** Keyframes per phase after the first one: the fall, then bounce 1, 2, 3 (total 28 keyframes). */
const PHASE_SAMPLES = [9, 8, 6, 4];

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/** Deterministic value in [0, 1) from a seed and a salt. */
function rand(seed: number, salt: number): number {
    let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

type Frame = {
    /** Progress 0..1 across the animation. */
    u: number;
    /** Height of the die above the floor from bouncing alone. */
    h: number;
    /** 0 = in the air, 1 = on the floor (a squash is applied at impacts below). */
    impact: number;
};

/** Progress/height samples of "drop + 3 bounces", dense around each impact. */
function bounceFrames(): Frame[] {
    // Flight time of each phase relative to the fall: 1, 2e, 2e², 2e³.
    const flights = [1, 2 * RESTITUTION, 2 * RESTITUTION ** 2, 2 * RESTITUTION ** 3];
    const total = flights.reduce((a, b) => a + b, 0);
    const frames: Frame[] = [{ u: 0, h: DROP_HEIGHT, impact: 0 }];
    let start = 0;
    flights.forEach((flight, k) => {
        const n = PHASE_SAMPLES[k]!;
        const apex = DROP_HEIGHT * RESTITUTION ** (2 * k);
        for (let i = 1; i <= n; i++) {
            const s = i / n;
            const h = k === 0 ? DROP_HEIGHT * (1 - s * s) : apex * 4 * s * (1 - s);
            frames.push({ u: (start + flight * s) / total, h, impact: i === n ? 1 : 0 });
        }
        start += flight;
    });
    frames[frames.length - 1]!.u = 1;
    return frames;
}

type Throw = { frames: Frame[]; x: number[]; lift: number[]; height: number[] };

/** Shared by die and shadow: the horizontal path and total height above the floor per keyframe. */
function throwPath(seed: number, die: 0 | 1): Throw {
    const frames = bounceFrames();
    const x0 = -(200 + rand(seed, 10 + die) * 60); // both dice come from the left
    const lift0 = -(10 + rand(seed, 20 + die) * 20); // starts a bit higher than the drop height alone
    const x = frames.map((f) => x0 * (1 - easeOutCubic(f.u)));
    const lift = frames.map((f) => lift0 * (1 - easeOutCubic(f.u)));
    const height = frames.map((f, i) => f.h - lift[i]!);
    return { frames, x, lift, height };
}

const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1000) / 1000);

function pack(transform: LocalAnimationTransform): LocalAnimation {
    return {
        time: { durationMs: DICE_ANIM_MS, curve: "linear", repeat: "none" },
        animation: { transform, curve: "catmull" },
    };
}

/** The die itself: slide in, spin down, bounce with a little squash at each impact. */
export function diceTumble(seed: number, die: 0 | 1): LocalAnimation {
    const { frames, x, lift, height } = throwPath(seed, die);
    const last = frames.length - 1;
    const turns = 2 + rand(seed, 30 + die);
    const spin = (die === 0 ? 1 : -1) * turns * Math.PI * 2;

    const squash = (f: Frame, i: number) => {
        // Impacts 1..3 squash (the last one is the rest pose); weaker as the bounces die out.
        const bounce = frames.slice(0, i).filter((g) => g.impact).length;
        return f.impact && i !== last ? 0.1 * RESTITUTION ** bounce : 0;
    };

    return pack({
        x: x.map((v, i) => (i === last ? 0 : clean(v))),
        y: frames.map((f, i) => (i === last ? 0 : clean(-f.h + lift[i]!))),
        rotation: frames.map((f, i) => (i === last ? 0 : clean(-spin * (1 - easeOutQuart(f.u))))),
        width: frames.map((f, i) => (i === last ? 1 : clean(1 + squash(f, i)))),
        height: frames.map((f, i) => (i === last ? 1 : clean(1 - squash(f, i)))),
        opacity: frames.map((_, i) => (i === 0 ? 0 : 1)),
    });
}

/** The floor shadow: travels with the die, small and faint while it is high, full size when it lands. */
export function shadowTumble(seed: number, die: 0 | 1): LocalAnimation {
    const { frames, x, height } = throwPath(seed, die);
    const last = frames.length - 1;
    const hmax = Math.max(...height);
    const near = height.map((h) => 1 - Math.max(0, h) / hmax);
    return pack({
        x: x.map((v, i) => (i === last ? 0 : clean(v))),
        y: frames.map(() => 0),
        width: near.map((n, i) => (i === last ? 1 : clean(0.55 + 0.45 * n))),
        height: near.map((n, i) => (i === last ? 1 : clean(0.55 + 0.45 * n))),
        opacity: near.map((n, i) => (i === 0 ? 0 : i === last ? 1 : clean(0.25 + 0.75 * n))),
    });
}

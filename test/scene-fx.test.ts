import { test } from "node:test";
import assert from "node:assert/strict";
import type { LocalAnimation } from "@drawdy/driver-protocol";
import {
    FX_STEP_MS,
    buildingDrop,
    chipDeflate,
    chipStamp,
    coinFlight,
    coinFlightMs,
    confetti,
    hexRgb,
    ringPop,
    scorePunch,
    shockwave,
    shockwaveMs,
    slideIn,
    tokenDrop,
    tokenLeap,
    tokenPoof,
    tokenWalk,
} from "../src/scene/fx";
import { diceAnimMs, diceTumble, shadowTumble, DICE_ANIM_MS } from "../src/scene/dice-anim";
import { cashFlows } from "../src/scene/build";
import type { GameState } from "../src/engine/types";

const numeric = (a: LocalAnimation) =>
    Object.entries(a.animation.transform).filter(([, v]) => Array.isArray(v)) as [string, number[]][];

function wellFormed(name: string, a: LocalAnimation): number {
    assert.equal(a.time.curve, "linear", name);
    assert.equal(a.time.repeat, "none", name);
    assert.equal(a.animation.curve, "catmull", name);
    const tracks = numeric(a);
    assert.ok(tracks.length > 0, `${name} animates something`);
    const len = tracks[0]![1].length;
    for (const [k, v] of tracks) {
        assert.equal(v.length, len, `${name}.${k} length`);
        assert.ok(v.every(Number.isFinite), `${name}.${k} finite`);
    }
    assert.equal(a.time.durationMs, (len - 1) * FX_STEP_MS, `${name}: keyframes are one step apart`);
    return len;
}

function endsAtRest(name: string, a: LocalAnimation): void {
    const len = wellFormed(name, a);
    const rest: Record<string, number> = { x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 };
    for (const [k, v] of numeric(a)) assert.equal(v[len - 1], rest[k], `${name}.${k} ends at rest`);
}

function endsInvisible(name: string, a: LocalAnimation): void {
    const len = wellFormed(name, a);
    const op = a.animation.transform.opacity as number[];
    assert.ok(op, `${name} has opacity`);
    assert.equal(op[len - 1], 0, `${name} ends invisible`);
}

const r = (x: number, y: number, s = 64) => ({ x, y, width: s, height: s });

test("fx: pieces that stay end exactly at rest", () => {
    const walk = tokenWalk([r(0, 0), r(100, 0), r(200, 0), r(300, 0, 50)]);
    endsAtRest("walk", walk.anim);
    endsAtRest("walk delayed", tokenWalk([r(0, 0), r(0, 100)], 300).anim);
    endsAtRest("leap far", tokenLeap(r(0, 0), r(900, 900)).anim);
    endsAtRest("leap near", tokenLeap(r(0, 0), r(30, 0, 50), 200).anim);
    endsAtRest("drop", tokenDrop(160));
    endsAtRest("ring", ringPop(500));
    endsAtRest("stamp", chipStamp(0));
    endsAtRest("deflate", chipDeflate());
    for (let i = 0; i < 4; i++) endsAtRest(`house ${i}`, buildingDrop(i, false));
    endsAtRest("hotel", buildingDrop(4, true));
    endsAtRest("punch", scorePunch("#1f9d55", "#2b2118"));
    endsAtRest("punch plain", scorePunch(null, "#2b2118"));
    endsAtRest("slide", slideIn());
});

test("fx: transient effects end invisible", () => {
    endsInvisible("poof", tokenPoof());
    endsInvisible("shock", shockwave(400));
    endsInvisible("coin", coinFlight({ x: 0, y: 0 }, { x: 500, y: 300 }, 200, 3));
    for (let i = 0; i < 6; i++) endsInvisible(`confetti ${i}`, confetti(i, 6, 42));
});

test("fx: a walk starts on the first tile and lands when it says", () => {
    const stops = [r(0, 0), r(100, 0), r(200, 0)];
    const { anim, landMs, durationMs } = tokenWalk(stops);
    const t = anim.animation.transform;
    // Offsets are relative to the final rect: the first frame shows the token on the first stop.
    assert.equal((t.x as number[])[0], -200);
    assert.equal((t.y as number[])[0], 0);
    assert.ok(landMs > 0 && landMs < durationMs);
    assert.equal(landMs % FX_STEP_MS, 0, "touch-down falls on a keyframe");
    // Hops go up (negative y) between tiles.
    assert.ok((t.y as number[]).some((y) => y < -20));
});

test("fx: a far leap spins a whole turn and ends unrotated; delays hold the start pose", () => {
    const rot = tokenLeap(r(0, 0), r(1000, 0)).anim.animation.transform.rotation as number[];
    assert.ok(Math.abs(Math.abs(rot[0]!) - 2 * Math.PI) < 1e-3, "starts a full turn away (looks the same as 0)");
    assert.equal(rot[rot.length - 1], 0);
    const delayed = tokenLeap(r(0, 0), r(40, 0), 200).anim.animation.transform.x as number[];
    for (let i = 0; i <= 200 / FX_STEP_MS; i++) assert.equal(delayed[i], -40, `held at frame ${i}`);
});

test("fx: timing helpers match the animations", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 600, y: 400 };
    assert.equal(coinFlight(a, b, 300, 1).time.durationMs, coinFlightMs(a, b, 300));
    assert.equal(shockwave(260).time.durationMs, shockwaveMs(260));
});

test("fx: color tracks", () => {
    assert.deepEqual(hexRgb("#ff8000"), [255, 128, 0]);
    assert.deepEqual(hexRgb("#0f0"), [0, 255, 0]);
    assert.deepEqual(hexRgb("nope"), [136, 136, 136]);
    const p = scorePunch("#1f9d55", "#2b2118").animation.transform.textColor!;
    assert.deepEqual(p.components[0], hexRgb("#1f9d55"));
    assert.deepEqual(p.components[p.components.length - 1], hexRgb("#2b2118"));
});

test("dice: doubles add a cheer jump after the throw, keeping the throw's timing", () => {
    assert.equal(diceAnimMs(false), DICE_ANIM_MS);
    assert.ok(diceAnimMs(true) > DICE_ANIM_MS);
    for (const d of [0, 1] as const) {
        const plain = diceTumble(9, d).animation.transform;
        const dbl = diceTumble(9, d, true);
        const t = dbl.animation.transform;
        assert.equal(dbl.time.durationMs, diceAnimMs(true));
        const n = (plain.y as number[]).length;
        const frameMs = DICE_ANIM_MS / (n - 1);
        assert.ok(Math.abs(((t.y as number[]).length - 1) * frameMs - diceAnimMs(true)) < 1, "same keyframe spacing");
        assert.deepEqual((t.y as number[]).slice(0, n), plain.y, "the throw itself is unchanged");
        assert.ok((t.y as number[]).slice(n).some((y) => y < -30), "jumps");
        const rot = t.rotation as number[];
        assert.ok(Math.abs(rot[rot.length - 1]! - 2 * Math.PI) < 1e-3, "a full turn (looks like rest)");
        for (const k of ["x", "y", "width", "height", "opacity"] as const) assert.equal((t[k] as number[]).at(-1), k === "x" || k === "y" ? 0 : 1, k);
        const sh = shadowTumble(9, d, true).animation.transform;
        assert.equal((sh.width as number[]).length, (t.width as number[]).length, "shadow keeps pace");
    }
});

const state = (cash: number[]): GameState =>
    ({ players: cash.map((c, seat) => ({ seat, cash: c })) }) as unknown as GameState;

test("cashFlows: rent, buying, salary, trades and multi-party cards", () => {
    assert.deepEqual(cashFlows(state([1500, 1500]), state([1500, 1500])), []);
    assert.deepEqual(cashFlows(state([1500, 1500]), state([1450, 1550])), [{ from: 0, to: 1, amount: 50 }]);
    assert.deepEqual(cashFlows(state([1500, 1500]), state([1300, 1500])), [{ from: 0, to: null, amount: 200 }]);
    assert.deepEqual(cashFlows(state([1500, 1500]), state([1700, 1500])), [{ from: null, to: 0, amount: 200 }]);
    // Pays rent and also passed GO: net +150 for one, +50 for the other → both from the bank.
    assert.deepEqual(cashFlows(state([1500, 1500]), state([1650, 1550])), [
        { from: null, to: 0, amount: 150 },
        { from: null, to: 1, amount: 50 },
    ]);
    // "Pay each player 50" with three opponents.
    assert.deepEqual(cashFlows(state([500, 500, 500, 500]), state([350, 550, 550, 550])), [
        { from: 0, to: 1, amount: 50 },
        { from: 0, to: 2, amount: 50 },
        { from: 0, to: 3, amount: 50 },
    ]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { DICE_ANIM_MS, diceTumble, shadowTumble } from "../src/scene/dice-anim";
import { tilePlacement, tokenRect, tokenSize } from "../src/boards/layout";

const animations = (seed: number) =>
    ([0, 1] as const).flatMap((d) => [
        { name: `die${d}`, a: diceTumble(seed, d) },
        { name: `shadow${d}`, a: shadowTumble(seed, d) },
    ]);

test("dice animations: baked easing, linear time, catmull", () => {
    for (const { a } of animations(7)) {
        assert.equal(a.time.curve, "linear");
        assert.equal(a.time.repeat, "none");
        assert.equal(a.time.durationMs, DICE_ANIM_MS);
        assert.equal(a.animation.curve, "catmull");
    }
});

test("dice animations end on the exact rest pose and tracks have equal lengths", () => {
    for (const seed of [0, 1, 42, 99999]) {
        for (const { name, a } of animations(seed)) {
            const tracks = Object.entries(a.animation.transform) as [string, number[]][];
            const len = tracks[0]![1].length;
            assert.ok(len >= 24, `${name} has dense keyframes`);
            for (const [k, v] of tracks) {
                assert.equal(v.length, len, `${name}.${k} length`);
                assert.ok(v.every(Number.isFinite), `${name}.${k} finite`);
            }
            const t = a.animation.transform;
            const end = (k: keyof typeof t) => (t[k] as number[])[len - 1];
            assert.equal(end("x"), 0);
            assert.equal(end("y"), 0);
            assert.equal(end("width"), 1);
            assert.equal(end("height"), 1);
            assert.equal(end("opacity"), 1);
            if (t.rotation) assert.equal(end("rotation"), 0);
            assert.equal((t.opacity as number[])[0], 0, `${name} fades in`);
        }
    }
});

test("dice animations are deterministic per seed and differ between seeds and dice", () => {
    assert.deepEqual(diceTumble(5, 0), diceTumble(5, 0));
    assert.deepEqual(shadowTumble(5, 1), shadowTumble(5, 1));
    assert.notDeepEqual(diceTumble(5, 0), diceTumble(6, 0));
    assert.notDeepEqual(diceTumble(5, 0), diceTumble(5, 1));
});

test("dice never dip below the floor, come in from the left and spin in opposite directions", () => {
    for (const seed of [1, 2, 3, 123, 4096]) {
        for (const d of [0, 1] as const) {
            const t = diceTumble(seed, d).animation.transform;
            assert.ok((t.y as number[]).every((y) => y <= 1e-9), "y offsets are upward only");
            assert.ok((t.x as number[])[0]! <= -200 && (t.x as number[])[0]! >= -260);
            assert.ok((t.x as number[]).every((x) => x <= 0));
        }
        const r0 = diceTumble(seed, 0).animation.transform.rotation as number[];
        const r1 = diceTumble(seed, 1).animation.transform.rotation as number[];
        assert.ok(r0[0]! * r1[0]! < 0, "opposite spin");
        assert.ok(Math.abs(r0[0]!) >= 2 * 2 * Math.PI - 1e-9 && Math.abs(r0[0]!) <= 3 * 2 * Math.PI);
    }
});

test("tokenSize shrinks monotonically as tokens gather", () => {
    const sizes = [1, 2, 3, 4, 5, 6].map(tokenSize);
    assert.deepEqual(sizes, [64, 58, 50, 50, 44, 44]);
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i]! <= sizes[i - 1]!);
});

test("tokenRect stays inside its tile for every tile, count and slot", () => {
    for (let tile = 0; tile < 40; tile++) {
        const { rect } = tilePlacement(tile);
        const groups = tile === 10 ? [false, true] : [false];
        for (const jailed of groups) {
            for (let count = 1; count <= 6; count++) {
                const seen = new Set<string>();
                for (let slot = 0; slot < count; slot++) {
                    const r = tokenRect(tile, slot, jailed, count);
                    const msg = `tile ${tile} jailed ${jailed} count ${count} slot ${slot}`;
                    assert.ok(r.x >= rect.x - 1e-9 && r.y >= rect.y - 1e-9, msg);
                    assert.ok(r.x + r.width <= rect.x + rect.width + 1e-9 && r.y + r.height <= rect.y + rect.height + 1e-9, msg);
                    assert.ok(r.width <= tokenSize(1) && r.width >= 40, msg);
                    seen.add(`${r.x},${r.y}`);
                }
                assert.equal(seen.size, count, `distinct positions: tile ${tile} count ${count}`);
            }
        }
    }
    // A lone token is centered in the body outside the color bar.
    const r = tokenRect(1, 0, false, 1);
    const { rect } = tilePlacement(1);
    assert.equal(r.x + r.width / 2, rect.x + rect.width / 2);
    assert.equal(r.y + r.height / 2, rect.y + 30 + (rect.height - 30) / 2);
});

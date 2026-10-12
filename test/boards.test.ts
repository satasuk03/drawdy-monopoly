import test from "node:test";
import assert from "node:assert/strict";
import { BOARDS, getBoard } from "../src/boards/index";
import { CLASSIC } from "../src/boards/classic";

const ICONS = new Set(
    "go-arrow jail-bars parking police chance chest tax diamond train bus metro plane rocket portal griffin bulb water reactor ice mana forge house building temple tower palm mountain castle planet moon star tree shop boat crown coin gem flame".split(
        " ",
    ),
);
const CORNERS: Record<number, string> = { 0: "go", 10: "jail", 20: "free-parking", 30: "go-to-jail" };

test("getBoard and BOARDS order", () => {
    assert.deepEqual(BOARDS.map((b) => b.id), ["classic", "thailand", "space", "fantasy"]);
    for (const b of BOARDS) {
        assert.equal(getBoard(b.id), b);
        assert.equal(b.artTheme, b.id);
    }
    assert.equal(getBoard("nope"), undefined);
});

for (const b of BOARDS) {
    test(`board ${b.id}`, () => {
        assert.equal(b.tiles.length, 40);
        for (const [i, k] of Object.entries(CORNERS)) assert.equal(b.tiles[Number(i)].kind, k, `corner ${i}`);
        const groupIds = new Set(b.groups.map((g) => g.id));
        assert.equal(groupIds.size, 8);
        assert.equal(new Set(b.groups.map((g) => g.color)).size, 8);
        b.tiles.forEach((t, i) => {
            const c = CLASSIC.tiles[i];
            assert.equal(t.kind, c.kind, `kind @${i}`);
            assert.ok(t.icon && ICONS.has(t.icon), `icon @${i}: ${t.icon}`);
            if (t.kind === "property" && c.kind === "property") {
                assert.equal(t.price, c.price, `price @${i}`);
                assert.deepEqual(t.rent, c.rent, `rent @${i}`);
                assert.equal(t.houseCost, c.houseCost, `houseCost @${i}`);
                assert.equal(t.group, c.group, `group @${i}`);
                assert.ok(groupIds.has(t.group));
            }
            if ((t.kind === "railroad" || t.kind === "utility") && (c.kind === "railroad" || c.kind === "utility")) assert.equal(t.price, c.price);
            if (t.kind === "tax" && c.kind === "tax") assert.equal(t.amount, c.amount);
        });
        for (const deck of [b.chance, b.chest]) {
            assert.equal(deck.length, 16);
            assert.equal(new Set(deck.map((c) => c.id)).size, 16);
            for (const c of deck) {
                if (c.effect.kind === "move-to") assert.ok(c.effect.tile >= 0 && c.effect.tile < 40);
                assert.ok(c.text.length > 0);
            }
        }
        assert.deepEqual(b.chance.map((c) => c.effect), CLASSIC.chance.map((c) => c.effect));
        assert.deepEqual(b.chest.map((c) => c.effect), CLASSIC.chest.map((c) => c.effect));
        assert.ok(new Set(b.tokens.map((t) => t.id)).size >= 8);
        assert.equal(JSON.stringify(b).includes("Monopoly"), false);
    });
}

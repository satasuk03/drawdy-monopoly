import test from "node:test";
import assert from "node:assert/strict";
import { BOARDS } from "../src/boards/index";
import { BOARD_TEXT, localizeBoard } from "../src/boards/localize";
import { LANGS, fill, normalizeLang } from "../src/i18n/lang";
import { wrapText } from "../src/art/util";

test("normalizeLang", () => {
    assert.equal(normalizeLang("th-TH"), "th");
    assert.equal(normalizeLang("zh-Hans-CN"), "zh");
    assert.equal(normalizeLang("es_MX"), "es");
    assert.equal(normalizeLang("fr"), "en");
    assert.equal(normalizeLang(undefined), "en");
});

test("fill", () => {
    assert.equal(fill("{a} pays {b}", { a: "X", b: 3 }), "X pays 3");
    assert.equal(fill("{missing}", {}), "{missing}");
});

const moneyTags = (s: string) => (s.match(/\{money:-?\d+\}/g) ?? []).sort();

for (const board of BOARDS) {
    for (const lang of LANGS) {
        if (lang === "en") continue;
        test(`board ${board.id} in ${lang} is complete`, () => {
            const tx = BOARD_TEXT[board.id]?.[lang];
            assert.ok(tx, "translation present");
            assert.ok(tx.name && tx.tagline);
            assert.equal(tx.tiles.length, 40);
            tx.tiles.forEach((t, i) => assert.ok(t.name, `tile ${i}`));
            for (const g of board.groups) assert.ok(tx.groups[g.id], `group ${g.id}`);
            for (const tok of board.tokens) assert.ok(tx.tokens[tok.id], `token ${tok.id}`);
            for (const k of Object.keys(board.labels) as (keyof typeof board.labels)[]) assert.ok(tx.labels[k], `label ${k}`);
            for (const c of [...board.chance, ...board.chest]) {
                const t: string | undefined = tx.cards[c.id];
                assert.ok(t, `card ${c.id}`);
                assert.deepEqual(moneyTags(t), moneyTags(c.text), `money placeholders in ${c.id}`);
            }
            const b = localizeBoard(board, lang);
            assert.equal(b.lang, lang);
            assert.deepEqual(b.tiles.map((t) => t.kind), board.tiles.map((t) => t.kind));
            assert.deepEqual(b.chance.map((c) => c.effect), board.chance.map((c) => c.effect));
        });
    }
}

test("CJK text wraps between characters", () => {
    const r = wrapText("大富翁经典城市大道", 60, 20, 3, { minSize: 20 });
    assert.ok(r.lines.length > 1);
    assert.equal(r.lines.join(""), "大富翁经典城市大道");
});

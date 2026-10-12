import assert from "node:assert/strict";
import { test } from "node:test";
import { getBoard } from "../src/boards/index";
import { localizeBoard } from "../src/boards/localize";
import { applyAction, createGame } from "../src/engine/index";
import type { Action, GameState } from "../src/engine/types";
import { actorFor } from "./fixtures/helpers";

const LATIN_WORDS = /\b(rolled|landed|paid|bought|joined|turn|begins|game)\b/i;

for (const lang of ["th", "zh", "es"] as const) {
    test(`engine log and errors are in ${lang}`, () => {
        const board = localizeBoard(getBoard("classic")!, lang);
        let s: GameState = createGame({ gameId: "g", board, creatorUserId: "u0", seed: 7, lang });
        const act = (a: Action) => {
            const r = applyAction(board, s, a, actorFor(s, "u0"));
            assert.ok(r.ok, r.ok ? "" : r.error);
            s = r.state;
        };
        act({ type: "join", userId: "u0", name: "Ann", color: "#ff0000", token: board.tokens[0]!.id });
        act({ type: "join", userId: "u0", name: "Bo", color: "#00ff00", token: board.tokens[1]!.id });
        act({ type: "start" });
        act({ type: "roll", seat: 0 });

        const bad = applyAction(board, s, { type: "roll", seat: 1 }, actorFor(s, "u0"));
        assert.equal(bad.ok, false);
        if (!bad.ok) assert.doesNotMatch(bad.error, /not your turn/i);

        assert.ok(s.log.length >= 4);
        for (const e of s.log) {
            assert.doesNotMatch(e.text, LATIN_WORDS, e.text);
            assert.doesNotMatch(e.text, /\{\w+\}/, `unfilled placeholder: ${e.text}`);
        }
        if (lang === "th") assert.ok(s.log.some((e) => e.text.includes("ทอยได้")), "Thai roll line");
        if (lang === "zh") assert.ok(s.log.some((e) => e.text.includes("掷出")), "Chinese roll line");
        if (lang === "es") assert.ok(s.log.some((e) => e.text.includes("sacó")), "Spanish roll line");
    });
}

test("English output is unchanged", () => {
    const board = getBoard("classic")!;
    const s = createGame({ gameId: "g", board, creatorUserId: "u0", seed: 7 });
    assert.equal(s.log[0]!.text, `New game of ${board.name}.`);
});

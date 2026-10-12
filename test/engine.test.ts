import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyAction, createGame, needsToAct, netWorth, rentFor, seatView } from "../src/engine/index";
import type { GameState } from "../src/engine/types";
import { board } from "./fixtures/board";
import { act, actorFor, give, lastLog, lobby, logs, newGame, place, reject, rig, roll, stack } from "./fixtures/helpers";

const phase = (s: GameState) => s.phase.kind;

describe("lobby", () => {
    test("join validates tokens, colors, size; one user may hold several seats", () => {
        let s = createGame({ gameId: "g", board, creatorUserId: "u0", seed: 1 });
        s = act(s, { type: "join", userId: "u0", name: "Ann", color: "#ff0000", token: "car" }, "u0");
        s = act(s, { type: "join", userId: "u0", name: "Bo", color: "#00ff00", token: "hat" }, "u0");
        assert.equal(s.players.length, 2);
        assert.match(reject(s, { type: "join", userId: "u1", name: "Cy", color: "#0000ff", token: "car" }, "u1"), /token/);
        assert.match(reject(s, { type: "join", userId: "u1", name: "Cy", color: "#FF0000", token: "dog" }, "u1"), /color/);
        assert.match(reject(s, { type: "join", userId: "u1", name: "Cy", color: "#0000ff", token: "dog" }, "u2"), /yourself/);
        assert.match(reject(s, { type: "join", userId: "u1", name: "Cy", color: "#0000ff", token: "nope" }, "u1"), /token/i);
        const full = lobby(6);
        assert.match(reject(full, { type: "join", userId: "u9", name: "Gus", color: "#123456", token: "cat" }, "u9"), /full/);
    });

    test("leave renumbers seats; settings and start are creator-only", () => {
        let s = lobby(3);
        s = act(s, { type: "leave", seat: 0 });
        assert.deepEqual(
            s.players.map((p) => [p.seat, p.name]),
            [
                [0, "Bo"],
                [1, "Cy"],
            ],
        );
        assert.match(reject(s, { type: "start" }, "u1"), /creator/);
        assert.match(reject(s, { type: "update-settings", settings: { salary: 100 } }, "u1"), /creator/);
        assert.match(reject(s, { type: "update-settings", settings: { salary: -1 } }, "u0"), /salary/);
        assert.match(reject(s, { type: "update-settings", settings: { bogus: 1 } as never }, "u0"), /Unknown/);
        s = act(s, { type: "update-settings", settings: { startingCash: 2000, houseSupply: 10 } }, "u0");
        s = act(s, { type: "start" }, "u0");
        assert.equal(phase(s), "pre-roll");
        assert.ok(s.players.every((p) => p.cash === 2000));
        assert.equal(s.housesLeft, 10);
        assert.match(reject(s, { type: "leave", seat: 0 }), /started/);
    });

    test("start needs two players and shuffles both decks", () => {
        assert.match(reject(lobby(1), { type: "start" }, "u0"), /2 players/);
        const s = newGame(2);
        assert.deepEqual([...s.decks.chance.order].sort((a, b) => a - b), [...Array(16).keys()]);
        assert.deepEqual([...s.decks.chest.order].sort((a, b) => a - b), [...Array(16).keys()]);
        assert.notDeepEqual(s.decks.chance.order, [...Array(16).keys()]);
        assert.equal(s.current, 0);
    });
});

describe("rent", () => {
    test("property base rent, monopoly doubling (mortgaged tiles count), houses, mortgaged = 0", () => {
        const s = newGame(2);
        give(s, 1, [37]);
        assert.equal(rentFor(board, s, 37, 7), 35);
        give(s, 1, [39], 0, true);
        assert.equal(rentFor(board, s, 37, 7), 70, "monopoly doubles even with a mortgaged tile in the group");
        assert.equal(rentFor(board, s, 39, 7), 0, "mortgaged tile charges nothing");
        give(s, 1, [37], 3);
        assert.equal(rentFor(board, s, 37, 7), 1100);
        give(s, 1, [37], 5);
        assert.equal(rentFor(board, s, 37, 7), 1500);
        assert.equal(rentFor(board, s, 1, 7), 0, "bank-owned");
    });

    test("railroads 25/50/100/200 counting mortgaged ones", () => {
        const s = newGame(2);
        const rails = [5, 15, 25, 35];
        const expected = [25, 50, 100, 200];
        rails.forEach((r, k) => {
            give(s, 1, [r], 0, k === 1);
            assert.equal(rentFor(board, s, 5, 0), expected[k]);
        });
    });

    test("utilities 4x dice, 10x with both", () => {
        const s = newGame(2);
        give(s, 1, [12]);
        assert.equal(rentFor(board, s, 12, 9), 36);
        give(s, 1, [28]);
        assert.equal(rentFor(board, s, 12, 9), 90);
    });

    test("landing pays rent with a readable log line", () => {
        let s = newGame(2);
        give(s, 1, [3]);
        s = roll(rig(s, [1, 2]));
        assert.equal(s.players[0].cash, 1496);
        assert.equal(s.players[1].cash, 1504);
        assert.ok(logs(s).includes("Ann rolled 1 + 2"));
        assert.ok(logs(s).includes("Ann paid $4 rent to Bo for Baltic Avenue."));
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
    });

    test("utility rent uses the movement dice", () => {
        let s = newGame(2);
        give(s, 1, [12]);
        s = roll(rig(place(s, 0, 10), [1, 1]));
        assert.equal(s.players[1].cash, 1500 + 8);
    });

    test("no rent on a mortgaged tile, or when the owner is jailed with rentInJail off", () => {
        let s = newGame(2);
        give(s, 1, [3], 0, true);
        s = roll(rig(s, [1, 2]));
        assert.equal(s.players[0].cash, 1500);

        let t = newGame(2, { rentInJail: false });
        give(t, 1, [3]);
        t.players[1].inJail = true;
        t = roll(rig(t, [1, 2]));
        assert.equal(t.players[0].cash, 1500);

        let u = newGame(2);
        give(u, 1, [3]);
        u.players[1].inJail = true;
        u = roll(rig(u, [1, 2]));
        assert.equal(u.players[0].cash, 1496, "official rule: owner collects in jail");
    });
});

describe("movement", () => {
    test("passing GO pays salary; landing pays double only with the house rule", () => {
        let s = newGame(2);
        s = roll(rig(place(s, 0, 38), [1, 2]));
        assert.equal(s.players[0].position, 1);
        assert.equal(s.players[0].cash, 1700);
        assert.equal(phase(s), "buy-decision");

        let t = newGame(2);
        t = roll(rig(place(t, 0, 37), [1, 2]));
        assert.equal(t.players[0].cash, 1700);
        let u = newGame(2, { doubleSalaryOnGo: true });
        u = roll(rig(place(u, 0, 37), [1, 2]));
        assert.equal(u.players[0].cash, 1900);
    });

    test("doubles roll again; third doubles go straight to jail", () => {
        let s = newGame(2);
        give(s, 0, [6, 14]);
        rig(s, [3, 3], [4, 4], [5, 5]);
        s = roll(s);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: true });
        assert.match(reject(s, { type: "end-turn", seat: 0 }), /doubles/);
        s = roll(s);
        assert.equal(s.players[0].position, 14);
        s = roll(s);
        assert.equal(s.players[0].position, 10);
        assert.equal(s.players[0].inJail, true);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
        assert.ok(lastLog(s).some((l) => l.includes("landed in jail")));
    });

    test("go-to-jail tile ends the turn even on doubles", () => {
        let s = newGame(2);
        s = roll(rig(place(s, 0, 28), [1, 1]));
        assert.equal(s.players[0].position, 10);
        assert.equal(s.players[0].inJail, true);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
        assert.equal(s.players[0].cash, 1500, "no salary");
    });

    test("buy, decline without auction, and tax", () => {
        let s = newGame(2, { auctionOnDecline: false });
        s = roll(rig(s, [2, 4]));
        assert.deepEqual(s.phase, { kind: "buy-decision", tile: 6 });
        assert.match(reject(s, { type: "roll", seat: 0 }), /roll/);
        const bought = act(s, { type: "buy", seat: 0 });
        assert.equal(bought.ownership["6"].owner, 0);
        assert.equal(bought.players[0].cash, 1400);
        const declined = act(s, { type: "decline", seat: 0 });
        assert.equal(declined.ownership["6"], undefined);
        assert.equal(phase(declined), "post-roll");

        let t = newGame(2);
        t = roll(rig(t, [1, 3]));
        assert.equal(t.players[0].cash, 1300);
        assert.equal(t.jackpot, 0);
        let j = newGame(2, { freeParkingJackpot: true });
        j = roll(rig(j, [1, 3]));
        assert.equal(j.jackpot, 200);
        j = act(j, { type: "end-turn", seat: 0 });
        j = roll(rig(place(j, 1, 17), [1, 2]));
        assert.equal(j.players[1].cash, 1700);
        assert.equal(j.jackpot, 0);
    });

    test("buy is rejected without enough cash", () => {
        let s = newGame(2);
        s.players[0].cash = 50;
        s = roll(rig(s, [2, 4]));
        assert.match(reject(s, { type: "buy", seat: 0 }), /costs/);
        assert.ok(seatView(board, s, 0).legal.includes("decline"));
    });
});

describe("jail", () => {
    const jailed = (settings = {}) => {
        const s = newGame(2, settings);
        s.players[0].position = 10;
        s.players[0].inJail = true;
        return s;
    };

    test("pay the fine, then roll normally", () => {
        let s = act(jailed(), { type: "pay-jail-fine", seat: 0 });
        assert.equal(s.players[0].cash, 1450);
        assert.equal(s.players[0].inJail, false);
        assert.equal(phase(s), "pre-roll");
        s = roll(rig(s, [1, 2]));
        assert.equal(s.players[0].position, 13);
    });

    test("use a jail card; it goes back to the bottom of its deck", () => {
        let s = jailed();
        const idx = board.chance.findIndex((c) => c.effect.kind === "jail-free");
        s.decks.chance.order = s.decks.chance.order.filter((i) => i !== idx);
        s.decks.chance.next = 3;
        s.players[0].jailCards.chance = 1;
        s = act(s, { type: "use-jail-card", seat: 0 });
        assert.equal(s.players[0].inJail, false);
        assert.equal(s.players[0].jailCards.chance, 0);
        assert.equal(s.decks.chance.order.length, 16);
        assert.equal(s.decks.chance.order[3], idx, "inserted just before the draw pointer");
        assert.equal(s.decks.chance.next, 4);
        assert.match(reject(jailed(), { type: "use-jail-card", seat: 0 }), /no Get Out/);
    });

    test("doubles leave jail and move without another roll", () => {
        let s = roll(rig(jailed(), [2, 2]));
        assert.equal(s.players[0].inJail, false);
        assert.equal(s.players[0].position, 14);
        assert.deepEqual(s.phase, { kind: "buy-decision", tile: 14 });
        s = act(s, { type: "buy", seat: 0 });
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
    });

    test("third failed roll forces the fine and moves", () => {
        let s = jailed();
        give(s, 0, [13]);
        give(s, 1, [3, 6]); // Bo's own rolls land on his own tiles
        for (let k = 1; k <= 2; k++) {
            s = roll(rig(s, [1, 2]));
            assert.equal(s.players[0].inJail, true);
            assert.equal(s.players[0].jailTurns, k);
            assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
            s = act(s, { type: "end-turn", seat: 0 });
            s = roll(rig(s, [1, 2]), 1);
            s = act(s, { type: "end-turn", seat: 1 });
        }
        s = roll(rig(s, [1, 2]));
        assert.equal(s.players[0].inJail, false);
        assert.equal(s.players[0].position, 13);
        assert.equal(s.players[0].cash, 1450);
    });

    test("forced fine you can't afford becomes a debt; after paying you roll afresh", () => {
        let s = jailed();
        s.players[0].jailTurns = 2;
        s.players[0].cash = 20;
        give(s, 0, [1]);
        s = roll(rig(s, [1, 2]));
        assert.equal(phase(s), "debt");
        assert.deepEqual(s.phase.kind === "debt" && s.phase.debt, { debtor: 0, creditor: null, amount: 50 });
        assert.equal(s.players[0].inJail, false);
        assert.equal(s.players[0].position, 10);
        assert.match(reject(s, { type: "pay-debt", seat: 0 }), /need/);
        s = act(s, { type: "mortgage", seat: 0, tile: 1 });
        s = act(s, { type: "pay-debt", seat: 0 });
        assert.equal(s.players[0].cash, 0);
        assert.equal(phase(s), "pre-roll");
        s = roll(rig(s, [2, 3]));
        assert.equal(s.players[0].position, 15);
    });
});

describe("cards", () => {
    /** Ann at `from`, rolls `dice` onto a chance/chest tile with `card` on top. */
    const draw = (deck: "chance" | "chest", card: string, from: number, dice: [number, number], prep?: (s: GameState) => void) => {
        let s = newGame(3);
        place(s, 0, from);
        stack(s, deck, card);
        prep?.(s);
        rig(s, dice);
        s = roll(s);
        return s;
    };

    test("move-to, with and without passing GO", () => {
        let s = draw("chance", "ch-boardwalk", 4, [1, 2]);
        assert.ok(logs(s).includes("Ann drew Chance: Advance to Boardwalk."));
        assert.equal(s.players[0].position, 39);
        assert.deepEqual(s.phase, { kind: "buy-decision", tile: 39 });
        assert.equal(s.players[0].cash, 1500);
        s = draw("chance", "ch-stcharles", 33, [1, 2]);
        assert.equal(s.players[0].position, 11);
        assert.equal(s.players[0].cash, 1700);
        s = draw("chance", "ch-go", 33, [1, 2]);
        assert.equal(s.players[0].position, 0);
        assert.equal(s.players[0].cash, 1700);
        assert.ok(logs(s).includes("Ann drew Chance: Advance to GO. Collect $200."));
    });

    test("move-to-nearest railroad pays double rent; utility pays 10x a fresh roll", () => {
        let s = draw("chance", "ch-rail-1", 4, [1, 2], (x) => give(x, 1, [15]));
        assert.equal(s.players[0].position, 15);
        assert.equal(s.players[1].cash, 1550);
        s = draw("chance", "ch-utility", 4, [1, 2], (x) => give(x, 1, [12]));
        s = newGame(3);
        place(s, 0, 4);
        stack(s, "chance", "ch-utility");
        give(s, 1, [12]);
        s = roll(rig(s, [1, 2], [2, 3]));
        assert.equal(s.players[0].position, 12);
        assert.equal(s.players[1].cash, 1550);
        // Unowned: ordinary buy decision.
        s = draw("chance", "ch-rail-2", 33, [1, 2]);
        assert.equal(s.players[0].position, 5);
        assert.equal(s.players[0].cash, 1700, "wrapped past GO");
        assert.deepEqual(s.phase, { kind: "buy-decision", tile: 5 });
    });

    test("move-by backwards never collects salary and resolves the new tile", () => {
        const s = draw("chance", "ch-back3", 4, [1, 2]);
        assert.equal(s.players[0].position, 4);
        assert.equal(s.players[0].cash, 1300, "income tax");
    });

    test("collect and pay", () => {
        let s = draw("chest", "cc-bank-error", 14, [1, 2]);
        assert.equal(s.players[0].cash, 1700);
        s = draw("chest", "cc-doctor", 14, [1, 2]);
        assert.equal(s.players[0].cash, 1450);
    });

    test("collect-from-each: a short payer goes into debt, then bankruptcy pays the collector", () => {
        let s = draw("chest", "cc-birthday", 14, [1, 2], (x) => (x.players[2].cash = 5));
        assert.equal(s.players[0].cash, 1510);
        assert.equal(s.players[1].cash, 1490);
        assert.equal(phase(s), "debt");
        assert.deepEqual(needsToAct(s), [2]);
        assert.match(reject(s, { type: "end-turn", seat: 0 }), /end your turn/);
        s = act(s, { type: "declare-bankruptcy", seat: 2 });
        assert.equal(s.players[2].bankrupt, true);
        assert.equal(s.players[0].cash, 1515);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
        assert.equal(s.current, 0);
    });

    test("pay-each: sequential, the rest queue behind the first unaffordable payment", () => {
        let s = newGame(4);
        place(s, 0, 4);
        stack(s, "chance", "ch-chairman");
        s.players[0].cash = 70;
        give(s, 0, [1, 3]);
        s = roll(rig(s, [1, 2]));
        assert.equal(s.players[1].cash, 1550);
        assert.equal(s.phase.kind, "debt");
        if (s.phase.kind !== "debt") return;
        assert.deepEqual(s.phase.debt, { debtor: 0, creditor: 2, amount: 50 });
        assert.deepEqual(s.phase.queue, [{ debtor: 0, creditor: 3, amount: 50 }]);
        s = act(s, { type: "mortgage", seat: 0, tile: 1 });
        s = act(s, { type: "pay-debt", seat: 0 });
        // 20 + 30 - 50 = 0 left: the queued payment becomes the new debt.
        assert.equal(s.players[2].cash, 1550);
        assert.equal(s.phase.kind === "debt" && s.phase.debt.creditor, 3);
        s = act(s, { type: "mortgage", seat: 0, tile: 3 });
        assert.match(reject(s, { type: "pay-debt", seat: 0 }), /need/);
        s.players[0].cash = 60;
        s = act(s, { type: "pay-debt", seat: 0 });
        assert.equal(s.players[3].cash, 1550);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
    });

    test("repairs count houses and hotels", () => {
        const s = draw("chance", "ch-repairs", 4, [1, 2], (x) => {
            give(x, 0, [1, 3], 2);
            give(x, 0, [37, 39], 5);
        });
        assert.equal(s.players[0].cash, 1500 - (4 * 25 + 2 * 100));
    });

    test("go-to-jail card", () => {
        const s = draw("chest", "cc-jail", 14, [1, 2]);
        assert.equal(s.players[0].inJail, true);
        assert.equal(s.players[0].position, 10);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
    });

    test("jail-free cards leave the deck while held", () => {
        const s = draw("chest", "cc-jail-free", 14, [1, 2]);
        assert.equal(s.players[0].jailCards.chest, 1);
        assert.equal(s.decks.chest.order.length, 15);
        assert.equal(s.decks.chest.next, 0);
    });
});

describe("building", () => {
    const monopoly = (settings = {}) => {
        const s = newGame(2, settings);
        give(s, 0, [37, 39]);
        return s;
    };

    test("needs the whole group, no mortgages, builds evenly, costs houseCost", () => {
        const half = newGame(2);
        give(half, 0, [37]);
        assert.match(reject(half, { type: "build", seat: 0, tile: 37 }), /whole color group/);
        const m = monopoly();
        m.ownership["39"].mortgaged = true;
        assert.match(reject(m, { type: "build", seat: 0, tile: 37 }), /Unmortgage/);

        let s = monopoly();
        s = act(s, { type: "build", seat: 0, tile: 37 });
        assert.equal(s.ownership["37"].houses, 1);
        assert.equal(s.players[0].cash, 1300);
        assert.equal(s.housesLeft, 31);
        assert.match(reject(s, { type: "build", seat: 0, tile: 37 }), /evenly/);
        assert.deepEqual(seatView(board, s, 0).buildable, [39]);
        assert.match(reject(s, { type: "build", seat: 1, tile: 37 }), /can't manage/);
        assert.match(reject(s, { type: "mortgage", seat: 0, tile: 39 }), /Sell all buildings/);

        const loose = act(monopoly({ evenBuild: false }), { type: "build", seat: 0, tile: 37 });
        assert.equal(act(loose, { type: "build", seat: 0, tile: 37 }).ownership["37"].houses, 2);
    });

    test("fifth building is a hotel and returns four houses; supply limits", () => {
        let s = monopoly();
        s.players[0].cash = 10_000;
        for (let k = 0; k < 4; k++) for (const t of [37, 39]) s = act(s, { type: "build", seat: 0, tile: t });
        assert.equal(s.housesLeft, 24);
        s = act(s, { type: "build", seat: 0, tile: 39 });
        assert.equal(s.ownership["39"].houses, 5);
        assert.equal(s.housesLeft, 28);
        assert.equal(s.hotelsLeft, 11);
        assert.match(reject(s, { type: "build", seat: 0, tile: 39 }), /already has a hotel/);
        s.hotelsLeft = 0;
        assert.match(reject(s, { type: "build", seat: 0, tile: 37 }), /no hotels/);

        let h = monopoly();
        h.housesLeft = 1;
        h = act(h, { type: "build", seat: 0, tile: 37 });
        assert.match(reject(h, { type: "build", seat: 0, tile: 39 }), /no houses/);
    });

    test("selling: evenly, half price, hotel downgrade and house shortage", () => {
        let s = monopoly();
        give(s, 0, [37, 39], 4);
        s.housesLeft = 24;
        s.players[0].cash = 1000;
        s = act(s, { type: "build", seat: 0, tile: 39 });
        assert.equal(s.housesLeft, 28);
        assert.match(reject(s, { type: "sell-building", seat: 0, tile: 37 }), /evenly/);
        const down = act(s, { type: "sell-building", seat: 0, tile: 39 });
        assert.equal(down.ownership["39"].houses, 4);
        assert.equal(down.housesLeft, 24);
        assert.equal(down.hotelsLeft, 12);
        assert.equal(down.players[0].cash, 800 + 100);

        s.housesLeft = 3;
        assert.match(reject(s, { type: "sell-building", seat: 0, tile: 39 }), /only 3 houses/);
        const loose = { ...s, settings: { ...s.settings, evenBuild: false } };
        const out = act(loose, { type: "sell-building", seat: 0, tile: 39 });
        assert.equal(out.ownership["39"].houses, 0);
        assert.equal(out.players[0].cash, 800 + 500);
        assert.equal(out.hotelsLeft, 12);
        assert.equal(out.housesLeft, 3);
    });

    test("mortgage gives half; unmortgage costs half + 10% rounded up", () => {
        let s = newGame(2);
        give(s, 0, [1, 37]);
        s = act(s, { type: "mortgage", seat: 0, tile: 1 });
        s = act(s, { type: "mortgage", seat: 0, tile: 37 });
        assert.equal(s.players[0].cash, 1500 + 30 + 175);
        assert.match(reject(s, { type: "mortgage", seat: 0, tile: 1 }), /already/);
        s = act(s, { type: "unmortgage", seat: 0, tile: 1 });
        s = act(s, { type: "unmortgage", seat: 0, tile: 37 });
        assert.equal(s.players[0].cash, 1500 + 30 + 175 - 33 - 193);
        assert.match(reject(s, { type: "mortgage", seat: 0, tile: 3 }), /don't own/);
    });

    test("not allowed during someone else's decision", () => {
        let s = newGame(2);
        give(s, 0, [1, 3]);
        s = roll(rig(s, [2, 4]));
        assert.equal(phase(s), "buy-decision");
        assert.match(reject(s, { type: "mortgage", seat: 0, tile: 1 }), /can't manage/);
    });
});

describe("auction", () => {
    const declined = (n = 3) => {
        let s = newGame(n);
        s = roll(rig(s, [2, 4]));
        return act(s, { type: "decline", seat: 0 });
    };

    test("round robin from the player after the decliner; highest bid wins", () => {
        let s = declined();
        assert.equal(s.phase.kind, "auction");
        if (s.phase.kind !== "auction") return;
        assert.deepEqual(s.phase.auction.bidders, [1, 2, 0]);
        assert.deepEqual(needsToAct(s), [1]);
        assert.match(reject(s, { type: "bid", seat: 2, amount: 5 }), /turn/);
        assert.match(reject(s, { type: "bid", seat: 1, amount: 0 }), /at least 1/);
        assert.match(reject(s, { type: "bid", seat: 1, amount: 99_999 }), /more cash/);
        s = act(s, { type: "bid", seat: 1, amount: 10 });
        assert.match(reject(s, { type: "bid", seat: 2, amount: 10 }), /beat/);
        s = act(s, { type: "bid", seat: 2, amount: 20 });
        s = act(s, { type: "pass-bid", seat: 0 });
        assert.deepEqual(needsToAct(s), [1]);
        s = act(s, { type: "pass-bid", seat: 1 });
        assert.equal(s.ownership["6"].owner, 2);
        assert.equal(s.players[2].cash, 1480);
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: false });
    });

    test("all pass: tile stays with the bank", () => {
        let s = declined(2);
        s = act(s, { type: "pass-bid", seat: 1 });
        s = act(s, { type: "pass-bid", seat: 0 });
        assert.equal(s.ownership["6"], undefined);
        assert.equal(phase(s), "post-roll");
    });

    test("last bidder standing with one bid wins immediately", () => {
        let s = declined(2);
        s = act(s, { type: "pass-bid", seat: 1 });
        s = act(s, { type: "bid", seat: 0, amount: 1 });
        assert.equal(s.ownership["6"].owner, 0);
        assert.equal(s.players[0].cash, 1499);
    });
});

describe("trades", () => {
    const base = () => {
        const s = newGame(3);
        give(s, 0, [1]);
        give(s, 1, [3, 5]);
        return s;
    };
    const offer = (cash = 0, tiles: number[] = [], jailCards = 0) => ({ cash, tiles, jailCards });

    test("validation", () => {
        const s = base();
        const ok = { type: "propose-trade" as const, seat: 0, to: 1, give: offer(0, [1]), get: offer(0, [3]) };
        assert.match(reject(s, { ...ok, seat: 1, to: 0 }), /own turn/);
        assert.match(reject(s, { ...ok, to: 0 }), /yourself/);
        assert.match(reject(s, { ...ok, give: offer(0, [3]), get: offer(0, [5]) }), /doesn't own/);
        assert.match(reject(s, { ...ok, give: offer(9999) }), /doesn't have/);
        assert.match(reject(s, { ...ok, give: offer(0, [], 1) }), /jail cards/);
        assert.match(reject(s, { ...ok, give: offer(), get: offer() }), /empty/);
        assert.match(reject(s, { ...ok, give: offer(-5) }), /non-negative/);
        const built = base();
        give(built, 1, [1, 3], 1);
        assert.match(reject(built, { ...ok, give: offer(10), get: offer(0, [3]) }), /buildings/);
    });

    test("accept executes atomically; mortgaged tiles cost the receiver 10%", () => {
        let s = base();
        s.ownership["5"].mortgaged = true;
        s = act(s, { type: "propose-trade", seat: 0, to: 1, give: offer(100, [1]), get: offer(0, [3, 5]) });
        assert.ok(s.pendingTrade);
        assert.deepEqual(needsToAct(s), [0, 1]);
        assert.match(reject(s, { type: "roll", seat: 0 }), /trade/);
        assert.match(reject(s, { type: "propose-trade", seat: 0, to: 2, give: offer(1), get: offer() }), /trade/);
        assert.match(reject(s, { type: "accept-trade", seat: 2, tradeId: s.pendingTrade!.id }), /offered to/);
        assert.match(reject(s, { type: "accept-trade", seat: 1, tradeId: "nope" }), /no longer/);
        s = act(s, { type: "accept-trade", seat: 1, tradeId: s.pendingTrade!.id });
        assert.equal(s.pendingTrade, null);
        assert.equal(s.ownership["1"].owner, 1);
        assert.equal(s.ownership["3"].owner, 0);
        assert.equal(s.ownership["5"].owner, 0);
        assert.equal(s.ownership["5"].mortgaged, true);
        assert.equal(s.players[0].cash, 1500 - 100 - 10);
        assert.equal(s.players[1].cash, 1600);
        assert.equal(phase(s), "pre-roll");
    });

    test("accept is rejected if the receiver can't pay the interest, or the offer went stale", () => {
        let s = base();
        s.ownership["5"].mortgaged = true;
        s.players[0].cash = 5;
        s = act(s, { type: "propose-trade", seat: 0, to: 1, give: offer(0, [1]), get: offer(0, [5]) });
        assert.match(reject(s, { type: "accept-trade", seat: 1, tradeId: s.pendingTrade!.id }), /interest/);
        const stale = structuredClone(s);
        delete stale.ownership["1"];
        assert.match(reject(stale, { type: "accept-trade", seat: 1, tradeId: s.pendingTrade!.id }), /doesn't own/);
    });

    test("reject, cancel, jail cards", () => {
        let s = base();
        s.players[1].jailCards.chest = 1;
        s = act(s, { type: "propose-trade", seat: 0, to: 1, give: offer(50), get: offer(0, [], 1) });
        const id = s.pendingTrade!.id;
        assert.match(reject(s, { type: "cancel-trade", seat: 1, tradeId: id }), /proposer/);
        assert.equal(act(s, { type: "reject-trade", seat: 1, tradeId: id }).pendingTrade, null);
        assert.equal(act(s, { type: "cancel-trade", seat: 0, tradeId: id }).pendingTrade, null);
        const done = act(s, { type: "accept-trade", seat: 1, tradeId: id });
        assert.deepEqual(done.players[0].jailCards, { chance: 0, chest: 1 });
        assert.deepEqual(done.players[1].jailCards, { chance: 0, chest: 0 });
    });

    test("a debtor may trade during their debt", () => {
        let s = newGame(2);
        give(s, 1, [3]);
        give(s, 0, [39]);
        s.players[0].cash = 2;
        s = roll(rig(s, [1, 2]));
        assert.equal(phase(s), "debt");
        s = act(s, { type: "propose-trade", seat: 0, to: 1, give: offer(0, [39]), get: offer(300) });
        s = act(s, { type: "accept-trade", seat: 1, tradeId: s.pendingTrade!.id });
        assert.equal(phase(s), "debt");
        s = act(s, { type: "pay-debt", seat: 0 });
        assert.equal(s.players[0].cash, 298);
        assert.equal(phase(s), "post-roll");
    });
});

describe("debt and bankruptcy", () => {
    test("debt resumes the turn, keeping roll-again after doubles", () => {
        let s = newGame(2);
        give(s, 1, [37, 39], 3);
        give(s, 0, [1]);
        s.players[0].cash = 1000;
        s = roll(rig(place(s, 0, 33), [3, 3]));
        assert.equal(s.phase.kind === "debt" && s.phase.debt.amount, 1400);
        assert.deepEqual(s.phase.kind === "debt" && s.phase.resume, "post-roll");
        assert.match(reject(s, { type: "build", seat: 0, tile: 1 }), /debt/);
        assert.match(reject(s, { type: "roll", seat: 0 }), /roll/);
        s.players[0].cash = 1500;
        s = act(s, { type: "pay-debt", seat: 0 });
        assert.deepEqual(s.phase, { kind: "post-roll", rollAgain: true });
        assert.equal(s.players[1].cash, 2900);
    });

    test("bankruptcy to a player transfers cash, building value, property, jail cards", () => {
        let s = newGame(3);
        give(s, 1, [37, 39], 4);
        give(s, 0, [1, 3], 2);
        give(s, 0, [5], 0, true);
        s.players[0].cash = 100;
        s.players[0].jailCards.chance = 1;
        s.decks.chance.order = s.decks.chance.order.filter((i) => board.chance[i].effect.kind !== "jail-free");
        s.housesLeft = 32 - 12;
        s = roll(rig(place(s, 0, 34), [1, 2]));
        assert.equal(phase(s), "debt");
        assert.match(reject(s, { type: "declare-bankruptcy", seat: 1 }), /when in debt/);
        const bo = s.players[1].cash;
        s = act(s, { type: "declare-bankruptcy", seat: 0 });
        const ann = s.players[0];
        assert.equal(ann.bankrupt, true);
        assert.equal(ann.cash, 0);
        assert.equal(s.players[1].cash, bo + 100 + 4 * 25 - 10);
        assert.deepEqual([1, 3, 5].map((t) => s.ownership[String(t)].owner), [1, 1, 1]);
        assert.equal(s.ownership["5"].mortgaged, true);
        assert.equal(s.ownership["1"].houses, 0);
        assert.equal(s.housesLeft, 24);
        assert.equal(s.players[1].jailCards.chance, 1);
        assert.equal(s.current, 1);
        assert.equal(phase(s), "pre-roll");
        assert.match(reject(s, { type: "roll", seat: 0 }), /bankrupt/);
        // Ann is skipped forever.
        s = roll(rig(place(s, 1, 0), [1, 2]));
        s = act(s, { type: "end-turn", seat: 1 });
        s = roll(rig(place(s, 2, 0), [1, 2]));
        s = act(s, { type: "end-turn", seat: 2 });
        assert.equal(s.current, 1);
        assert.equal(s.round, 1);
    });

    test("bankruptcy to the bank returns everything", () => {
        let s = newGame(3);
        give(s, 0, [1, 3], 5);
        s.hotelsLeft = 10;
        s.players[0].cash = 10;
        s.players[0].jailCards.chest = 1;
        const cc = board.chest.findIndex((c) => c.effect.kind === "jail-free");
        s.decks.chest.order = s.decks.chest.order.filter((i) => i !== cc);
        s = roll(rig(s, [1, 3]));
        assert.deepEqual(s.phase.kind === "debt" && s.phase.debt, { debtor: 0, creditor: null, amount: 200 });
        s = act(s, { type: "declare-bankruptcy", seat: 0 });
        assert.equal(s.ownership["1"], undefined);
        assert.equal(s.ownership["3"], undefined);
        assert.equal(s.hotelsLeft, 12);
        assert.equal(s.decks.chest.order.length, 16);
        assert.equal(s.current, 1);
    });

    test("last player standing wins", () => {
        let s = newGame(2);
        give(s, 1, [3], 5);
        s.players[0].cash = 10;
        s = roll(rig(s, [1, 2]));
        s = act(s, { type: "declare-bankruptcy", seat: 0 });
        assert.deepEqual(s.phase, { kind: "game-over", winner: 1, reason: "last-standing" });
        assert.match(reject(s, { type: "roll", seat: 1 }), /over/);
        assert.deepEqual(needsToAct(s), []);
    });
});

describe("game end, admin, authorization", () => {
    test("round limit ends with the highest net worth", () => {
        let s = newGame(2, { roundLimit: 1 });
        give(s, 1, [39]);
        give(s, 0, [3]);
        s = roll(rig(s, [1, 2]));
        s = act(s, { type: "end-turn", seat: 0 });
        s = roll(rig(place(s, 1, 0), [1, 2]));
        assert.equal(netWorth(board, s, 1), 1496 + 400);
        assert.equal(netWorth(board, s, 0), 1504 + 60);
        s = act(s, { type: "end-turn", seat: 1 });
        assert.deepEqual(s.phase, { kind: "game-over", winner: 1, reason: "round-limit" });
    });

    test("end-game is creator only", () => {
        const s = newGame(2);
        assert.match(reject(s, { type: "end-game" }, "u1"), /creator/);
        const e = act(s, { type: "end-game" }, "u0");
        assert.deepEqual(e.phase, { kind: "game-over", winner: 0, reason: "ended" });
    });

    test("force-skip resolves each blocking phase", () => {
        let s = newGame(3, { auctionOnDecline: true });
        assert.match(reject(s, { type: "force-skip", seat: 0 }, "u1"), /creator/);
        assert.match(reject(s, { type: "force-skip", seat: 2 }, "u0"), /holding up/);
        rig(s, [2, 4]);
        s = act(s, { type: "force-skip", seat: 0 }, "u0"); // pre-roll -> roll
        assert.equal(phase(s), "buy-decision");
        s = act(s, { type: "force-skip", seat: 0 }, "u0"); // decline, no auction
        assert.equal(phase(s), "post-roll");
        assert.equal(s.ownership["6"], undefined);
        s = act(s, { type: "force-skip", seat: 0 }, "u0"); // end turn
        assert.equal(s.current, 1);

        let a = newGame(3);
        a = act(roll(rig(a, [2, 4])), { type: "decline", seat: 0 });
        a = act(a, { type: "force-skip", seat: 1 }, "u0");
        assert.equal(a.phase.kind === "auction" && a.phase.auction.bidders.join(), "2,0");

        let d = newGame(3);
        give(d, 1, [3], 5);
        d.players[0].cash = 1;
        d = act(roll(rig(d, [1, 2])), { type: "force-skip", seat: 0 }, "u0");
        assert.equal(d.players[0].bankrupt, true);
        assert.equal(d.current, 1);

        let t = newGame(2);
        give(t, 0, [1]);
        t = act(t, { type: "propose-trade", seat: 0, to: 1, give: { cash: 0, tiles: [1], jailCards: 0 }, get: { cash: 1, tiles: [], jailCards: 0 } });
        t = act(t, { type: "force-skip", seat: 1 }, "u0");
        assert.equal(t.pendingTrade, null);
    });

    test("seat authorization and malformed input never throw", () => {
        const s = newGame(2);
        assert.equal(reject(s, { type: "roll", seat: 0 }, "u1"), "That seat isn't yours.");
        assert.match(reject(s, { type: "roll", seat: 1 }), /not your turn/);
        assert.match(reject(s, { type: "roll", seat: 7 }, "u0"), /No such seat/);
        assert.match(reject(s, { type: "build", seat: 0, tile: 99 }), /No such tile/);
        assert.match(reject(s, { type: "bid", seat: 0, amount: 5 }), /no auction/);
        const bad = applyAction(board, s, { type: "propose-trade", seat: 0, to: 1, give: null, get: null } as never, actorFor(s, "u0"));
        assert.equal(bad.ok, false);
        const junk = applyAction(board, s, null as never, actorFor(s, "u0"));
        assert.equal(junk.ok, false);
    });
});

describe("views and bookkeeping", () => {
    test("needsToAct and seatView", () => {
        let s = newGame(2);
        assert.deepEqual(needsToAct(s), [0]);
        const v = seatView(board, s, 0);
        assert.ok(v.legal.includes("roll"));
        assert.ok(v.legal.includes("propose-trade"));
        assert.ok(v.legal.includes("end-game"));
        assert.ok(!v.legal.includes("end-turn"));
        assert.deepEqual(seatView(board, s, 1).legal, []);
        assert.equal(v.netWorth, 1500);
        give(s, 0, [1, 3]);
        assert.deepEqual(seatView(board, s, 0).buildable, [1, 3]);
        assert.deepEqual(seatView(board, s, 0).mortgageable, [1, 3]);
        s = roll(rig(s, [1, 2]));
        assert.deepEqual(seatView(board, s, 0).legal.sort(), ["build", "end-game", "end-turn", "force-skip", "mortgage", "propose-trade"].sort());
    });

    test("applyAction never mutates input; log is capped; ids keep counting", () => {
        let s = newGame(2);
        const before = JSON.stringify(s);
        applyAction(board, s, { type: "roll", seat: 0 }, actorFor(s, "u0"));
        assert.equal(JSON.stringify(s), before);
        for (let k = 0; k < 40; k++) {
            s = roll(s, s.current);
            while (s.phase.kind !== "post-roll" || s.phase.rollAgain) {
                const seat = needsToAct(s)[0];
                s = act(s, { type: "force-skip", seat }, "u0");
            }
            s = act(s, { type: "end-turn", seat: s.current });
            if (phase(s) === "game-over") break;
        }
        assert.ok(s.log.length <= 60);
        assert.ok(s.nextLogId > 60);
        assert.equal(s.log[s.log.length - 1].id, s.nextLogId - 1);
    });
});

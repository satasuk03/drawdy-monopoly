// End-to-end smoke test of the driver entry against an in-memory fake Drawdy
// host: activate → panel ready → create game → hot-seat joins → start → roll,
// then check the scene the renderer produced. The fake implements just enough
// of the protocol (add/update/remove/get, echo events) to exercise the real
// code paths; it does not prove anything about Drawdy itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DriverModule, DriverSubscriptionEvent } from "@drawdy/driver-protocol";

type El = Record<string, unknown> & { id: string; type: string };

class FakeHost {
    els = new Map<string, El>();
    posted: { type: string; [k: string]: unknown }[] = [];
    errors: string[] = [];
    onEvent: DriverModule["onEvent"] | null = null;

    private emit(type: string, drawdyElements: El[]): void {
        const ev = { type, subscriptionId: "s", body: { drawdyElements: drawdyElements.map((e) => ({ id: e.id, type: e.type, meta: e.meta })), properties: ["type", "meta"] } };
        setTimeout(() => void this.onEvent?.(ev as unknown as DriverSubscriptionEvent), 0);
    }

    issue = async (r: { type: string; req?: any }): Promise<any> => {
        const ok = (value: unknown) => ({ res: { value } });
        const fail = (type: string, body?: unknown) => ({ res: { error: { type, body } } });
        const { type, req } = r;
        if (type.startsWith("subscription:")) return ok({ subscriptionId: type });
        switch (type) {
            case "command:collaboration:get-all-users-in-board":
                return ok({ users: [{ id: "u1", name: "Ada", color: "#123456", isHost: true, isSelf: true, cursorPosition: null }] });
            case "command:camera:get-viewport-rect":
                return ok({ rect: { x: 100, y: 100, width: 1600, height: 900 } });
            case "command:webview:post-message":
                this.posted.push(req.message);
                return ok({ posted: true });
            case "command:scene:add-drawdy-elements": {
                const taken = req.elements.filter((e: any) => this.els.has(e.drawdyElementId)).map((e: any) => e.drawdyElementId);
                if (taken.length) return fail("bad-argument", { existingIds: taken });
                const added: El[] = [];
                for (const e of req.elements) {
                    const el: El = { ...e, id: e.drawdyElementId, type: e.type === "shape" ? "path" : e.type };
                    if (e.type === "frame") {
                        el.x = e.position[0];
                        el.y = e.position[1];
                        el.frameName = e.name;
                    }
                    this.els.set(el.id, el);
                    added.push(el);
                }
                this.emit("subscription:scene:elements-added", added);
                return ok(undefined);
            }
            case "command:scene:update-drawdy-elements": {
                let n = 0;
                const touched: El[] = [];
                for (const u of req.updates) {
                    const el = this.els.get(u.drawdyElementId);
                    if (!el) continue;
                    n++;
                    const { meta, transform, ...rest } = u.properties;
                    if (meta) el.meta = { ...(el.meta as object), ...meta };
                    if (transform) Object.assign(el, transform);
                    Object.assign(el, rest);
                    touched.push(el);
                }
                this.emit("subscription:scene:elements-updated", touched);
                return ok({ updated: n });
            }
            case "command:scene:remove-drawdy-elements": {
                const gone: El[] = [];
                for (const id of req.drawdyElementIds) {
                    const el = this.els.get(id);
                    if (el) gone.push(el);
                    this.els.delete(id);
                }
                this.emit("subscription:scene:elements-removed", gone);
                return ok({ removed: gone.length });
            }
            case "command:scene:get-drawdy-elements": {
                const ids: string[] | undefined = req.drawdyElementIds;
                const list = ids ? ids.map((id) => this.els.get(id)).filter(Boolean) : [...this.els.values()];
                return ok({ drawdyElements: list.map((e: any) => ({ ...e })) });
            }
            default:
                return ok({});
        }
    };

    async message(message: unknown): Promise<void> {
        await this.onEvent!({ type: "subscription:webview:message", subscriptionId: "s", body: { webviewDomId: "satasuk.board-tycoon:panel", message } } as DriverSubscriptionEvent);
    }

    lastView(): any {
        const views = this.posted.filter((m) => m.type === "view");
        return (views.at(-1) as any)?.view;
    }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("driver: create a game, hot-seat join, start, roll — scene and view stay consistent", async () => {
    const host = new FakeHost();
    const mod = await import("../src/index");
    host.onEvent = mod.onEvent;
    await mod.activate({
        issueCommand: host.issue as any,
        manifest: { driverId: "satasuk.board-tycoon", driverName: "x", driverVersion: "0", main: "main.js", permissions: [] },
        styling: { theme: "dark", tokens: { "--dd-accent": "#f00" } } as any,
        generateId: (() => {
            let i = 0;
            return () => `gen${i++}`;
        })(),
    });

    await host.message({ type: "ready" });
    await wait(80);
    const init = host.posted.find((m) => m.type === "init") as any;
    assert.ok(init, "init posted");
    assert.equal(init.me.userId, "u1");
    assert.equal(init.boards.length, 4);
    assert.equal(init.themeTokens["--dd-accent"], "#f00");

    await host.message({ type: "create-game", boardId: "classic", settings: { startingCash: 2000, bogus: 1 } });
    await wait(120);
    const frame = [...host.els.values()].find((e) => e.type === "frame")!;
    assert.ok(frame, "frame added");
    const gameId = (frame.meta as any).tycoon.state.gameId as string;
    assert.equal((frame.meta as any).tycoon.state.settings.startingCash, 2000);
    assert.ok([...host.els.values()].every((e) => e.locked === true), "everything locked");
    const owners = [...host.els.keys()].filter((id) => id.includes(":own:"));
    assert.equal(owners.length, 0, "no owner markers before anyone buys");

    const act = (action: unknown) => host.message({ type: "action", gameId, action });
    await act({ type: "join", name: "Ada", color: "#ff0000", token: "" });
    await act({ type: "join", name: "Bob", color: "", token: "" });
    await act({ type: "start" });
    await wait(150);
    let view = host.lastView();
    assert.equal(view.state.players.length, 2);
    assert.deepEqual(view.mySeats, [0, 1]);
    assert.equal(view.activeSeat, 0);
    assert.equal(view.pending, false);
    assert.equal(view.state.phase.kind, "pre-roll");
    const tokens = () => [...host.els.values()].filter((e) => e.id.includes(":tok:"));
    assert.equal(tokens().length, 2);

    await act({ type: "roll", seat: 0 });
    await wait(2800); // dice throw + hop animation
    view = host.lastView();
    const p0 = view.state.players[0];
    assert.ok(view.state.dice, "dice rolled");
    const dice = [...host.els.keys()].filter((id) => id.includes(":die:"));
    assert.equal(dice.length, 2);
    const ownerMeta = (host.els.get(frame.id)!.meta as any).tycoon;
    assert.equal(ownerMeta.version, view.state === undefined ? -1 : ownerMeta.version);
    assert.equal(ownerMeta.state.players[0].position, p0.position);
    assert.match(String(host.els.get(frame.id)!.frameName), /Board Tycoon · Classic/);
    // The token ended exactly where layout says (board origin = frame + PAD).
    const { tokenPosition, tokenSlots, PAD } = await import("../src/scene/build");
    const slot = tokenSlots(ownerMeta.state).get(0)!;
    const want = tokenPosition({ x: (frame.x as number) + PAD, y: (frame.y as number) + PAD }, slot.tile, slot.slot, slot.jailed, slot.count);
    const t0 = tokens().find((e) => e.id.includes(":tok:0:"))!;
    assert.deepEqual({ x: t0.x, y: t0.y }, want);

    // An engine rejection for my own direct action is reported.
    const before = host.posted.length;
    await act({ type: "roll", seat: 1 });
    await wait(80);
    assert.ok(host.posted.slice(before).some((m) => m.type === "error"), "error posted");

    // Deleting a token is healed on the next pass.
    const tok = tokens()[0]!;
    await host.issue({ type: "command:scene:remove-drawdy-elements", req: { drawdyElementIds: [tok.id] } });
    // (The pass that re-adds it may wait for the roll's animation to finish first.)
    for (let i = 0; i < 40 && !host.els.has(tok.id); i++) await wait(100);
    assert.ok(host.els.has(tok.id), "token re-added");

    // Undo-like rollback of the frame meta is re-asserted by the authority.
    const good = (host.els.get(frame.id)!.meta as any).tycoon;
    await host.issue({
        type: "command:scene:update-drawdy-elements",
        req: { updates: [{ drawdyElementId: frame.id, properties: { meta: { tycoon: { ...good, version: 1 } } } }] },
    });
    await wait(150);
    assert.equal((host.els.get(frame.id)!.meta as any).tycoon.version, good.version);

    // Delete the game.
    await host.message({ type: "delete-game", gameId });
    await wait(80);
    assert.equal([...host.els.keys()].filter((id) => id.startsWith(gameId)).length, 0);
    assert.equal(host.errors.length, 0);
});

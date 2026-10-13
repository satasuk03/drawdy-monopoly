// Board Tycoon control panel. Plain DOM, no framework, no external resources.
// Renders entirely from the latest driver messages (see src/ui/messages.ts).
// It never computes rules: buttons are enabled from SeatView.legal and friends.
(function () {
    "use strict";

    const api = acquireDrawdyApi();
    const L = BT_I18N;
    const t = L.t;
    const tn = L.tn;
    const tx = L.tx;
    const sfx = BT_SFX;

    // ---------------------------------------------------------------- state
    const S = {
        me: null,
        boards: [],
        defaults: null,
        games: [],
        selected: null,
        view: null,
        error: null,
        errTimer: null,
        toasts: [],
        lastLog: {}, // gameId -> last log id seen
    };

    const COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00", "#00acc1", "#ec407a"];
    const COLOR_KEYS = ["red", "blue", "green", "yellow", "purple", "orange", "teal", "pink"];

    const freshJoin = () => ({ init: false, open: false, name: "", color: "", token: "" });
    const freshTrade = () => ({
        to: null,
        give: { tiles: [], cash: "", jail: 0 },
        get: { tiles: [], cash: "", jail: 0 },
    });

    const ui = {
        newGame: false,
        newBoard: null,
        newSettings: null,
        newLang: null,
        tab: "assets",
        seat: null,
        lastActive: undefined,
        lastPhase: "",
        join: freshJoin(),
        trade: freshTrade(),
        tradeSeat: null,
        confirm: null,
        more: false,
        bid: "",
        primary: null,
    };

    // -------------------------------------------------------------- helpers
    function h(tag, props, ...kids) {
        const el = document.createElement(tag);
        if (props) {
            for (const k in props) {
                const v = props[k];
                if (v == null || v === false) continue;
                if (k === "class") el.className = v;
                else if (k === "style") el.style.cssText = v;
                else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
                else if (k === "disabled" || k === "checked" || k === "value" || k === "selected") el[k] = v;
                else el.setAttribute(k, v === true ? "" : String(v));
            }
        }
        append(el, kids);
        return el;
    }
    function append(el, kids) {
        for (const kid of kids) {
            if (kid == null || kid === false) continue;
            if (Array.isArray(kid)) append(el, kid);
            else if (kid instanceof Node) el.appendChild(kid);
            else el.appendChild(document.createTextNode(String(kid)));
        }
    }

    function safeColor(c, fallback) {
        return typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback || "#888888";
    }

    // Port of src/boards/types.ts
    function formatMoney(board, base) {
        const cur = board.currency;
        const n = Math.round(base * cur.scale);
        const abs = Math.abs(n).toLocaleString("en-US");
        const sign = n < 0 ? "-" : "";
        return cur.suffix ? sign + abs + " " + cur.symbol : sign + cur.symbol + abs;
    }
    function formatCardText(board, text) {
        return String(text).replace(/\{money:(-?\d+)\}/g, (_, n) => formatMoney(board, Number(n)));
    }
    const fmt = (n) => formatMoney(S.view.board, n);

    // SVG strings come from our own driver, but sanitize anyway.
    const svgCache = new Map();
    function cleanSvg(str) {
        if (typeof str !== "string" || !str) return "";
        if (svgCache.has(str)) return svgCache.get(str);
        let out = "";
        try {
            const doc = new DOMParser().parseFromString(str, "image/svg+xml");
            const root = doc.documentElement;
            if (root && root.nodeName.toLowerCase() === "svg" && !doc.querySelector("parsererror")) {
                root.querySelectorAll("script,foreignObject,iframe,object,embed,audio,video").forEach((n) => n.remove());
                root.querySelectorAll("style").forEach((n) => {
                    if (/@import|url\(\s*['"]?(https?:|data:|\/\/)/i.test(n.textContent || "")) n.remove();
                });
                const all = [root, ...root.querySelectorAll("*")];
                for (const n of all) {
                    for (const a of Array.from(n.attributes)) {
                        const name = a.name.toLowerCase();
                        const val = a.value.trim();
                        if (name.startsWith("on") || /^\s*javascript:/i.test(val)) n.removeAttribute(a.name);
                        else if ((name === "href" || name === "xlink:href") && !(val.startsWith("#") || /^data:image\//i.test(val)))
                            n.removeAttribute(a.name);
                        else if (name === "style" && /url\(\s*['"]?(https?:|\/\/)/i.test(val)) n.removeAttribute(a.name);
                    }
                }
                out = new XMLSerializer().serializeToString(root);
            }
        } catch (e) {
            out = "";
        }
        svgCache.set(str, out);
        return out;
    }
    function svgBox(str, cls) {
        const box = h("span", { class: cls || "svg" });
        box.innerHTML = cleanSvg(str);
        return box;
    }

    function post(msg) {
        api.postMessage(msg);
    }
    function act(action) {
        if (!S.view) return;
        post({ type: "action", gameId: S.view.state.gameId, action });
    }

    // ------------------------------------------------------------- derived
    function actingSeat() {
        const v = S.view;
        if (!v || !v.mySeats.length) return null;
        if (ui.seat != null && v.mySeats.includes(ui.seat)) return ui.seat;
        return v.activeSeat != null ? v.activeSeat : v.mySeats[0];
    }
    const seatView = (seat) => (S.view.seatViews || []).find((s) => s.seat === seat) || null;
    const legalOf = (seat) => new Set(seat == null || !seatView(seat) ? [] : seatView(seat).legal);
    const player = (seat) => S.view.state.players[seat];
    const isMine = (seat) => S.view.mySeats.includes(seat);

    function tileColor(board, t) {
        if (t.kind === "property") {
            const g = board.groups.find((x) => x.id === t.group);
            return safeColor(g && g.color, "#999999");
        }
        if (t.kind === "railroad") return "#5b6270";
        if (t.kind === "utility") return "#9aa3b2";
        return "#999999";
    }
    function tileGroupName(board, t) {
        if (t.kind === "property") {
            const g = board.groups.find((x) => x.id === t.group);
            return g ? g.name : "";
        }
        if (t.kind === "railroad") return board.labels.railroad;
        if (t.kind === "utility") return board.labels.utility;
        return "";
    }
    function ownedTiles(seat) {
        const own = S.view.state.ownership;
        return Object.keys(own)
            .filter((k) => own[k].owner === seat)
            .map(Number)
            .sort((a, b) => a - b);
    }
    function waitingSeat() {
        const st = S.view.state;
        const ph = st.phase;
        if (ph.kind === "debt") return ph.debt.debtor;
        if (ph.kind === "auction") return ph.auction.bidders[ph.auction.turn];
        return st.current;
    }
    function netWorthOf(seat) {
        const sv = seatView(seat);
        return sv ? sv.netWorth : null;
    }

    // ------------------------------------------------------------------ fx
    // render() rebuilds the whole DOM on every change, so an animation started
    // on an element would vanish with it. fx() records the animation and its
    // start time instead; after every render the live ones are re-attached to
    // the new elements matching the selector, seeked to where they'd be by now.
    // One-shot overlays (money deltas, stamps, confetti) live in #fx, outside
    // the re-rendered tree. Steady loops (glows, pings) are phase-locked through
    // --ph so a re-render never visibly restarts them.
    const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const SPRING = "cubic-bezier(.34,1.56,.64,1)";
    const LOOP_MS = 2400;
    const FX = [];
    const postRender = [];
    const fxLayer = document.body.appendChild(h("div", { id: "fx", "aria-hidden": "true" }));

    function fx(sel, kf, opts) {
        if (reduced) return;
        const o = Object.assign({ easing: SPRING, fill: "backwards" }, opts);
        const e = { sel, kf, opts: o, t0: performance.now() };
        e.end = e.t0 + (o.delay || 0) + o.duration;
        FX.push(e);
        attachFx(e);
    }
    function attachFx(e) {
        const now = performance.now();
        for (const el of rootEl.querySelectorAll(e.sel)) {
            const seen = el.__fx || (el.__fx = new Set());
            if (seen.has(e)) continue;
            seen.add(e);
            el.animate(e.kf, e.opts).currentTime = now - e.t0;
        }
    }
    function replayFx() {
        const now = performance.now();
        for (let i = FX.length - 1; i >= 0; i--) if (FX[i].end < now) FX.splice(i, 1);
        FX.forEach(attachFx);
        document.documentElement.style.setProperty("--ph", -Math.round(now % LOOP_MS) + "ms");
        postRender.splice(0).forEach((f) => f());
    }
    /** Run after the next render, when the new DOM can be measured. */
    function afterRender(f) {
        postRender.push(f);
    }
    const attr = (k, v) => "[" + k + '="' + String(v).replace(/["\\]/g, "\\$&") + '"]';
    function visible(sel) {
        for (const el of rootEl.querySelectorAll(sel)) if (el.getClientRects().length) return el;
        return null;
    }
    function cssVar(name, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }
    /** "#abc" / "#aabbcc" + 2-digit alpha → "#aabbccAA". */
    function alpha(c, aa) {
        const m = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(c || "");
        if (!m) return c;
        const hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
        return "#" + hex + aa;
    }
    /** A floating overlay centered on `anchor`; removed when its animation ends. */
    function overlay(content, anchor, kf, opts) {
        if (reduced || !anchor) return;
        const r = anchor.getBoundingClientRect();
        if (!r.width && !r.height) return;
        const box = h("div", { class: "fxo", style: "left:" + (r.left + r.width / 2) + "px;top:" + (r.top + r.height / 2) + "px" }, content);
        fxLayer.appendChild(box);
        const o = Object.assign({ fill: "both", easing: "ease-out" }, opts);
        box.animate(kf, o).onfinish = () => box.remove();
        // Backstop: finish events can be throttled in a background panel.
        setTimeout(() => box.remove(), (o.delay || 0) + o.duration + 250);
    }

    const SHAKE = [
        { transform: "none" },
        { transform: "translateX(-8px) rotate(-1deg)" },
        { transform: "translateX(7px) rotate(1deg)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(3px)" },
        { transform: "none" },
    ];
    const POP_IN = [{ transform: "translateY(14px) scale(.92)", opacity: 0 }, { transform: "none", opacity: 1 }];

    // Cash counters tween from the old amount to the new one.
    const CASH_MS = 700;
    const tweens = {}; // seat -> { from, to, t0 }
    let tweenRaf = 0;
    function cashValue(seat, cash) {
        const t = tweens[seat];
        if (!t) return cash;
        const k = (performance.now() - t.t0) / CASH_MS;
        if (k >= 1) {
            delete tweens[seat];
            return cash;
        }
        return Math.round(t.from + (t.to - t.from) * (1 - (1 - k) ** 3));
    }
    function cashText(seat, cash) {
        return fmt(cashValue(seat, cash));
    }
    function tickCash() {
        tweenRaf = 0;
        if (!S.view) return;
        for (const s of Object.keys(tweens)) {
            const p = S.view.state.players[s];
            if (!p) {
                delete tweens[s];
                continue;
            }
            const txt = cashText(Number(s), p.cash);
            rootEl.querySelectorAll(attr("data-cash", s)).forEach((el) => (el.textContent = txt));
        }
        if (Object.keys(tweens).length) tweenRaf = requestAnimationFrame(tickCash);
    }
    function cashFx(seat, from, to) {
        const up = to > from;
        const col = cssVar(up ? "--good" : "--bad", up ? "#1f9d55" : "#d64545");
        if (!reduced) {
            tweens[seat] = { from: cashValue(seat, from), to, t0: performance.now() };
            if (!tweenRaf) tweenRaf = requestAnimationFrame(tickCash);
        }
        fx(attr("data-cash", seat), [{ transform: "scale(1.35)", color: col }, { transform: "scale(1)" }], { duration: 650 });
        fx(attr("data-seat", seat), [{ boxShadow: "0 0 0 3px " + col, borderColor: col }, { boxShadow: "0 0 0 10px " + alpha(col, "00") }], { duration: 800, easing: "ease-out" });
        const label = (up ? "+" : "\u2212") + formatMoney(S.view.board, Math.abs(to - from));
        afterRender(() =>
            overlay(h("div", { class: "fxdelta " + (up ? "up" : "down") }, label), visible(attr("data-cash", seat)), [
                { transform: "translateY(0) scale(.5)", opacity: 0 },
                { offset: 0.15, transform: "translateY(-10px) scale(1.2)", opacity: 1 },
                { offset: 0.65, transform: "translateY(-28px) scale(1)", opacity: 1 },
                { transform: "translateY(-50px) scale(.95)", opacity: 0 },
            ], { duration: 1400 })
        );
    }

    // Dice: a click on "Roll" shakes the mini dice through random faces until the roll arrives.
    let rolling = null;
    const randomDie = () => 1 + Math.floor(Math.random() * 6);
    function startRolling() {
        if (reduced) return;
        stopRolling();
        rolling = {
            spin: setInterval(() => {
                const box = rootEl.querySelector(".dice.rolling");
                if (box) box.replaceChildren(dieFace(randomDie()), dieFace(randomDie()), h("span", { class: "dsum" }, "?"));
            }, 90),
            // Give up if no roll ever arrives (rejected, lost authority...).
            limit: setTimeout(() => {
                stopRolling();
                render();
            }, 5000),
        };
        render();
    }
    function stopRolling() {
        if (!rolling) return;
        clearInterval(rolling.spin);
        clearTimeout(rolling.limit);
        rolling = null;
    }
    function diceFx(dice) {
        const drop = (rot) => [
            { transform: "translateY(-28px) rotate(" + rot + "deg) scale(.4)", opacity: 0 },
            { offset: 0.5, transform: "translateY(2px) rotate(0deg) scale(1.2,.8)", opacity: 1 },
            { offset: 0.68, transform: "translateY(-7px) scale(.92,1.08)" },
            { offset: 0.84, transform: "translateY(0) scale(1.06,.94)" },
            { transform: "none" },
        ];
        fx(".dice .die:nth-child(1)", drop(-280), { duration: 720, easing: "ease-out" });
        fx(".dice .die:nth-child(2)", drop(240), { duration: 720, delay: 90, easing: "ease-out" });
        fx(".dice .dsum", [{ transform: "scale(0)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 450, delay: 450 });
        if (dice[0] === dice[1])
            afterRender(() =>
                overlay(h("div", { class: "fxbadge" }, t("fx.doubles")), rootEl.querySelector(".dice"), [
                    { transform: "translate(-20px, 0) scale(0) rotate(-20deg)", opacity: 0 },
                    { offset: 0.2, transform: "translate(-20px, -26px) scale(1.25) rotate(6deg)", opacity: 1 },
                    { offset: 0.3, transform: "translate(-20px, -26px) scale(1) rotate(-4deg)" },
                    { offset: 0.8, transform: "translate(-20px, -30px) scale(1) rotate(-4deg)", opacity: 1 },
                    { transform: "translate(-20px, -44px) scale(.9)", opacity: 0 },
                ], { duration: 1600, delay: 500 })
            );
    }

    function stampFx(text) {
        afterRender(() => {
            const card = rootEl.querySelector(".card.acting");
            overlay(h("div", { class: "fxstamp" }, text), card, [
                { transform: "scale(2.8) rotate(-32deg)", opacity: 0 },
                { offset: 0.18, transform: "scale(.9) rotate(-12deg)", opacity: 1 },
                { offset: 0.28, transform: "scale(1.06) rotate(-12deg)" },
                { offset: 0.38, transform: "scale(1) rotate(-12deg)" },
                { offset: 0.82, transform: "scale(1) rotate(-12deg)", opacity: 1 },
                { transform: "scale(1.15) rotate(-12deg)", opacity: 0 },
            ], { duration: 1500 });
        });
        // The card takes the hit as the stamp lands.
        fx(".card.acting", [{ transform: "none" }, { transform: "scale(.97)" }, { transform: "none" }], { duration: 300, delay: 250, easing: "ease-out" });
    }

    function confetti(colors) {
        if (reduced) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const c = h("canvas", { class: "fxconfetti", width: W, height: H });
        fxLayer.appendChild(c);
        const ctx = c.getContext("2d");
        if (!ctx) return c.remove();
        // Two cannons, one from each lower corner.
        const parts = [];
        for (let i = 0; i < 150; i++) {
            const left = i % 2 === 0;
            parts.push({
                x: left ? 0 : W,
                y: H * 0.7,
                vx: (left ? 1 : -1) * (2 + Math.random() * 6),
                vy: -(7 + Math.random() * 9),
                r: Math.random() * 6.28,
                vr: (Math.random() - 0.5) * 0.4,
                w: 5 + Math.random() * 5,
                h: 3 + Math.random() * 4,
                c: colors[i % colors.length],
            });
        }
        const t0 = performance.now();
        const LIFE = 2800;
        const step = (now) => {
            const t = now - t0;
            ctx.clearRect(0, 0, W, H);
            ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE - t) / 600));
            for (const p of parts) {
                p.vy += 0.28;
                p.vx *= 0.985;
                p.x += p.vx;
                p.y += p.vy;
                p.r += p.vr;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.r);
                ctx.fillStyle = p.c;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
                ctx.restore();
            }
            if (t < LIFE) requestAnimationFrame(step);
            else c.remove();
        };
        requestAnimationFrame(step);
    }

    function rollId(st) {
        for (let i = st.log.length - 1; i >= 0; i--) if (st.log[i].tone === "dice") return st.log[i].id;
        return -1;
    }
    const deedKey = (ph) => (ph.kind === "buy-decision" ? "b" + ph.tile : ph.kind === "auction" ? "a" + ph.auction.tile : null);

    /** Diff the previous view against the new one (already in S.view) and queue effects. */
    function viewFx(prev, v) {
        if (!prev || prev.state.gameId !== v.state.gameId) return;
        const a = prev.state;
        const b = v.state;
        const ap = a.phase;
        const bp = b.phase;

        for (const p of b.players) {
            const o = a.players[p.seat];
            if (o && o.cash !== p.cash) cashFx(p.seat, o.cash, p.cash);
        }

        if (rollId(b) !== rollId(a)) {
            stopRolling();
            if (b.dice) diceFx(b.dice);
        }

        if (bp.kind === "game-over") {
            if (ap.kind !== "game-over") {
                fx(".card.winner", [{ transform: "scale(.5) rotate(-4deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 800 });
                confetti(b.players.map((p) => safeColor(p.color)).concat(["#ffd54a", "#ffffff"]));
            }
            return;
        }

        if (a.current !== b.current) {
            const p = b.players[b.current];
            const col = safeColor(p && p.color);
            fx(".turnbar .turn", [{ transform: "translateX(-16px) scale(.85)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 560 });
            fx(".turnbar", [{ boxShadow: "0 0 0 0 " + alpha(col, "aa"), borderColor: col }, { boxShadow: "0 0 0 14px " + alpha(col, "00") }], { duration: 1000, easing: "ease-out" });
            if (isMine(b.current)) fx(".card.act", POP_IN, { duration: 600, delay: 120 });
        }

        const dk = deedKey(bp);
        if (dk && dk !== deedKey(ap))
            fx(".deed", [
                { transform: "perspective(700px) rotateY(-95deg) scale(.9)", opacity: 0 },
                { offset: 0.6, transform: "perspective(700px) rotateY(14deg) scale(1.02)", opacity: 1 },
                { transform: "perspective(700px) rotateY(0) scale(1)" },
            ], { duration: 700, easing: "ease-out" });

        for (const k of Object.keys(b.ownership)) {
            const now = b.ownership[k];
            const was = a.ownership[k];
            if (!isMine(now.owner) || (was && was.owner === now.owner)) continue;
            stampFx(was ? t("fx.yours") : t("fx.sold"));
            break;
        }

        let hurt = false;
        for (const p of b.players) {
            const o = a.players[p.seat];
            if (!o || !isMine(p.seat)) continue;
            if ((p.inJail && !o.inJail) || (p.bankrupt && !o.bankrupt)) hurt = true;
        }
        if (bp.kind === "debt" && isMine(bp.debt.debtor) && !(ap.kind === "debt" && ap.debt.debtor === bp.debt.debtor)) hurt = true;
        if (hurt) fx(".card.acting", SHAKE, { duration: 500, easing: "ease-out" });

        const lastLog = a.log.reduce((m, e) => Math.max(m, e.id), -1);
        for (const e of b.log)
            if (e.id > lastLog)
                fx(".lrow" + attr("data-log", e.id), [
                    { transform: "translateX(-28px)", opacity: 0, backgroundColor: alpha(safeColor(b.players[e.seat] && b.players[e.seat].color, "#888888"), "55") },
                    { offset: 0.4, transform: "translateX(3px)", opacity: 1 },
                    { transform: "none" },
                ], { duration: 900, easing: "ease-out" });
    }

    /** Same diff as viewFx, for sounds. Each sound plays at most once per update, staggered after the dice land. */
    function viewSfx(prev, v) {
        if (!prev || prev.state.gameId !== v.state.gameId) return;
        const a = prev.state;
        const b = v.state;
        const ap = a.phase;
        const bp = b.phase;
        const rolled = rollId(b) !== rollId(a) && b.dice;
        const later = rolled ? 700 : 0;
        const play = (name, at) => sfx.play(name, later + (at || 0));

        if (rolled) {
            sfx.play("dice");
            if (b.dice[0] === b.dice[1]) sfx.play("doubles");
        }
        if (bp.kind === "game-over") {
            if (ap.kind !== "game-over") play("win");
            return;
        }

        const lastLog = a.log.reduce((m, e) => Math.max(m, e.id), -1);
        if (b.log.some((e) => e.id > lastLog && e.tone === "card")) play("card");

        let jailed = false;
        let broke = false;
        let mine = 0;
        let others = false;
        for (const p of b.players) {
            const o = a.players[p.seat];
            if (!o) continue;
            if (p.inJail && !o.inJail) jailed = true;
            if (p.bankrupt && !o.bankrupt) broke = true;
            if (o.cash !== p.cash) {
                if (isMine(p.seat)) mine += p.cash - o.cash;
                else others = true;
            }
        }
        if (broke) play("bankrupt", 200);
        else if (jailed) play("jail", 200);
        else if (bp.kind === "debt" && isMine(bp.debt.debtor) && !(ap.kind === "debt" && ap.debt.debtor === bp.debt.debtor)) play("debt", 200);

        let bought = false;
        let built = 0;
        for (const k of Object.keys(b.ownership)) {
            const now = b.ownership[k];
            const was = a.ownership[k];
            if (!was) bought = true;
            else built += now.houses - was.houses;
        }
        for (const k of Object.keys(a.ownership)) if (!b.ownership[k]) built -= a.ownership[k].houses;
        // A bankruptcy hands over or clears a whole estate: its own sound covers that.
        if (!broke) {
            if (bought) play("buy");
            else if (built > 0) play("build");
            else if (built < 0) play("sell");
        }

        if (mine > 0) play("coinIn", 300);
        else if (mine < 0) play("coinOut", 300);
        else if (others) play("coin", 300);

        if (bp.kind === "auction" && deedKey(bp) !== deedKey(ap)) play("auction", 200);
        const tr = b.pendingTrade;
        if (tr && isMine(tr.to) && !(a.pendingTrade && a.pendingTrade.id === tr.id)) play("trade");
        if (a.current !== b.current && isMine(b.current) && v.mySeats.length < b.players.length) play("myTurn", 600);
    }

    // ---------------------------------------------------------- UI pieces
    function chip(p, size) {
        const c = h("span", { class: "chip " + (size || ""), style: "--pc:" + safeColor(p.color) });
        const svg = S.view && S.view.tokenSvgs ? S.view.tokenSvgs[p.token] : "";
        if (svg) c.appendChild(svgBox(svg));
        return c;
    }
    function dot(color) {
        return h("span", { class: "cdot", style: "background:" + safeColor(color) });
    }
    function nameTag(p) {
        return h("span", { class: "ptag" }, dot(p.color), h("span", { class: "pname" }, p.name));
    }

    function btn(label, o) {
        o = o || {};
        const disabled = o.enabled === false || (!o.nav && S.view && S.view.pending);
        const k = "b:" + (o.key || (typeof label === "string" ? label : ""));
        // Squash on press, spring back (survives the re-render the click triggers).
        const press = () => fx(attr("data-k", k), [{ transform: "scale(.9)" }, { transform: "scale(1)" }], { duration: 420 });
        return h(
            "button",
            {
                type: "button",
                class: "btn " + (o.cls || ""),
                disabled,
                "data-k": k,
                title: o.title,
                "aria-label": o["aria"],
                onclick: o.onClick
                    ? (e) => {
                          press();
                          o.onClick(e);
                      }
                    : null,
            },
            label
        );
    }
    function primary(label, action, enabled, sub) {
        const run = () => {
            if (action.type === "roll") {
                sfx.play("shake");
                startRolling();
            }
            act(action);
        };
        const live = enabled !== false && !(S.view && S.view.pending);
        if (live && !ui.primary) ui.primary = run;
        // A live primary action breathes and shimmers to say "your move".
        return btn([label, sub ? h("small", {}, sub) : null], { cls: "primary" + (live ? " hot" : ""), onClick: run, enabled, key: "primary" });
    }

    function field(label, control, hint) {
        return h("label", { class: "field" }, h("span", { class: "flabel" }, label), control, hint ? h("span", { class: "hint" }, hint) : null);
    }
    function numInput(key, value, onChange, o) {
        o = o || {};
        return h("input", {
            type: "number",
            "data-k": "n:" + key,
            min: o.min != null ? o.min : 0,
            step: o.step || 1,
            value: value === "" || value == null ? "" : String(value),
            placeholder: o.placeholder,
            disabled: o.disabled,
            onchange: (e) => onChange(e.target.value === "" ? "" : Number(e.target.value)),
            oninput: o.live ? (e) => o.live(e.target.value) : null,
        });
    }

    function dieFace(n) {
        const patterns = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
        const on = patterns[n] || [];
        const cells = [];
        for (let i = 0; i < 9; i++) cells.push(h("i", { class: on.includes(i) ? "pip on" : "pip" }));
        return h("span", { class: "die", role: "img", "aria-label": t("dieShowing", { n }) }, cells);
    }

    function houseIcons(houses) {
        if (!houses) return null;
        if (houses >= 5) return h("span", { class: "bldg", title: t("hotel") }, h("i", { class: "hotel" }));
        const arr = [];
        for (let i = 0; i < houses; i++) arr.push(h("i", { class: "house" }));
        return h("span", { class: "bldg", title: tn("houses", houses) }, arr);
    }

    function tileLink(idx) {
        const b = S.view.board;
        return h(
            "button",
            {
                type: "button",
                class: "link",
                "data-k": "tl:" + idx,
                title: t("showOnBoard"),
                onclick: () => post({ type: "focus", gameId: S.view.state.gameId, tile: idx }),
            },
            b.tiles[idx].name
        );
    }

    function rentPreview(t) {
        const b = S.view.board;
        if (t.kind === "property") {
            const labels = ["rent.base", "rent.h1", "rent.h2", "rent.h3", "rent.h4", "rent.hotel"].map((k) => L.t(k));
            return h(
                "div",
                { class: "rents" },
                t.rent.map((r, i) => h("div", { class: "rent" }, h("span", {}, labels[i]), h("b", {}, formatMoney(b, r)))),
                h("div", { class: "rent" }, h("span", {}, L.t("houseCost")), h("b", {}, formatMoney(b, t.houseCost)))
            );
        }
        if (t.kind === "railroad")
            return h("div", { class: "hint" }, L.t("railroadRent", { list: [25, 50, 100, 200].map((n) => formatMoney(b, n)).join(" / ") }));
        if (t.kind === "utility") return h("div", { class: "hint" }, L.t("utilityRent"));
        return null;
    }
    function tileCard(idx) {
        const b = S.view.board;
        const t = b.tiles[idx];
        return h(
            "div",
            { class: "deed" },
            h("div", { class: "deed-bar", style: "background:" + tileColor(b, t) }, h("span", {}, tileGroupName(b, t))),
            h(
                "div",
                { class: "deed-body" },
                h(
                    "div",
                    { class: "deed-head" },
                    h("div", {}, h("div", { class: "deed-name" }, t.name), t.subtitle ? h("div", { class: "hint" }, t.subtitle) : null),
                    t.price != null ? h("div", { class: "deed-price" }, formatMoney(b, t.price)) : null
                ),
                rentPreview(t)
            )
        );
    }

    // ------------------------------------------------------------- screens
    function loading(text) {
        return h("div", { class: "empty" }, text);
    }

    function homeScreen() {
        const rows = S.games.map((g) =>
            h(
                "div",
                { class: "card row game-row" },
                h(
                    "div",
                    { class: "grow" },
                    h("div", { class: "title" }, g.boardName),
                    h("div", { class: "hint" }, phaseLabel(g.phase) + " - " + (g.playerNames.length ? g.playerNames.join(", ") : t("noPlayersYet")))
                ),
                btn(t("open"), { key: "open:" + g.gameId, nav: true, onClick: () => post({ type: "select-game", gameId: g.gameId }) })
            )
        );
        return h(
            "div",
            { class: "screen" },
            h("div", { class: "hero" }, h("h1", {}, t("heroTitle")), h("p", {}, t("heroSub"))),
            h("div", { class: "section-title" }, t("gamesOnBoard")),
            rows.length ? rows : h("div", { class: "card empty" }, t("noGames")),
            btn(t("newGame"), {
                cls: "primary",
                key: "new-game",
                nav: true,
                onClick: () => {
                    ui.newGame = true;
                    ui.newBoard = ui.newBoard || (S.boards[0] && S.boards[0].id);
                    ui.newSettings = Object.assign({}, S.defaults);
                    ui.newLang = L.lang;
                    render();
                },
            })
        );
    }
    function phaseLabel(k) {
        if (k === "lobby") return t("phase.lobby");
        if (k === "game-over") return t("phase.over");
        return t("phase.play");
    }

    function newGameScreen() {
        const cards = S.boards.map((b) =>
            h(
                "button",
                {
                    type: "button",
                    class: "theme-card" + (ui.newBoard === b.id ? " sel" : ""),
                    "aria-pressed": ui.newBoard === b.id ? "true" : "false",
                    "data-k": "theme:" + b.id,
                    onclick: () => {
                        ui.newBoard = b.id;
                        render();
                    },
                },
                svgBox(b.previewSvg, "preview"),
                h("span", { class: "tname" }, b.name),
                h("span", { class: "hint" }, b.tagline)
            )
        );
        const selBoard = S.boards.find((b) => b.id === ui.newBoard);
        return h(
            "div",
            { class: "screen" },
            h("div", { class: "topbar" }, btn("\u2190 " + t("back"), { cls: "ghost", nav: true, key: "back", onClick: () => { ui.newGame = false; render(); } }), h("div", { class: "title grow" }, t("newGame"))),
            h("div", { class: "section-title" }, t("theme")),
            h("div", { class: "themes" }, cards),
            h(
                "div",
                { class: "card" },
                field(
                    t("gameLang"),
                    h(
                        "select",
                        { "data-k": "s:gameLang", onchange: (e) => { ui.newLang = e.target.value; render(); } },
                        L.LANGS.map((l) => h("option", { value: l, selected: (ui.newLang || L.lang) === l }, L.NAMES[l]))
                    ),
                    t("gameLangHint")
                )
            ),
            h("div", { class: "section-title" }, t("houseRules")),
            h("div", { class: "card" }, settingsForm(ui.newSettings, true, (k, v) => { ui.newSettings[k] = v; render(); }, selBoard)),
            btn(t("createGame"), {
                cls: "primary",
                key: "create",
                nav: true,
                enabled: !!selBoard,
                onClick: () => post({ type: "create-game", boardId: ui.newBoard, settings: Object.assign({}, ui.newSettings), lang: ui.newLang || L.lang }),
            })
        );
    }

    function settingsForm(vals, editable, onSet, summary) {
        const sym = summary ? summary.currencySymbol : S.view ? S.view.board.currency.symbol : "";
        const checks = [
            ["doubleSalaryOnGo", t("set.doubleSalary")],
            ["freeParkingJackpot", t("set.jackpot")],
            ["auctionOnDecline", t("set.auction")],
            ["evenBuild", t("set.even")],
            ["rentInJail", t("set.rentJail")],
        ];
        return h(
            "div",
            { class: "settings" },
            h(
                "div",
                { class: "two" },
                field(t("startingCash"), numInput("startingCash", vals.startingCash, (v) => v !== "" && onSet("startingCash", v), { min: 0, step: 100, disabled: !editable }), sym ? t("baseUnits", { sym }) : null),
                field(t("goSalary"), numInput("salary", vals.salary, (v) => v !== "" && onSet("salary", v), { min: 0, step: 50, disabled: !editable }))
            ),
            checks.map(([k, label]) =>
                h(
                    "label",
                    { class: "check" },
                    h("input", { type: "checkbox", "data-k": "c:" + k, checked: !!vals[k], disabled: !editable, onchange: (e) => onSet(k, e.target.checked) }),
                    h("span", {}, label)
                )
            ),
            field(
                t("gameLength"),
                h(
                    "select",
                    { "data-k": "s:roundLimit", disabled: !editable, onchange: (e) => onSet("roundLimit", Number(e.target.value)) },
                    [0, 10, 20, 30].map((n) => h("option", { value: String(n), selected: vals.roundLimit === n }, n === 0 ? t("unlimited") : t("roundsRichest", { n })))
                )
            )
        );
    }

    // ---- lobby
    function lobbyScreen() {
        const v = S.view;
        const st = v.state;
        const board = v.board;
        const mine = v.mySeats;
        // Token names in the game's language (the board), art from the picker summaries.
        const summary = S.boards.find((b) => b.id === board.id);
        const tokens = board.tokens.map((tk) => {
            const sm = summary && summary.tokens.find((x) => x.id === tk.id);
            return { id: tk.id, name: tk.name, svg: (sm && sm.svg) || (v.tokenSvgs && v.tokenSvgs[tk.id]) || "" };
        });

        const takenColors = new Set(st.players.map((p) => p.color.toLowerCase()));
        const takenTokens = new Set(st.players.map((p) => p.token));
        const j = ui.join;
        if (!j.init) {
            j.init = true;
            j.name = mine.length ? "" : (S.me && S.me.name) || "";
        }
        if (!j.color || takenColors.has(j.color.toLowerCase())) j.color = COLORS.find((c) => !takenColors.has(c)) || "";
        if (!j.token || takenTokens.has(j.token)) {
            const t = tokens.find((x) => !takenTokens.has(x.id));
            j.token = t ? t.id : "";
        }
        const showForm = mine.length === 0 || j.open;

        const players = st.players.map((p) => {
            const own = isMine(p.seat);
            const sv = seatView(p.seat);
            const canLeave = own && (!sv || sv.legal.length === 0 || sv.legal.includes("leave"));
            return h(
                "div",
                { class: "prow" },
                chip(p, "md"),
                h("div", { class: "grow" }, h("span", { class: "pname" }, p.name), own ? h("span", { class: "me" }, " " + (mine.length > 1 ? t("thisDevice") : t("you"))) : null, p.userId === st.creatorUserId ? h("span", { class: "badge" }, t("host")) : null),
                own ? btn(t("leave"), { cls: "small ghost", key: "leave:" + p.seat, enabled: canLeave, onClick: () => act({ type: "leave", seat: p.seat }) }) : null
            );
        });
        for (let i = st.players.length; i < 2; i++) players.push(h("div", { class: "prow empty-seat" }, h("span", { class: "chip md" }), h("span", { class: "hint" }, t("waitingPlayer"))));

        const form = showForm
            ? h(
                  "div",
                  { class: "card join" },
                  h("div", { class: "title" }, mine.length ? t("addAnother") : t("joinGame")),
                  field(t("name"), h("input", { type: "text", maxlength: "20", "data-k": "t:name", value: j.name, placeholder: t("yourName"), oninput: (e) => { j.name = e.target.value; render(); } })),
                  h("div", { class: "flabel" }, t("color")),
                  h(
                      "div",
                      { class: "swatches", role: "radiogroup", "aria-label": t("color") },
                      COLORS.map((c, i) =>
                          h("button", {
                              type: "button",
                              role: "radio",
                              class: "sw" + (j.color === c ? " sel" : ""),
                              style: "background:" + c,
                              "aria-checked": j.color === c ? "true" : "false",
                              "aria-label": takenColors.has(c) ? t("taken", { name: t("color." + COLOR_KEYS[i]) }) : t("color." + COLOR_KEYS[i]),
                              title: t("color." + COLOR_KEYS[i]),
                              "data-k": "sw:" + c,
                              disabled: takenColors.has(c),
                              onclick: () => { j.color = c; render(); },
                          })
                      )
                  ),
                  h("div", { class: "flabel" }, t("token")),
                  h(
                      "div",
                      { class: "tokens", role: "radiogroup", "aria-label": t("token") },
                      tokens.map((tk) =>
                          h(
                              "button",
                              {
                                  type: "button",
                                  role: "radio",
                                  class: "tok" + (j.token === tk.id ? " sel" : ""),
                                  style: "--pc:" + safeColor(j.color, "var(--ac)"),
                                  "aria-checked": j.token === tk.id ? "true" : "false",
                                  "aria-label": takenTokens.has(tk.id) ? t("taken", { name: tk.name }) : tk.name,
                                  title: tk.name,
                                  "data-k": "tok:" + tk.id,
                                  disabled: takenTokens.has(tk.id),
                                  onclick: () => { j.token = tk.id; render(); },
                              },
                              svgBox(tk.svg),
                              h("span", {}, tk.name)
                          )
                      )
                  ),
                  h(
                      "div",
                      { class: "row end" },
                      mine.length ? btn(t("cancel"), { cls: "ghost", nav: true, key: "join-cancel", onClick: () => { j.open = false; render(); } }) : null,
                      btn(t("join"), {
                          cls: "primary inline",
                          key: "join",
                          enabled: !!(j.name.trim() && j.color && j.token),
                          onClick: () => {
                              act({ type: "join", userId: "", name: j.name.trim(), color: j.color, token: j.token });
                              ui.join = freshJoin();
                          },
                      })
                  )
              )
            : btn(t("addAnother"), { cls: "wide", key: "hotseat", onClick: () => { j.open = true; j.init = true; j.name = ""; render(); } });

        return h(
            "div",
            { class: "screen" },
            gameHeader(),
            h("div", { class: "section-title" }, t("playersN", { n: st.players.length })),
            h("div", { class: "card plist" }, players),
            form,
            h("div", { class: "section-title" }, v.isCreator ? t("houseRulesHost") : t("houseRules")),
            h("div", { class: "card" }, settingsForm(st.settings, v.isCreator, (k, val) => act({ type: "update-settings", settings: { [k]: val } }))),
            v.isCreator
                ? [
                      btn(t("startGame"), { cls: "primary", key: "start", enabled: st.players.length >= 2, onClick: () => act({ type: "start" }) }),
                      st.players.length < 2 ? h("div", { class: "hint center" }, t("need2")) : null,
                  ]
                : h("div", { class: "hint center" }, t("waitHost")),
            moreMenu(null)
        );
    }

    // ---- game
    function gameHeader() {
        const v = S.view;
        const st = v.state;
        const board = v.board;
        const ph = st.phase;
        let banner;
        if (ph.kind === "lobby") banner = h("span", { class: "ptag" }, t("lobby"));
        else if (ph.kind === "game-over") banner = h("span", { class: "ptag" }, t("gameOver"));
        else {
            const p = player(st.current);
            banner = h("span", { class: "ptag" }, dot(p.color), h("span", {}, tx("turnOf", { name: h("b", {}, p.name) })));
        }
        const limit = st.settings.roundLimit;
        return h(
            "div",
            { class: "ghead" },
            h(
                "div",
                { class: "topbar" },
                btn("\u2190", { cls: "ghost icon", nav: true, key: "back", title: t("allGames"), aria: t("backToGames"), onClick: () => post({ type: "select-game", gameId: null }) }),
                h("div", { class: "grow" }, h("div", { class: "title" }, board.name), ph.kind !== "lobby" ? h("div", { class: "hint" }, limit ? t("roundOf", { n: st.round + 1, m: limit }) : t("round", { n: st.round + 1 })) : h("div", { class: "hint" }, board.tagline)),
                v.pending ? h("span", { class: "spinner", role: "status", "aria-label": t("working") }) : null,
                btn(t("focusBoard"), { cls: "small", nav: true, key: "focus", onClick: () => post({ type: "focus", gameId: st.gameId }) })
            ),
            ph.kind !== "lobby"
                ? h(
                      "div",
                      { class: "turnbar" },
                      h("div", { class: "turn", role: "status", "aria-live": "polite" }, banner),
                      rolling
                          ? h("div", { class: "dice rolling", "aria-label": t("rolling") }, dieFace(randomDie()), dieFace(randomDie()), h("span", { class: "dsum" }, "?"))
                          : st.dice
                            ? h("div", { class: "dice", title: t("lastRoll", { n: st.dice[0] + st.dice[1] }) }, dieFace(st.dice[0]), dieFace(st.dice[1]), h("span", { class: "dsum" }, st.dice[0] + st.dice[1]))
                            : null
                  )
                : null
        );
    }

    function seatSwitcher() {
        const v = S.view;
        if (v.mySeats.length < 2) return null;
        const cur = actingSeat();
        return h(
            "div",
            { class: "seats", role: "tablist", "aria-label": t("actingAs") },
            v.mySeats.map((s) => {
                const p = player(s);
                return h(
                    "button",
                    {
                        type: "button",
                        role: "tab",
                        class: "seatchip" + (cur === s ? " sel" : ""),
                        style: "--pc:" + safeColor(p.color),
                        "aria-selected": cur === s ? "true" : "false",
                        "data-k": "seat:" + s,
                        onclick: () => { ui.seat = s; render(); },
                    },
                    chip(p, "xs"),
                    p.name
                );
            })
        );
    }

    function actingCard(acting) {
        const st = S.view.state;
        if (acting == null) return h("div", { class: "card hint center" }, t("watching"));
        const p = player(acting);
        const jc = p.jailCards.chance + p.jailCards.chest;
        const nw = netWorthOf(acting);
        return h(
            "div",
            { class: "card acting", "data-seat": acting, style: "--pc:" + safeColor(p.color) },
            h("div", { class: "row" }, chip(p, "lg"), h("div", { class: "grow" }, h("div", { class: "ahint" }, t("actingAs")), h("div", { class: "title" }, p.name, p.inJail ? h("span", { class: "badge bad" }, t("inJail")) : null, p.bankrupt ? h("span", { class: "badge bad" }, t("bankrupt")) : null)), h("div", { class: "cash", title: t("cash"), "data-cash": acting }, cashText(acting, p.cash))),
            h("div", { class: "stats" }, h("span", {}, t("netWorth") + " ", h("b", {}, nw == null ? "-" : fmt(nw))), h("span", {}, t("jailCards", { jail: S.view.board.labels.jail }) + " ", h("b", {}, jc)), h("span", {}, t("properties") + " ", h("b", {}, ownedTiles(acting).length)))
        );
    }

    function waitingCard(seat, extra) {
        const v = S.view;
        const p = player(seat);
        const absent = v.presentUserIds.length > 0 && !v.presentUserIds.includes(p.userId);
        return h(
            "div",
            { class: "card waiting", style: "--pc:" + safeColor(p.color) },
            h("div", { class: "row" }, chip(p, "md"), h("div", { class: "grow" }, h("div", { class: "title" }, t("waitingFor", { name: p.name })), absent ? h("div", { class: "hint warn" }, t("looksAway", { name: p.name })) : extra ? h("div", { class: "hint" }, extra) : null)),
            v.isCreator && absent ? btn(t("skipTurn", { name: p.name }), { cls: "small warnbtn", key: "skip-now", onClick: () => act({ type: "force-skip", seat }) }) : null
        );
    }

    function actionArea(acting) {
        const v = S.view;
        const st = v.state;
        const ph = st.phase;
        const legal = legalOf(acting);
        const p = acting != null ? player(acting) : null;
        const waitFor = waitingSeat();

        if (ph.kind === "game-over") return gameOver();

        if (ph.kind === "pre-roll") {
            if (acting != null && (legal.has("roll") || legal.has("pay-jail-fine") || legal.has("use-jail-card"))) {
                return h(
                    "div",
                    { class: "card act" },
                    p.inJail ? h("div", { class: "title" }, t("youAreIn", { jail: v.board.labels.jail }), h("span", { class: "hint" }, "  " + t("attempt", { n: p.jailTurns + 1 }))) : h("div", { class: "title" }, t("yourTurn")),
                    primary(p.inJail ? t("rollDoubles") : t("rollDice"), { type: "roll", seat: acting }, legal.has("roll")),
                    p.inJail
                        ? h(
                              "div",
                              { class: "row two-btn" },
                              btn(t("payFine", { amt: fmt(st.settings.jailFine) }), { key: "fine", enabled: legal.has("pay-jail-fine"), onClick: () => act({ type: "pay-jail-fine", seat: acting }) }),
                              btn(t("useCard"), { key: "jcard", enabled: legal.has("use-jail-card"), onClick: () => act({ type: "use-jail-card", seat: acting }) })
                          )
                        : null
                );
            }
            return waitingCard(waitFor);
        }

        if (ph.kind === "buy-decision") {
            const tile = v.board.tiles[ph.tile];
            const mine = acting != null && (legal.has("buy") || legal.has("decline"));
            return h(
                "div",
                { class: "stack" },
                tileCard(ph.tile),
                mine
                    ? h(
                          "div",
                          { class: "card act" },
                          h("div", { class: "title" }, t("buyQ", { tile: tile.name })),
                          primary(t("buyFor", { amt: fmt(tile.price) }), { type: "buy", seat: acting }, legal.has("buy")),
                          btn(st.settings.auctionOnDecline ? t("auctionDecline") : t("decline"), { cls: "wide", key: "decline", enabled: legal.has("decline"), onClick: () => act({ type: "decline", seat: acting }) })
                      )
                    : waitingCard(waitFor, t("decidingBuy", { tile: tile.name }))
            );
        }

        if (ph.kind === "auction") return auctionCard(acting, legal);

        if (ph.kind === "debt") {
            const d = ph.debt;
            const debtor = player(d.debtor);
            const to = d.creditor == null ? t("theBank") : player(d.creditor).name;
            const mine = acting != null && (legal.has("pay-debt") || legal.has("declare-bankruptcy"));
            const owes = h("div", { class: "debt" }, h("span", {}, t("owes", { debtor: debtor.name, to })), h("b", { class: "owed" }, fmt(d.amount)), h("span", { class: "hint" }, t("cashAmt", { amt: fmt(debtor.cash) })));
            if (!mine) return h("div", { class: "stack" }, h("div", { class: "card" }, owes), waitingCard(d.debtor, t("raisingCash")));
            return h(
                "div",
                { class: "card act" },
                owes,
                primary(t("payAmt", { amt: fmt(d.amount) }), { type: "pay-debt", seat: acting }, legal.has("pay-debt")),
                h("div", { class: "hint" }, t("notEnough")),
                ui.confirm === "bankrupt"
                    ? h("div", { class: "confirm" }, h("b", {}, t("reallyGiveUp")), h("div", { class: "row" }, btn(t("yesBankrupt"), { cls: "danger small", key: "bk-yes", enabled: legal.has("declare-bankruptcy"), onClick: () => { ui.confirm = null; act({ type: "declare-bankruptcy", seat: acting }); } }), btn(t("cancel"), { cls: "small ghost", nav: true, key: "bk-no", onClick: () => { ui.confirm = null; render(); } })))
                    : btn(t("declareBankruptcy"), { cls: "danger-outline wide", key: "bk", enabled: legal.has("declare-bankruptcy"), onClick: () => { ui.confirm = "bankrupt"; render(); } })
            );
        }

        if (ph.kind === "post-roll") {
            if (acting != null && (legal.has("roll") || legal.has("end-turn"))) {
                return h(
                    "div",
                    { class: "card act" },
                    ph.rollAgain ? primary(t("rollAgain"), { type: "roll", seat: acting }, legal.has("roll"), t("doublesSub")) : primary(t("endTurn"), { type: "end-turn", seat: acting }, legal.has("end-turn")),
                    ph.rollAgain && legal.has("end-turn") ? null : null
                );
            }
            return waitingCard(waitFor);
        }
        return null;
    }

    function auctionCard(acting, legal) {
        const v = S.view;
        const st = v.state;
        const a = st.phase.auction;
        const tile = v.board.tiles[a.tile];
        const turnSeat = a.bidders[a.turn];
        const tp = player(turnSeat);
        const high = a.highBidder != null ? player(a.highBidder) : null;
        const canBid = acting != null && legal.has("bid");
        const cash = acting != null ? player(acting).cash : 0;
        const quick = [1, 10, 50, 100].map((inc) => {
            const amt = Math.min(a.highBid + inc, cash);
            return btn("+" + inc, {
                cls: "small quick",
                key: "q" + inc,
                title: t("bidAmt", { amt: fmt(amt) }),
                enabled: canBid && amt > a.highBid,
                onClick: () => act({ type: "bid", seat: acting, amount: amt }),
            });
        });
        const custom = Number(ui.bid);
        return h(
            "div",
            { class: "stack" },
            tileCard(a.tile),
            h(
                "div",
                { class: "card act", style: "--pc:" + safeColor(tp.color) },
                h("div", { class: "title" }, t("auctionTitle", { tile: tile.name })),
                h("div", { class: "debt" }, h("span", {}, high ? tx("highBidBy", { name: nameTag(high) }) : t("noBids")), h("b", { class: "owed" }, a.highBid ? fmt(a.highBid) : "-")),
                h("div", { class: "hint" }, canBid ? t("yourBid") : tx("waitBid", { name: nameTag(tp) })),
                h("div", { class: "quickrow" }, quick),
                h(
                    "div",
                    { class: "row" },
                    numInput("bid", ui.bid, (val) => { ui.bid = val === "" ? "" : String(val); }, { min: 0, placeholder: t("customBid"), disabled: !canBid, live: (val) => { ui.bid = val; render(); } }),
                    btn(t("bid"), { cls: "small", key: "bid", enabled: canBid && custom > a.highBid && custom <= cash, onClick: () => { act({ type: "bid", seat: acting, amount: custom }); ui.bid = ""; } }),
                    btn(t("pass"), { cls: "small ghost", key: "pass", enabled: acting != null && legal.has("pass-bid"), onClick: () => act({ type: "pass-bid", seat: acting }) })
                ),
                acting != null ? h("div", { class: "hint" }, t("yourCash", { amt: fmt(cash) })) : null
            )
        );
    }

    function gameOver() {
        const v = S.view;
        const st = v.state;
        const ph = st.phase;
        const w = ph.winner != null ? player(ph.winner) : null;
        const reasons = { "last-standing": t("reason.last"), "round-limit": t("reason.limit"), ended: t("reason.ended") };
        const order = st.players
            .map((p) => ({ p, nw: netWorthOf(p.seat) }))
            .sort((a, b) => (b.nw == null ? -Infinity : b.nw) - (a.nw == null ? -Infinity : a.nw));
        return h(
            "div",
            { class: "stack" },
            h("div", { class: "card winner", style: w ? "--pc:" + safeColor(w.color) : "" }, w ? chip(w, "lg") : null, h("div", { class: "wtitle" }, w ? t("wins", { name: w.name }) : t("noWinner")), h("div", { class: "hint" }, reasons[ph.reason] || "")),
            h(
                "div",
                { class: "card plist" },
                h("div", { class: "section-title tight" }, t("finalStandings")),
                order.map((o, i) =>
                    h("div", { class: "prow" }, h("span", { class: "rank" }, i + 1), chip(o.p, "md"), h("div", { class: "grow" }, h("span", { class: "pname" }, o.p.name), o.p.bankrupt ? h("span", { class: "badge bad" }, t("bankrupt")) : null), h("b", {}, o.nw == null ? "-" : fmt(o.nw)))
                )
            )
        );
    }

    function moreMenu(acting) {
        const v = S.view;
        const st = v.state;
        const ph = st.phase;
        if (!v.isCreator) return null;
        const inPlay = ph.kind !== "lobby" && ph.kind !== "game-over";
        const ws = waitingSeat();
        const items = [];
        if (inPlay) {
            const p = player(ws);
            items.push(btn(t("skipTurn", { name: p.name }), { cls: "small", key: "skip", onClick: () => act({ type: "force-skip", seat: ws }) }));
            items.push(
                ui.confirm === "end"
                    ? h("span", { class: "confirm inline" }, t("endGameQ") + " ", btn(t("yes"), { cls: "small danger", key: "end-yes", onClick: () => { ui.confirm = null; act({ type: "end-game" }); } }), btn(t("no"), { cls: "small ghost", nav: true, key: "end-no", onClick: () => { ui.confirm = null; render(); } }))
                    : btn(t("endGame"), { cls: "small", key: "end", onClick: () => { ui.confirm = "end"; render(); } })
            );
        }
        items.push(
            ui.confirm === "delete"
                ? h("span", { class: "confirm inline" }, t("deleteQ") + " ", btn(t("yes"), { cls: "small danger", nav: true, key: "del-yes", onClick: () => { ui.confirm = null; post({ type: "delete-game", gameId: st.gameId }); } }), btn(t("no"), { cls: "small ghost", nav: true, key: "del-no", onClick: () => { ui.confirm = null; render(); } }))
                : btn(t("deleteGame"), { cls: "small danger-outline", nav: true, key: "del", onClick: () => { ui.confirm = "delete"; render(); } })
        );
        return h(
            "details",
            { class: "more", open: ui.more, ontoggle: (e) => { ui.more = e.target.open; } },
            h("summary", { "data-k": "more" }, t("more")),
            h("div", { class: "morebody" }, h("div", { class: "hint" }, t("hostTools")), h("div", { class: "row wrap" }, items))
        );
    }

    function gameScreen() {
        const v = S.view;
        const st = v.state;
        if (st.phase.kind === "lobby") return lobbyScreen();
        const acting = actingSeat();
        const incoming = st.pendingTrade && isMine(st.pendingTrade.to) ? st.pendingTrade : null;
        return h(
            "div",
            { class: "screen" },
            gameHeader(),
            seatSwitcher(),
            actingCard(acting),
            actionArea(acting),
            incoming && ui.tab !== "trade" ? h("button", { type: "button", class: "alert", "data-k": "trade-alert", onclick: () => { ui.tab = "trade"; render(); } }, tx("tradeOffer", { name: h("b", {}, player(incoming.from).name) }), " ", h("u", {}, t("review"))) : null,
            tabs(acting),
            moreMenu(acting)
        );
    }

    // ---- tabs
    const TABS = ["assets", "players", "trade", "log", "rules"];
    function tabs(acting) {
        const st = S.view.state;
        const incoming = st.pendingTrade && isMine(st.pendingTrade.to);
        const body = { assets: assetsTab, players: playersTab, trade: tradeTab, log: logTab, rules: rulesTab }[ui.tab](acting);
        return h(
            "div",
            { class: "tabs" },
            h(
                "div",
                { class: "tablist", role: "tablist" },
                TABS.map((id) =>
                    h("button", { type: "button", role: "tab", class: "tab" + (ui.tab === id ? " sel" : ""), "aria-selected": ui.tab === id ? "true" : "false", "data-k": "tab:" + id, "data-tab": id, onclick: () => { if (ui.tab !== id) fx(".tabbody", [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" }); ui.tab = id; render(); } }, t("tab." + id), id === "trade" && (incoming || st.pendingTrade) ? h("i", { class: "ping" }) : null)
                )
            ),
            h("div", { class: "tabbody", role: "tabpanel" }, body)
        );
    }

    function assetsTab(acting) {
        const v = S.view;
        const board = v.board;
        if (acting == null) return h("div", { class: "hint center" }, t("joinToOwn"));
        const own = v.state.ownership;
        const sv = seatView(acting) || { buildable: [], sellable: [], mortgageable: [], unmortgageable: [] };
        const tiles = ownedTiles(acting);
        if (!tiles.length) return h("div", { class: "hint center" }, t("noProps"));
        const groups = new Map();
        for (const i of tiles) {
            const t = board.tiles[i];
            const key = t.kind === "property" ? t.group : t.kind;
            if (!groups.has(key)) groups.set(key, { color: tileColor(board, t), name: tileGroupName(board, t), tiles: [], total: board.tiles.filter((x) => (x.kind === "property" ? x.group : x.kind) === key).length });
            groups.get(key).tiles.push(i);
        }
        const out = [];
        for (const g of groups.values()) {
            out.push(
                h(
                    "div",
                    { class: "agroup" },
                    h("div", { class: "ghd" }, h("span", { class: "gsw", style: "background:" + g.color }), h("span", { class: "grow" }, g.name), h("span", { class: "hint" }, g.tiles.length + "/" + g.total)),
                    g.tiles.map((i) => {
                        const tile = board.tiles[i];
                        const o = own[String(i)];
                        const btns = [];
                        if (sv.buildable.includes(i) && tile.kind === "property")
                            btns.push(btn(t("buildAmt", { amt: formatMoney(board, tile.houseCost) }), { cls: "tiny", key: "build:" + i, title: t("buildA", { kind: o.houses >= 4 ? board.labels.hotel : board.labels.house }), onClick: () => act({ type: "build", seat: acting, tile: i }) }));
                        if (sv.sellable.includes(i)) btns.push(btn(tile.kind === "property" ? t("sellAmt", { amt: formatMoney(board, Math.floor(tile.houseCost / 2)) }) : t("sell"), { cls: "tiny", key: "sell:" + i, onClick: () => act({ type: "sell-building", seat: acting, tile: i }) }));
                        if (sv.mortgageable.includes(i)) btns.push(btn(t("mortgageAmt", { amt: formatMoney(board, Math.floor(tile.price / 2)) }), { cls: "tiny", key: "mort:" + i, onClick: () => act({ type: "mortgage", seat: acting, tile: i }) }));
                        if (sv.unmortgageable.includes(i)) btns.push(btn(t("unmortgageAmt", { amt: formatMoney(board, Math.ceil(tile.price * 0.55)) }), { cls: "tiny", key: "unmort:" + i, onClick: () => act({ type: "unmortgage", seat: acting, tile: i }) }));
                        return h(
                            "div",
                            { class: "arow" + (o.mortgaged ? " mort" : "") },
                            h("div", { class: "ainfo" }, tileLink(i), houseIcons(o.houses), o.mortgaged ? h("span", { class: "badge" }, t("mortgaged")) : null),
                            btns.length ? h("div", { class: "abtns" }, btns) : null
                        );
                    })
                )
            );
        }
        return out;
    }

    function playersTab(acting) {
        const v = S.view;
        const st = v.state;
        const alive = (s) => !player(s).bankrupt;
        const canTrade = acting != null && legalOf(acting).has("propose-trade");
        return st.players.map((p) => {
            const nw = netWorthOf(p.seat);
            const here = v.presentUserIds.length ? v.presentUserIds.includes(p.userId) : null;
            const jc = p.jailCards.chance + p.jailCards.chest;
            return h(
                "div",
                { class: "pcard" + (p.bankrupt ? " out" : "") + (st.current === p.seat && st.phase.kind !== "lobby" && st.phase.kind !== "game-over" ? " turn" : ""), "data-seat": p.seat, style: "--pc:" + safeColor(p.color) },
                chip(p, "md"),
                h(
                    "div",
                    { class: "grow" },
                    h("div", { class: "pn" }, here == null ? null : h("i", { class: "pres " + (here ? "on" : "off"), title: here ? t("here") : t("away") }), h("span", { class: "pname" }, p.name), isMine(p.seat) ? h("span", { class: "me" }, " " + t("you")) : null, p.inJail ? h("span", { class: "badge bad" }, t("jail")) : null, p.bankrupt ? h("span", { class: "badge bad" }, t("bankrupt")) : null, jc ? h("span", { class: "badge" }, tn("cards", jc)) : null),
                    h("div", { class: "pstats" }, h("span", {}, t("cash") + " ", h("b", { "data-cash": p.seat }, cashText(p.seat, p.cash))), h("span", {}, t("propsShort") + " ", h("b", {}, ownedTiles(p.seat).length)), h("span", {}, t("worth") + " ", h("b", {}, nw == null ? "-" : fmt(nw))))
                ),
                acting != null && p.seat !== acting && !isMine(p.seat) && alive(p.seat) ? btn(t("trade"), { cls: "small", key: "trade:" + p.seat, enabled: canTrade, onClick: () => { ui.trade.to = p.seat; ui.tab = "trade"; render(); } }) : null
            );
        });
    }

    function offerSummary(offer) {
        const b = S.view.board;
        const parts = [];
        offer.tiles.forEach((i) => parts.push(b.tiles[i].name));
        if (offer.cash) parts.push(fmt(offer.cash));
        if (offer.jailCards) parts.push(tn("jailCardsN", offer.jailCards, { jail: b.labels.jail }));
        return parts.length ? parts.join(", ") : t("nothing");
    }
    function pendingTradeCard(tr) {
        const from = player(tr.from);
        const to = player(tr.to);
        const toLegal = legalOf(tr.to);
        const fromLegal = legalOf(tr.from);
        const buttons = [];
        if (isMine(tr.to)) {
            buttons.push(btn(t("accept"), { cls: "small primary-lite", key: "tr-acc", enabled: toLegal.has("accept-trade"), onClick: () => act({ type: "accept-trade", seat: tr.to, tradeId: tr.id }) }));
            buttons.push(btn(t("reject"), { cls: "small", key: "tr-rej", enabled: toLegal.has("reject-trade"), onClick: () => act({ type: "reject-trade", seat: tr.to, tradeId: tr.id }) }));
        }
        if (isMine(tr.from)) buttons.push(btn(t("cancelOffer"), { cls: "small", key: "tr-can", enabled: fromLegal.has("cancel-trade"), onClick: () => act({ type: "cancel-trade", seat: tr.from, tradeId: tr.id }) }));
        return h(
            "div",
            { class: "card trade-pending" },
            h("div", { class: "title" }, nameTag(from), " \u2192 ", nameTag(to)),
            h("div", { class: "tline" }, h("span", { class: "tl" }, t("gives")), h("span", {}, offerSummary(tr.give))),
            h("div", { class: "tline" }, h("span", { class: "tl" }, t("gets")), h("span", {}, offerSummary(tr.get))),
            buttons.length ? h("div", { class: "row" }, buttons) : h("div", { class: "hint" }, t("waitingResponse"))
        );
    }

    function tradeTab(acting) {
        const v = S.view;
        const st = v.state;
        const out = [];
        if (st.pendingTrade) out.push(pendingTradeCard(st.pendingTrade));
        if (acting == null) return out.concat(h("div", { class: "hint center" }, t("joinToTrade")));
        if (ui.tradeSeat !== acting) {
            ui.tradeSeat = acting;
            ui.trade = freshTrade();
        }
        const tr = ui.trade;
        const partners = st.players.filter((p) => p.seat !== acting && !p.bankrupt && !isMine(p.seat));
        if (tr.to != null && !partners.some((p) => p.seat === tr.to)) tr.to = null;
        const legal = legalOf(acting);
        const me = player(acting);
        const col = (side, seat, title, state) => {
            const p = player(seat);
            const tiles = ownedTiles(seat);
            const maxJ = p.jailCards.chance + p.jailCards.chest;
            return h(
                "div",
                { class: "tcol" },
                h("div", { class: "tct" }, title),
                h(
                    "div",
                    { class: "tlist" },
                    tiles.length
                        ? tiles.map((i) => {
                              const tile = v.board.tiles[i];
                              const o = st.ownership[String(i)];
                              return h(
                                  "label",
                                  { class: "tcheck" },
                                  h("input", { type: "checkbox", "data-k": "tt:" + side + i, checked: state.tiles.includes(i), onchange: (e) => { state.tiles = e.target.checked ? state.tiles.concat(i) : state.tiles.filter((x) => x !== i); render(); } }),
                                  h("span", { class: "gsw", style: "background:" + tileColor(v.board, tile) }),
                                  h("span", { class: "tn" }, tile.name),
                                  houseIcons(o.houses),
                                  o.mortgaged ? h("span", { class: "badge", title: t("mortgaged") }, t("mortgagedShort")) : null
                              );
                          })
                        : h("div", { class: "hint" }, t("noPropsShort"))
                ),
                field(t("cash"), numInput("cash:" + side, state.cash, (val) => { state.cash = val; render(); }, { min: 0, step: 10, placeholder: "0" })),
                h(
                    "div",
                    { class: "jstep" },
                    h("span", { class: "flabel" }, t("jailCards", { jail: v.board.labels.jail })),
                    h("span", { class: "stepper" }, btn("\u2212", { cls: "tiny", nav: true, key: "j-" + side, enabled: state.jail > 0, aria: t("fewerCards"), onClick: () => { state.jail--; render(); } }), h("b", {}, state.jail), btn("+", { cls: "tiny", nav: true, key: "j+" + side, enabled: state.jail < maxJ, aria: t("moreCards"), onClick: () => { state.jail++; render(); } }))
                )
            );
        };
        const empty = (o) => !o.tiles.length && !Number(o.cash) && !o.jail;
        out.push(
            h(
                "div",
                { class: "card composer" },
                h("div", { class: "title" }, t("proposeTitle")),
                field(t("tradeWith"), h("select", { "data-k": "s:partner", onchange: (e) => { tr.to = e.target.value === "" ? null : Number(e.target.value); tr.get = freshTrade().get; render(); } }, h("option", { value: "", selected: tr.to == null }, t("choosePlayer")), partners.map((p) => h("option", { value: String(p.seat), selected: tr.to === p.seat }, p.name)))),
                tr.to != null
                    ? [
                          h("div", { class: "tcols" }, col("give", acting, t("youGive"), tr.give), col("get", tr.to, t("youGet"), tr.get)),
                          btn(t("proposeTrade"), {
                              cls: "primary",
                              key: "propose",
                              enabled: legal.has("propose-trade") && !(empty(tr.give) && empty(tr.get)),
                              onClick: () => {
                                  const mk = (o) => ({ cash: Number(o.cash) || 0, tiles: o.tiles.slice(), jailCards: o.jail });
                                  act({ type: "propose-trade", seat: acting, to: tr.to, give: mk(tr.give), get: mk(tr.get) });
                                  const keep = tr.to;
                                  ui.trade = freshTrade();
                                  ui.trade.to = keep;
                              },
                          }),
                      ]
                    : h("div", { class: "hint" }, t("pickHint"))
            )
        );
        return out;
    }

    function logTab() {
        const st = S.view.state;
        const icons = { info: "i", good: "+", bad: "!", card: "\u2605", dice: "\u2684" };
        const entries = st.log.slice().sort((a, b) => b.id - a.id);
        if (!entries.length) return h("div", { class: "hint center" }, t("nothingYet"));
        return entries.map((e) => {
            const p = e.seat != null ? st.players[e.seat] : null;
            return h("div", { class: "lrow tone-" + e.tone, "data-log": e.id, style: "--pc:" + safeColor(p && p.color, "var(--tx3)") }, h("span", { class: "ticon", "aria-hidden": "true" }, icons[e.tone] || "i"), h("span", { class: "ltext" }, e.text));
        });
    }

    function rulesTab() {
        const v = S.view;
        const b = v.board;
        const s = v.state.settings;
        const onOff = (x) => (x ? t("on") : t("off"));
        const rules = [
            [t("startingCash"), fmt(s.startingCash)],
            [t("goSalary"), s.doubleSalaryOnGo ? t("doubleOnGo", { amt: fmt(s.salary) }) : fmt(s.salary)],
            [t("jailFine"), fmt(s.jailFine)],
            [t("jackpotRule"), onOff(s.freeParkingJackpot)],
            [t("auctionRule"), onOff(s.auctionOnDecline)],
            [t("evenRule"), onOff(s.evenBuild)],
            [t("rentJailRule"), s.rentInJail ? t("collected") : t("notCollected")],
            [t("gameLength"), s.roundLimit ? t("roundsRichest", { n: s.roundLimit }) : t("untilOne")],
            [t("bankBuildings"), t("bankStock", { h: v.state.housesLeft, house: b.labels.house, k: v.state.hotelsLeft, hotel: b.labels.hotel })],
        ];
        const rows = [];
        v.board.tiles.forEach((tile, i) => {
            if (tile.kind === "property" || tile.kind === "railroad" || tile.kind === "utility") rows.push([tile, i]);
        });
        return [
            h("div", { class: "section-title tight" }, t("howToPlay")),
            h(
                "ol",
                { class: "howto" },
                h("li", {}, t("how1", { jail: b.labels.jail })),
                h("li", {}, t("how2")),
                h("li", {}, t("how3", { house: b.labels.house })),
                h("li", {}, t("how4")),
                h("li", {}, t("how5"))
            ),
            h("div", { class: "section-title tight" }, t("rulesInEffect")),
            h("dl", { class: "kv" }, rules.map(([k, val]) => [h("dt", {}, k), h("dd", {}, val)])),
            h("div", { class: "section-title tight" }, t("pricesRents")),
            rows.map(([tile, i]) =>
                h(
                    "div",
                    { class: "prc" },
                    h("div", { class: "prc-h" }, h("span", { class: "gsw", style: "background:" + tileColor(b, tile) }), tileLink(i), h("b", {}, formatMoney(b, tile.price))),
                    tile.kind === "property"
                        ? h("div", { class: "prc-g" }, tile.rent.map((r, k) => h("span", {}, h("i", {}, [t("rent.base"), "1", "2", "3", "4", t("rent.hotel")][k]), formatMoney(b, r))), h("span", {}, h("i", {}, t("build")), formatMoney(b, tile.houseCost)))
                        : tile.kind === "railroad"
                        ? h("div", { class: "hint" }, t("rrShort", { list: [25, 50, 100, 200].map((n) => formatMoney(b, n)).join(" / ") }))
                        : h("div", { class: "hint" }, t("utilShort"))
                )
            ),
        ];
    }

    // -------------------------------------------------------------- render
    const rootEl = document.getElementById("root");
    const toastEl = document.getElementById("toasts");

    function render() {
        const ae = document.activeElement;
        let fk = null;
        let ss = null;
        let se = null;
        if (ae && ae.dataset && ae.dataset.k) {
            fk = ae.dataset.k;
            try {
                ss = ae.selectionStart;
                se = ae.selectionEnd;
            } catch (e) {
                ss = null;
            }
        }
        const sc = document.scrollingElement ? document.scrollingElement.scrollTop : 0;
        ui.primary = null;

        let screen;
        if (!S.me) screen = loading(t("loading"));
        else if (S.selected && S.view) screen = gameScreen();
        else if (S.selected) screen = h("div", { class: "screen" }, btn("\u2190 " + t("back"), { cls: "ghost", nav: true, key: "back", onClick: () => post({ type: "select-game", gameId: null }) }), loading(t("loadingGame")));
        else if (ui.newGame) screen = newGameScreen();
        else screen = homeScreen();

        const kids = [langBar()];
        if (S.error)
            kids.push(h("div", { class: "errbar", role: "alert" }, h("span", { class: "grow" }, S.error), h("button", { type: "button", class: "x", "aria-label": t("dismiss"), onclick: () => clearError() }, "\u00d7")));
        kids.push(screen);
        rootEl.replaceChildren(...kids);
        replayFx();

        if (document.scrollingElement) document.scrollingElement.scrollTop = sc;
        if (fk) {
            const el = rootEl.querySelector('[data-k="' + fk.replace(/["\\]/g, "\\$&") + '"]');
            if (el) {
                el.focus({ preventScroll: true });
                if (ss != null) {
                    try {
                        el.setSelectionRange(ss, se);
                    } catch (e) {
                        /* not a text field */
                    }
                }
            }
        }
    }

    // Speaker glyphs for the sound toggle, 16×16, drawn in currentColor.
    const SPEAKER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/>';
    const SOUND_ON = SPEAKER + '<path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9"/></svg>';
    const SOUND_OFF = SPEAKER + '<path d="M11 6l4 4M15 6l-4 4"/></svg>';

    /** The panel's own language (each user's choice, separate from the game's) and sound toggle. */
    function langBar() {
        return h(
            "div",
            { class: "langbar" },
            sfx.supported
                ? h(
                      "button",
                      {
                          type: "button",
                          class: "soundbtn",
                          "data-k": "s:sound",
                          "aria-pressed": sfx.on ? "true" : "false",
                          "aria-label": t("sound"),
                          title: sfx.on ? t("soundOn") : t("soundOff"),
                          onclick: () => {
                              sfx.setOn(!sfx.on);
                              render();
                          },
                      },
                      svgBox(sfx.on ? SOUND_ON : SOUND_OFF)
                  )
                : null,
            h(
                "select",
                { class: "langsel", "data-k": "s:uiLang", "aria-label": t("language"), title: t("language"), onchange: (e) => setUiLang(e.target.value) },
                L.LANGS.map((l) => h("option", { value: l, selected: L.lang === l }, L.SHORT[l]))
            )
        );
    }
    function setUiLang(l) {
        if (!L.setLang(l)) return;
        document.documentElement.lang = L.lang;
        post({ type: "lang", lang: L.lang });
        render();
    }

    function showError(msg) {
        S.error = msg;
        clearTimeout(S.errTimer);
        S.errTimer = setTimeout(clearError, 5000);
        render();
    }
    function clearError() {
        S.error = null;
        clearTimeout(S.errTimer);
        render();
    }

    // Toasts are kept as live elements (not re-rendered) so each one springs in
    // once and slides out before it is removed.
    const TOAST_IN = {
        info: [{ opacity: 0, transform: "translateY(16px) scale(.85)" }, { opacity: 1, transform: "none" }],
        good: [{ opacity: 0, transform: "translateY(18px) scale(.7)" }, { offset: 0.6, opacity: 1, transform: "translateY(-3px) scale(1.06)" }, { transform: "none" }],
        bad: [{ opacity: 0, transform: "translateY(12px)" }, { offset: 0.35, opacity: 1, transform: "translateX(-7px)" }, { offset: 0.55, transform: "translateX(6px)" }, { offset: 0.75, transform: "translateX(-3px)" }, { transform: "none" }],
        card: [{ opacity: 0, transform: "translateY(14px) rotate(-6deg) scale(.8)" }, { offset: 0.45, opacity: 1, transform: "rotate(4deg) scale(1.05)" }, { offset: 0.7, transform: "rotate(-2deg)" }, { transform: "none" }],
    };
    function addToast(t) {
        t.el = h("div", { class: "toast tone-" + t.tone, style: "--pc:" + t.color }, t.text);
        toastEl.appendChild(t.el);
        if (!reduced) t.el.animate(TOAST_IN[t.tone] || TOAST_IN.info, { duration: t.tone === "bad" ? 520 : 480, easing: t.tone === "bad" ? "ease-out" : SPRING });
    }
    function dropToast(t) {
        S.toasts = S.toasts.filter((x) => x !== t);
        const el = t.el;
        if (!el || el.__out) return;
        el.__out = true;
        if (reduced) return el.remove();
        el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(48px) scale(.9)" }], { duration: 280, easing: "ease-in", fill: "forwards" }).onfinish = () => el.remove();
        setTimeout(() => el.remove(), 500);
    }
    function pushToasts(view) {
        const st = view.state;
        const last = S.lastLog[st.gameId];
        const maxId = st.log.reduce((m, e) => Math.max(m, e.id), -1);
        if (last == null) {
            S.lastLog[st.gameId] = maxId;
            return;
        }
        const fresh = st.log.filter((e) => e.id > last).sort((a, b) => a.id - b.id).slice(-3);
        S.lastLog[st.gameId] = Math.max(last, maxId);
        for (const e of fresh) {
            const p = e.seat != null ? st.players[e.seat] : null;
            const t = { id: e.id, text: e.text, tone: e.tone, color: safeColor(p && p.color, "#888888") };
            S.toasts.push(t);
            addToast(t);
            if (S.toasts.length > 3) dropToast(S.toasts[0]);
            setTimeout(() => dropToast(t), 4500);
        }
    }

    // ------------------------------------------------------------ messages
    function applyTheme(tokens, mode) {
        const root = document.documentElement;
        for (const k of Object.keys(tokens || {})) root.style.setProperty(k.startsWith("--") ? k : "--" + k, tokens[k]);
        root.setAttribute("data-theme", mode === "dark" ? "dark" : "light");
    }

    api.onMessage((msg) => {
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
            case "init":
                S.me = msg.me;
                S.boards = msg.boards || [];
                S.defaults = msg.defaultSettings;
                applyTheme(msg.themeTokens, msg.themeMode);
                break;
            case "theme":
                applyTheme(msg.themeTokens, msg.themeMode);
                break;
            case "boards":
                S.boards = msg.boards || [];
                break;
            case "games":
                S.games = msg.games || [];
                if (S.selected !== msg.selected) {
                    ui.join = freshJoin();
                    ui.trade = freshTrade();
                    ui.tradeSeat = null;
                    ui.confirm = null;
                    ui.seat = null;
                    ui.lastActive = undefined;
                    if (msg.selected) ui.newGame = false;
                    if (!msg.selected) S.view = null;
                }
                S.selected = msg.selected;
                break;
            case "view": {
                const prev = S.view;
                S.view = msg.view;
                if (!msg.view || (prev && prev.state.gameId !== msg.view.state.gameId)) stopRolling();
                if (msg.view) {
                    const v = msg.view;
                    if (v.activeSeat !== ui.lastActive) {
                        ui.lastActive = v.activeSeat;
                        if (v.activeSeat != null) ui.seat = v.activeSeat;
                    }
                    if (v.state.phase.kind !== ui.lastPhase) {
                        ui.lastPhase = v.state.phase.kind;
                        ui.confirm = null;
                    }
                    pushToasts(v);
                    viewFx(prev, v);
                    viewSfx(prev, v);
                }
                break;
            }
            case "error":
                stopRolling();
                sfx.play("error");
                showError(String(msg.message));
                return;
        }
        render();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "summary" || tag === "a" || (t && t.isContentEditable)) return;
        if (ui.primary) {
            e.preventDefault();
            ui.primary();
        }
    });

    document.documentElement.lang = L.lang;
    render();
    post({ type: "ready", lang: L.lang });
})();

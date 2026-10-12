// Board Tycoon control panel. Plain DOM, no framework, no external resources.
// Renders entirely from the latest driver messages (see src/ui/messages.ts).
// It never computes rules: buttons are enabled from SeatView.legal and friends.
(function () {
    "use strict";

    const api = acquireDrawdyApi();

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
    const COLOR_NAMES = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Teal", "Pink"];

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
        return h(
            "button",
            {
                type: "button",
                class: "btn " + (o.cls || ""),
                disabled,
                "data-k": "b:" + (o.key || (typeof label === "string" ? label : "")),
                title: o.title,
                "aria-label": o["aria"],
                onclick: o.onClick,
            },
            label
        );
    }
    function primary(label, action, enabled, sub) {
        const run = () => act(action);
        if (enabled !== false && !(S.view && S.view.pending) && !ui.primary) ui.primary = run;
        return btn([label, sub ? h("small", {}, sub) : null], { cls: "primary", onClick: run, enabled, key: "primary" });
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
        return h("span", { class: "die", role: "img", "aria-label": "die showing " + n }, cells);
    }

    function houseIcons(houses) {
        if (!houses) return null;
        if (houses >= 5) return h("span", { class: "bldg", title: "hotel" }, h("i", { class: "hotel" }));
        const arr = [];
        for (let i = 0; i < houses; i++) arr.push(h("i", { class: "house" }));
        return h("span", { class: "bldg", title: houses + " house" + (houses > 1 ? "s" : "") }, arr);
    }

    function tileLink(idx) {
        const b = S.view.board;
        return h(
            "button",
            {
                type: "button",
                class: "link",
                "data-k": "tl:" + idx,
                title: "Show on board",
                onclick: () => post({ type: "focus", gameId: S.view.state.gameId, tile: idx }),
            },
            b.tiles[idx].name
        );
    }

    function rentPreview(t) {
        const b = S.view.board;
        if (t.kind === "property") {
            const labels = ["Rent", "1 house", "2 houses", "3 houses", "4 houses", "Hotel"];
            return h(
                "div",
                { class: "rents" },
                t.rent.map((r, i) => h("div", { class: "rent" }, h("span", {}, labels[i]), h("b", {}, formatMoney(b, r)))),
                h("div", { class: "rent" }, h("span", {}, "House cost"), h("b", {}, formatMoney(b, t.houseCost)))
            );
        }
        if (t.kind === "railroad")
            return h("div", { class: "hint" }, "Rent " + [25, 50, 100, 200].map((n) => formatMoney(b, n)).join(" / ") + " with 1-4 owned");
        if (t.kind === "utility") return h("div", { class: "hint" }, "Rent 4x dice with one owned, 10x with both");
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
                    h("div", { class: "hint" }, phaseLabel(g.phase) + (g.playerNames.length ? " - " + g.playerNames.join(", ") : " - no players yet"))
                ),
                btn("Open", { key: "open:" + g.gameId, nav: true, onClick: () => post({ type: "select-game", gameId: g.gameId }) })
            )
        );
        return h(
            "div",
            { class: "screen" },
            h("div", { class: "hero" }, h("h1", {}, "Board Tycoon"), h("p", {}, "Buy, build and trade your way to the top. 2-6 players, on this board.")),
            h("div", { class: "section-title" }, "Games on this board"),
            rows.length ? rows : h("div", { class: "card empty" }, "No games yet. Start one!"),
            btn("New game", {
                cls: "primary",
                key: "new-game",
                nav: true,
                onClick: () => {
                    ui.newGame = true;
                    ui.newBoard = ui.newBoard || (S.boards[0] && S.boards[0].id);
                    ui.newSettings = Object.assign({}, S.defaults);
                    render();
                },
            })
        );
    }
    function phaseLabel(k) {
        return { lobby: "Lobby", "pre-roll": "In play", "buy-decision": "In play", auction: "In play", debt: "In play", "post-roll": "In play", "game-over": "Game over" }[k] || k;
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
            h("div", { class: "topbar" }, btn("\u2190 Back", { cls: "ghost", nav: true, key: "back", onClick: () => { ui.newGame = false; render(); } }), h("div", { class: "title grow" }, "New game")),
            h("div", { class: "section-title" }, "Theme"),
            h("div", { class: "themes" }, cards),
            h("div", { class: "section-title" }, "House rules"),
            h("div", { class: "card" }, settingsForm(ui.newSettings, true, (k, v) => { ui.newSettings[k] = v; render(); }, selBoard)),
            btn("Create game", {
                cls: "primary",
                key: "create",
                nav: true,
                enabled: !!selBoard,
                onClick: () => post({ type: "create-game", boardId: ui.newBoard, settings: Object.assign({}, ui.newSettings) }),
            })
        );
    }

    function settingsForm(vals, editable, onSet, summary) {
        const sym = summary ? summary.currencySymbol : S.view ? S.view.board.currency.symbol : "";
        const checks = [
            ["doubleSalaryOnGo", "Double salary when landing on GO"],
            ["freeParkingJackpot", "Taxes and fines go to Free Parking jackpot"],
            ["auctionOnDecline", "Auction when a player declines to buy"],
            ["evenBuild", "Build evenly across a color group"],
            ["rentInJail", "Collect rent while in jail"],
        ];
        return h(
            "div",
            { class: "settings" },
            h(
                "div",
                { class: "two" },
                field("Starting cash", numInput("startingCash", vals.startingCash, (v) => v !== "" && onSet("startingCash", v), { min: 0, step: 100, disabled: !editable }), sym ? "base units (" + sym + ")" : null),
                field("GO salary", numInput("salary", vals.salary, (v) => v !== "" && onSet("salary", v), { min: 0, step: 50, disabled: !editable }))
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
                "Game length",
                h(
                    "select",
                    { "data-k": "s:roundLimit", disabled: !editable, onchange: (e) => onSet("roundLimit", Number(e.target.value)) },
                    [0, 10, 20, 30].map((n) => h("option", { value: String(n), selected: vals.roundLimit === n }, n === 0 ? "Unlimited" : n + " rounds, richest wins"))
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
        const summary = S.boards.find((b) => b.id === board.id);
        const tokens = summary
            ? summary.tokens
            : board.tokens.map((t) => ({ id: t.id, name: t.name, svg: (v.tokenSvgs && v.tokenSvgs[t.id]) || "" }));

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
                h("div", { class: "grow" }, h("span", { class: "pname" }, p.name), own ? h("span", { class: "me" }, mine.length > 1 ? " (this device)" : " (you)") : null, p.userId === st.creatorUserId ? h("span", { class: "badge" }, "host") : null),
                own ? btn("Leave", { cls: "small ghost", key: "leave:" + p.seat, enabled: canLeave, onClick: () => act({ type: "leave", seat: p.seat }) }) : null
            );
        });
        for (let i = st.players.length; i < 2; i++) players.push(h("div", { class: "prow empty-seat" }, h("span", { class: "chip md" }), h("span", { class: "hint" }, "Waiting for a player...")));

        const form = showForm
            ? h(
                  "div",
                  { class: "card join" },
                  h("div", { class: "title" }, mine.length ? "Add another player on this device" : "Join the game"),
                  field("Name", h("input", { type: "text", maxlength: "20", "data-k": "t:name", value: j.name, placeholder: "Your name", oninput: (e) => { j.name = e.target.value; render(); } })),
                  h("div", { class: "flabel" }, "Color"),
                  h(
                      "div",
                      { class: "swatches", role: "radiogroup", "aria-label": "Color" },
                      COLORS.map((c, i) =>
                          h("button", {
                              type: "button",
                              role: "radio",
                              class: "sw" + (j.color === c ? " sel" : ""),
                              style: "background:" + c,
                              "aria-checked": j.color === c ? "true" : "false",
                              "aria-label": COLOR_NAMES[i] + (takenColors.has(c) ? " (taken)" : ""),
                              title: COLOR_NAMES[i],
                              "data-k": "sw:" + c,
                              disabled: takenColors.has(c),
                              onclick: () => { j.color = c; render(); },
                          })
                      )
                  ),
                  h("div", { class: "flabel" }, "Token"),
                  h(
                      "div",
                      { class: "tokens", role: "radiogroup", "aria-label": "Token" },
                      tokens.map((t) =>
                          h(
                              "button",
                              {
                                  type: "button",
                                  role: "radio",
                                  class: "tok" + (j.token === t.id ? " sel" : ""),
                                  style: "--pc:" + safeColor(j.color, "var(--ac)"),
                                  "aria-checked": j.token === t.id ? "true" : "false",
                                  "aria-label": t.name + (takenTokens.has(t.id) ? " (taken)" : ""),
                                  title: t.name,
                                  "data-k": "tok:" + t.id,
                                  disabled: takenTokens.has(t.id),
                                  onclick: () => { j.token = t.id; render(); },
                              },
                              svgBox(t.svg),
                              h("span", {}, t.name)
                          )
                      )
                  ),
                  h(
                      "div",
                      { class: "row end" },
                      mine.length ? btn("Cancel", { cls: "ghost", nav: true, key: "join-cancel", onClick: () => { j.open = false; render(); } }) : null,
                      btn("Join", {
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
            : btn("Add another player on this device", { cls: "wide", key: "hotseat", onClick: () => { j.open = true; j.init = true; j.name = ""; render(); } });

        return h(
            "div",
            { class: "screen" },
            gameHeader(),
            h("div", { class: "section-title" }, "Players (" + st.players.length + ")"),
            h("div", { class: "card plist" }, players),
            form,
            h("div", { class: "section-title" }, v.isCreator ? "House rules (host)" : "House rules"),
            h("div", { class: "card" }, settingsForm(st.settings, v.isCreator, (k, val) => act({ type: "update-settings", settings: { [k]: val } }))),
            v.isCreator
                ? [
                      btn("Start game", { cls: "primary", key: "start", enabled: st.players.length >= 2, onClick: () => act({ type: "start" }) }),
                      st.players.length < 2 ? h("div", { class: "hint center" }, "Need at least 2 players to start.") : null,
                  ]
                : h("div", { class: "hint center" }, "Waiting for the host to start the game."),
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
        if (ph.kind === "lobby") banner = h("span", { class: "ptag" }, "Lobby");
        else if (ph.kind === "game-over") banner = h("span", { class: "ptag" }, "Game over");
        else {
            const p = player(st.current);
            banner = h("span", { class: "ptag" }, dot(p.color), h("span", {}, h("b", {}, p.name), "'s turn"));
        }
        const limit = st.settings.roundLimit;
        return h(
            "div",
            { class: "ghead" },
            h(
                "div",
                { class: "topbar" },
                btn("\u2190", { cls: "ghost icon", nav: true, key: "back", title: "All games", aria: "Back to games", onClick: () => post({ type: "select-game", gameId: null }) }),
                h("div", { class: "grow" }, h("div", { class: "title" }, board.name), ph.kind !== "lobby" ? h("div", { class: "hint" }, "Round " + (st.round + 1) + (limit ? " of " + limit : "")) : h("div", { class: "hint" }, board.tagline)),
                v.pending ? h("span", { class: "spinner", role: "status", "aria-label": "Working" }) : null,
                btn("Focus board", { cls: "small", nav: true, key: "focus", onClick: () => post({ type: "focus", gameId: st.gameId }) })
            ),
            ph.kind !== "lobby"
                ? h(
                      "div",
                      { class: "turnbar" },
                      h("div", { class: "turn", role: "status", "aria-live": "polite" }, banner),
                      st.dice ? h("div", { class: "dice", title: "Last roll: " + (st.dice[0] + st.dice[1]) }, dieFace(st.dice[0]), dieFace(st.dice[1]), h("span", { class: "dsum" }, st.dice[0] + st.dice[1])) : null
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
            { class: "seats", role: "tablist", "aria-label": "Acting as" },
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
        if (acting == null) return h("div", { class: "card hint center" }, "You are watching this game.");
        const p = player(acting);
        const jc = p.jailCards.chance + p.jailCards.chest;
        const nw = netWorthOf(acting);
        return h(
            "div",
            { class: "card acting", style: "--pc:" + safeColor(p.color) },
            h("div", { class: "row" }, chip(p, "lg"), h("div", { class: "grow" }, h("div", { class: "ahint" }, "Acting as"), h("div", { class: "title" }, p.name, p.inJail ? h("span", { class: "badge bad" }, "In jail") : null, p.bankrupt ? h("span", { class: "badge bad" }, "Bankrupt") : null)), h("div", { class: "cash", title: "Cash" }, fmt(p.cash))),
            h("div", { class: "stats" }, h("span", {}, "Net worth ", h("b", {}, nw == null ? "-" : fmt(nw))), h("span", {}, S.view.board.labels.jail + " cards ", h("b", {}, jc)), h("span", {}, "Properties ", h("b", {}, ownedTiles(acting).length)))
        );
    }

    function waitingCard(seat, extra) {
        const v = S.view;
        const p = player(seat);
        const absent = v.presentUserIds.length > 0 && !v.presentUserIds.includes(p.userId);
        return h(
            "div",
            { class: "card waiting", style: "--pc:" + safeColor(p.color) },
            h("div", { class: "row" }, chip(p, "md"), h("div", { class: "grow" }, h("div", { class: "title" }, "Waiting for ", p.name, "..."), absent ? h("div", { class: "hint warn" }, p.name + " looks away from the board.") : extra ? h("div", { class: "hint" }, extra) : null)),
            v.isCreator && absent ? btn("Skip " + p.name + "'s turn", { cls: "small warnbtn", key: "skip-now", onClick: () => act({ type: "force-skip", seat }) }) : null
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
                    p.inJail ? h("div", { class: "title" }, "You are in ", v.board.labels.jail, h("span", { class: "hint" }, "  (attempt " + (p.jailTurns + 1) + " of 3)")) : h("div", { class: "title" }, "Your turn"),
                    primary(p.inJail ? "Roll for doubles" : "Roll dice", { type: "roll", seat: acting }, legal.has("roll")),
                    p.inJail
                        ? h(
                              "div",
                              { class: "row two-btn" },
                              btn("Pay fine " + fmt(st.settings.jailFine), { key: "fine", enabled: legal.has("pay-jail-fine"), onClick: () => act({ type: "pay-jail-fine", seat: acting }) }),
                              btn("Use card", { key: "jcard", enabled: legal.has("use-jail-card"), onClick: () => act({ type: "use-jail-card", seat: acting }) })
                          )
                        : null
                );
            }
            return waitingCard(waitFor);
        }

        if (ph.kind === "buy-decision") {
            const t = v.board.tiles[ph.tile];
            const mine = acting != null && (legal.has("buy") || legal.has("decline"));
            return h(
                "div",
                { class: "stack" },
                tileCard(ph.tile),
                mine
                    ? h(
                          "div",
                          { class: "card act" },
                          h("div", { class: "title" }, "Buy ", t.name, "?"),
                          primary("Buy " + fmt(t.price), { type: "buy", seat: acting }, legal.has("buy")),
                          btn(st.settings.auctionOnDecline ? "Auction it (decline)" : "Decline", { cls: "wide", key: "decline", enabled: legal.has("decline"), onClick: () => act({ type: "decline", seat: acting }) })
                      )
                    : waitingCard(waitFor, "is deciding whether to buy " + t.name)
            );
        }

        if (ph.kind === "auction") return auctionCard(acting, legal);

        if (ph.kind === "debt") {
            const d = ph.debt;
            const debtor = player(d.debtor);
            const to = d.creditor == null ? "the bank" : player(d.creditor).name;
            const mine = acting != null && (legal.has("pay-debt") || legal.has("declare-bankruptcy"));
            const owes = h("div", { class: "debt" }, h("span", {}, debtor.name, " owes ", to), h("b", { class: "owed" }, fmt(d.amount)), h("span", { class: "hint" }, "Cash: " + fmt(debtor.cash)));
            if (!mine) return h("div", { class: "stack" }, h("div", { class: "card" }, owes), waitingCard(d.debtor, "is raising cash"));
            return h(
                "div",
                { class: "card act" },
                owes,
                primary("Pay " + fmt(d.amount), { type: "pay-debt", seat: acting }, legal.has("pay-debt")),
                h("div", { class: "hint" }, "Not enough cash? Sell buildings or mortgage properties in Assets, or trade."),
                ui.confirm === "bankrupt"
                    ? h("div", { class: "confirm" }, h("b", {}, "Really give up everything?"), h("div", { class: "row" }, btn("Yes, bankrupt", { cls: "danger small", key: "bk-yes", enabled: legal.has("declare-bankruptcy"), onClick: () => { ui.confirm = null; act({ type: "declare-bankruptcy", seat: acting }); } }), btn("Cancel", { cls: "small ghost", nav: true, key: "bk-no", onClick: () => { ui.confirm = null; render(); } })))
                    : btn("Declare bankruptcy", { cls: "danger-outline wide", key: "bk", enabled: legal.has("declare-bankruptcy"), onClick: () => { ui.confirm = "bankrupt"; render(); } })
            );
        }

        if (ph.kind === "post-roll") {
            if (acting != null && (legal.has("roll") || legal.has("end-turn"))) {
                return h(
                    "div",
                    { class: "card act" },
                    ph.rollAgain ? primary("Roll again", { type: "roll", seat: acting }, legal.has("roll"), "doubles!") : primary("End turn", { type: "end-turn", seat: acting }, legal.has("end-turn")),
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
        const t = v.board.tiles[a.tile];
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
                title: "Bid " + fmt(amt),
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
                h("div", { class: "title" }, "Auction: ", t.name),
                h("div", { class: "debt" }, h("span", {}, high ? ["High bid by ", nameTag(high)] : "No bids yet"), h("b", { class: "owed" }, a.highBid ? fmt(a.highBid) : "-")),
                h("div", { class: "hint" }, canBid ? "Your turn to bid." : ["Waiting for ", nameTag(tp), " to bid or pass."]),
                h("div", { class: "quickrow" }, quick),
                h(
                    "div",
                    { class: "row" },
                    numInput("bid", ui.bid, (val) => { ui.bid = val === "" ? "" : String(val); }, { min: 0, placeholder: "Custom bid", disabled: !canBid, live: (val) => { ui.bid = val; render(); } }),
                    btn("Bid", { cls: "small", key: "bid", enabled: canBid && custom > a.highBid && custom <= cash, onClick: () => { act({ type: "bid", seat: acting, amount: custom }); ui.bid = ""; } }),
                    btn("Pass", { cls: "small ghost", key: "pass", enabled: acting != null && legal.has("pass-bid"), onClick: () => act({ type: "pass-bid", seat: acting }) })
                ),
                acting != null ? h("div", { class: "hint" }, "Your cash: " + fmt(cash)) : null
            )
        );
    }

    function gameOver() {
        const v = S.view;
        const st = v.state;
        const ph = st.phase;
        const w = ph.winner != null ? player(ph.winner) : null;
        const reasons = { "last-standing": "Last player standing", "round-limit": "Round limit reached, highest net worth wins", ended: "Ended by the host" };
        const order = st.players
            .map((p) => ({ p, nw: netWorthOf(p.seat) }))
            .sort((a, b) => (b.nw == null ? -Infinity : b.nw) - (a.nw == null ? -Infinity : a.nw));
        return h(
            "div",
            { class: "stack" },
            h("div", { class: "card winner", style: w ? "--pc:" + safeColor(w.color) : "" }, w ? chip(w, "lg") : null, h("div", { class: "wtitle" }, w ? w.name + " wins!" : "No winner"), h("div", { class: "hint" }, reasons[ph.reason] || "")),
            h(
                "div",
                { class: "card plist" },
                h("div", { class: "section-title tight" }, "Final standings"),
                order.map((o, i) =>
                    h("div", { class: "prow" }, h("span", { class: "rank" }, i + 1), chip(o.p, "md"), h("div", { class: "grow" }, h("span", { class: "pname" }, o.p.name), o.p.bankrupt ? h("span", { class: "badge bad" }, "Bankrupt") : null), h("b", {}, o.nw == null ? "-" : fmt(o.nw)))
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
            items.push(btn("Skip " + p.name + "'s turn", { cls: "small", key: "skip", onClick: () => act({ type: "force-skip", seat: ws }) }));
            items.push(
                ui.confirm === "end"
                    ? h("span", { class: "confirm inline" }, "End game now? ", btn("Yes", { cls: "small danger", key: "end-yes", onClick: () => { ui.confirm = null; act({ type: "end-game" }); } }), btn("No", { cls: "small ghost", nav: true, key: "end-no", onClick: () => { ui.confirm = null; render(); } }))
                    : btn("End game now", { cls: "small", key: "end", onClick: () => { ui.confirm = "end"; render(); } })
            );
        }
        items.push(
            ui.confirm === "delete"
                ? h("span", { class: "confirm inline" }, "Delete from the board? ", btn("Yes", { cls: "small danger", nav: true, key: "del-yes", onClick: () => { ui.confirm = null; post({ type: "delete-game", gameId: st.gameId }); } }), btn("No", { cls: "small ghost", nav: true, key: "del-no", onClick: () => { ui.confirm = null; render(); } }))
                : btn("Delete game", { cls: "small danger-outline", nav: true, key: "del", onClick: () => { ui.confirm = "delete"; render(); } })
        );
        return h(
            "details",
            { class: "more", open: ui.more, ontoggle: (e) => { ui.more = e.target.open; } },
            h("summary", { "data-k": "more" }, "More"),
            h("div", { class: "morebody" }, h("div", { class: "hint" }, "Host tools"), h("div", { class: "row wrap" }, items))
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
            incoming && ui.tab !== "trade" ? h("button", { type: "button", class: "alert", "data-k": "trade-alert", onclick: () => { ui.tab = "trade"; render(); } }, h("b", {}, player(incoming.from).name), " sent you a trade offer. ", h("u", {}, "Review")) : null,
            tabs(acting),
            moreMenu(acting)
        );
    }

    // ---- tabs
    const TABS = [
        ["assets", "Assets"],
        ["players", "Players"],
        ["trade", "Trade"],
        ["log", "Log"],
        ["rules", "Rules"],
    ];
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
                TABS.map(([id, label]) =>
                    h("button", { type: "button", role: "tab", class: "tab" + (ui.tab === id ? " sel" : ""), "aria-selected": ui.tab === id ? "true" : "false", "data-k": "tab:" + id, "data-tab": id, onclick: () => { ui.tab = id; render(); } }, label, id === "trade" && (incoming || st.pendingTrade) ? h("i", { class: "ping" }) : null)
                )
            ),
            h("div", { class: "tabbody", role: "tabpanel" }, body)
        );
    }

    function assetsTab(acting) {
        const v = S.view;
        const board = v.board;
        if (acting == null) return h("div", { class: "hint center" }, "Join the game to own properties.");
        const own = v.state.ownership;
        const sv = seatView(acting) || { buildable: [], sellable: [], mortgageable: [], unmortgageable: [] };
        const tiles = ownedTiles(acting);
        if (!tiles.length) return h("div", { class: "hint center" }, "No properties yet. Land on one and buy it!");
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
                        const t = board.tiles[i];
                        const o = own[String(i)];
                        const btns = [];
                        if (sv.buildable.includes(i) && t.kind === "property")
                            btns.push(btn("Build " + formatMoney(board, t.houseCost), { cls: "tiny", key: "build:" + i, title: "Build a " + (o.houses >= 4 ? board.labels.hotel : board.labels.house), onClick: () => act({ type: "build", seat: acting, tile: i }) }));
                        if (sv.sellable.includes(i)) btns.push(btn("Sell" + (t.kind === "property" ? " +" + formatMoney(board, Math.floor(t.houseCost / 2)) : ""), { cls: "tiny", key: "sell:" + i, onClick: () => act({ type: "sell-building", seat: acting, tile: i }) }));
                        if (sv.mortgageable.includes(i)) btns.push(btn("Mortgage +" + formatMoney(board, Math.floor(t.price / 2)), { cls: "tiny", key: "mort:" + i, onClick: () => act({ type: "mortgage", seat: acting, tile: i }) }));
                        if (sv.unmortgageable.includes(i)) btns.push(btn("Unmortgage -" + formatMoney(board, Math.ceil(t.price * 0.55)), { cls: "tiny", key: "unmort:" + i, onClick: () => act({ type: "unmortgage", seat: acting, tile: i }) }));
                        return h(
                            "div",
                            { class: "arow" + (o.mortgaged ? " mort" : "") },
                            h("div", { class: "ainfo" }, tileLink(i), houseIcons(o.houses), o.mortgaged ? h("span", { class: "badge" }, "Mortgaged") : null),
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
                { class: "pcard" + (p.bankrupt ? " out" : "") + (st.current === p.seat && st.phase.kind !== "lobby" && st.phase.kind !== "game-over" ? " turn" : ""), style: "--pc:" + safeColor(p.color) },
                chip(p, "md"),
                h(
                    "div",
                    { class: "grow" },
                    h("div", { class: "pn" }, here == null ? null : h("i", { class: "pres " + (here ? "on" : "off"), title: here ? "Here" : "Away" }), h("span", { class: "pname" }, p.name), isMine(p.seat) ? h("span", { class: "me" }, " (you)") : null, p.inJail ? h("span", { class: "badge bad" }, "Jail") : null, p.bankrupt ? h("span", { class: "badge bad" }, "Bankrupt") : null, jc ? h("span", { class: "badge" }, jc + " card" + (jc > 1 ? "s" : "")) : null),
                    h("div", { class: "pstats" }, h("span", {}, "Cash ", h("b", {}, fmt(p.cash))), h("span", {}, "Props ", h("b", {}, ownedTiles(p.seat).length)), h("span", {}, "Worth ", h("b", {}, nw == null ? "-" : fmt(nw))))
                ),
                acting != null && p.seat !== acting && !isMine(p.seat) && alive(p.seat) ? btn("Trade", { cls: "small", key: "trade:" + p.seat, enabled: canTrade, onClick: () => { ui.trade.to = p.seat; ui.tab = "trade"; render(); } }) : null
            );
        });
    }

    function offerSummary(offer) {
        const b = S.view.board;
        const parts = [];
        offer.tiles.forEach((i) => parts.push(b.tiles[i].name));
        if (offer.cash) parts.push(fmt(offer.cash));
        if (offer.jailCards) parts.push(offer.jailCards + " " + b.labels.jail + " card" + (offer.jailCards > 1 ? "s" : ""));
        return parts.length ? parts.join(", ") : "nothing";
    }
    function pendingTradeCard(tr) {
        const from = player(tr.from);
        const to = player(tr.to);
        const toLegal = legalOf(tr.to);
        const fromLegal = legalOf(tr.from);
        const buttons = [];
        if (isMine(tr.to)) {
            buttons.push(btn("Accept", { cls: "small primary-lite", key: "tr-acc", enabled: toLegal.has("accept-trade"), onClick: () => act({ type: "accept-trade", seat: tr.to, tradeId: tr.id }) }));
            buttons.push(btn("Reject", { cls: "small", key: "tr-rej", enabled: toLegal.has("reject-trade"), onClick: () => act({ type: "reject-trade", seat: tr.to, tradeId: tr.id }) }));
        }
        if (isMine(tr.from)) buttons.push(btn("Cancel offer", { cls: "small", key: "tr-can", enabled: fromLegal.has("cancel-trade"), onClick: () => act({ type: "cancel-trade", seat: tr.from, tradeId: tr.id }) }));
        return h(
            "div",
            { class: "card trade-pending" },
            h("div", { class: "title" }, nameTag(from), " \u2192 ", nameTag(to)),
            h("div", { class: "tline" }, h("span", { class: "tl" }, "Gives"), h("span", {}, offerSummary(tr.give))),
            h("div", { class: "tline" }, h("span", { class: "tl" }, "Gets"), h("span", {}, offerSummary(tr.get))),
            buttons.length ? h("div", { class: "row" }, buttons) : h("div", { class: "hint" }, "Waiting for a response.")
        );
    }

    function tradeTab(acting) {
        const v = S.view;
        const st = v.state;
        const out = [];
        if (st.pendingTrade) out.push(pendingTradeCard(st.pendingTrade));
        if (acting == null) return out.concat(h("div", { class: "hint center" }, "Join the game to trade."));
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
                              const t = v.board.tiles[i];
                              const o = st.ownership[String(i)];
                              return h(
                                  "label",
                                  { class: "tcheck" },
                                  h("input", { type: "checkbox", "data-k": "tt:" + side + i, checked: state.tiles.includes(i), onchange: (e) => { state.tiles = e.target.checked ? state.tiles.concat(i) : state.tiles.filter((x) => x !== i); render(); } }),
                                  h("span", { class: "gsw", style: "background:" + tileColor(v.board, t) }),
                                  h("span", { class: "tn" }, t.name),
                                  houseIcons(o.houses),
                                  o.mortgaged ? h("span", { class: "badge" }, "M") : null
                              );
                          })
                        : h("div", { class: "hint" }, "No properties")
                ),
                field("Cash", numInput("cash:" + side, state.cash, (val) => { state.cash = val; render(); }, { min: 0, step: 10, placeholder: "0" })),
                h(
                    "div",
                    { class: "jstep" },
                    h("span", { class: "flabel" }, v.board.labels.jail + " cards"),
                    h("span", { class: "stepper" }, btn("\u2212", { cls: "tiny", nav: true, key: "j-" + side, enabled: state.jail > 0, aria: "Fewer cards", onClick: () => { state.jail--; render(); } }), h("b", {}, state.jail), btn("+", { cls: "tiny", nav: true, key: "j+" + side, enabled: state.jail < maxJ, aria: "More cards", onClick: () => { state.jail++; render(); } }))
                )
            );
        };
        const empty = (o) => !o.tiles.length && !Number(o.cash) && !o.jail;
        out.push(
            h(
                "div",
                { class: "card composer" },
                h("div", { class: "title" }, "Propose a trade"),
                field("Trade with", h("select", { "data-k": "s:partner", onchange: (e) => { tr.to = e.target.value === "" ? null : Number(e.target.value); tr.get = freshTrade().get; render(); } }, h("option", { value: "", selected: tr.to == null }, "Choose a player..."), partners.map((p) => h("option", { value: String(p.seat), selected: tr.to === p.seat }, p.name)))),
                tr.to != null
                    ? [
                          h("div", { class: "tcols" }, col("give", acting, "You give", tr.give), col("get", tr.to, "You get", tr.get)),
                          btn("Propose trade", {
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
                    : h("div", { class: "hint" }, "Pick who to trade with, then choose what each side offers.")
            )
        );
        return out;
    }

    function logTab() {
        const st = S.view.state;
        const icons = { info: "i", good: "+", bad: "!", card: "\u2605", dice: "\u2684" };
        const entries = st.log.slice().sort((a, b) => b.id - a.id);
        if (!entries.length) return h("div", { class: "hint center" }, "Nothing has happened yet.");
        return entries.map((e) => {
            const p = e.seat != null ? st.players[e.seat] : null;
            return h("div", { class: "lrow tone-" + e.tone, style: "--pc:" + safeColor(p && p.color, "var(--tx3)") }, h("span", { class: "ticon", "aria-hidden": "true" }, icons[e.tone] || "i"), h("span", { class: "ltext" }, e.text));
        });
    }

    function rulesTab() {
        const v = S.view;
        const b = v.board;
        const s = v.state.settings;
        const rules = [
            ["Starting cash", fmt(s.startingCash)],
            ["GO salary", fmt(s.salary) + (s.doubleSalaryOnGo ? " (double when landing on GO)" : "")],
            ["Jail fine", fmt(s.jailFine)],
            ["Free Parking jackpot", s.freeParkingJackpot ? "On" : "Off"],
            ["Auction on decline", s.auctionOnDecline ? "On" : "Off"],
            ["Even building", s.evenBuild ? "On" : "Off"],
            ["Rent while in jail", s.rentInJail ? "Collected" : "Not collected"],
            ["Game length", s.roundLimit ? s.roundLimit + " rounds, richest wins" : "Until one player is left"],
            ["Buildings in the bank", v.state.housesLeft + " " + b.labels.house + "s / " + v.state.hotelsLeft + " " + b.labels.hotel + "s"],
        ];
        const rows = [];
        v.board.tiles.forEach((t, i) => {
            if (t.kind === "property" || t.kind === "railroad" || t.kind === "utility") rows.push([t, i]);
        });
        return [
            h("div", { class: "section-title tight" }, "How to play"),
            h(
                "ol",
                { class: "howto" },
                h("li", {}, "On your turn, roll the dice and move. Doubles let you roll again (three in a row sends you to ", b.labels.jail, ")."),
                h("li", {}, "Land on an unowned property to buy it, or it goes to auction."),
                h("li", {}, "Own a whole color group to build ", b.labels.house + "s", " and charge much more rent."),
                h("li", {}, "Short on cash? Mortgage properties, sell buildings, or trade."),
                h("li", {}, "Last player with money standing wins.")
            ),
            h("div", { class: "section-title tight" }, "House rules in effect"),
            h("dl", { class: "kv" }, rules.map(([k, val]) => [h("dt", {}, k), h("dd", {}, val)])),
            h("div", { class: "section-title tight" }, "Prices and rents"),
            rows.map(([t, i]) =>
                h(
                    "div",
                    { class: "prc" },
                    h("div", { class: "prc-h" }, h("span", { class: "gsw", style: "background:" + tileColor(b, t) }), tileLink(i), h("b", {}, formatMoney(b, t.price))),
                    t.kind === "property"
                        ? h("div", { class: "prc-g" }, t.rent.map((r, k) => h("span", {}, h("i", {}, ["Rent", "1", "2", "3", "4", "Hotel"][k]), formatMoney(b, r))), h("span", {}, h("i", {}, "Build"), formatMoney(b, t.houseCost)))
                        : t.kind === "railroad"
                        ? h("div", { class: "hint" }, [25, 50, 100, 200].map((n) => formatMoney(b, n)).join(" / ") + " for 1-4 owned")
                        : h("div", { class: "hint" }, "4x dice (one owned) / 10x dice (both)")
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
        if (!S.me) screen = loading("Loading...");
        else if (S.selected && S.view) screen = gameScreen();
        else if (S.selected) screen = h("div", { class: "screen" }, btn("\u2190 Back", { cls: "ghost", nav: true, key: "back", onClick: () => post({ type: "select-game", gameId: null }) }), loading("Loading game..."));
        else if (ui.newGame) screen = newGameScreen();
        else screen = homeScreen();

        const kids = [];
        if (S.error)
            kids.push(h("div", { class: "errbar", role: "alert" }, h("span", { class: "grow" }, S.error), h("button", { type: "button", class: "x", "aria-label": "Dismiss", onclick: () => clearError() }, "\u00d7")));
        kids.push(screen);
        rootEl.replaceChildren(...kids);

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

    function renderToasts() {
        toastEl.replaceChildren(
            ...S.toasts.map((t) => h("div", { class: "toast tone-" + t.tone, style: "--pc:" + t.color }, t.text))
        );
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
            if (S.toasts.length > 3) S.toasts.shift();
            setTimeout(() => {
                S.toasts = S.toasts.filter((x) => x !== t);
                renderToasts();
            }, 4500);
        }
        if (fresh.length) renderToasts();
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
                S.view = msg.view;
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
                }
                break;
            }
            case "error":
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

    render();
    post({ type: "ready" });
})();

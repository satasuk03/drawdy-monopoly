// Hand-built fixtures for the webview harness. Not shipped.
(function () {
    const groups = [
        { id: "brown", name: "Brown", color: "#955436" },
        { id: "lblue", name: "Light blue", color: "#aae0fa" },
        { id: "pink", name: "Pink", color: "#d93a96" },
        { id: "orange", name: "Orange", color: "#f7941d" },
        { id: "red", name: "Red", color: "#ed1b24" },
        { id: "yellow", name: "Yellow", color: "#fef200" },
        { id: "green", name: "Green", color: "#1fb25a" },
        { id: "dblue", name: "Dark blue", color: "#0072bb" },
    ];
    const tiles = new Array(40).fill(null);
    const set = (i, t) => (tiles[i] = t);
    const prop = (i, name, group, price, hc) => {
        const r = Math.round(price / 10);
        set(i, { kind: "property", name, group, price, houseCost: hc, rent: [r, r * 5, r * 15, r * 45, r * 80, r * 125] });
    };
    set(0, { kind: "go", name: "GO" });
    prop(1, "Mediterranean Ave", "brown", 60, 50); set(2, { kind: "chest", name: "Community Chest" });
    prop(3, "Baltic Ave", "brown", 60, 50); set(4, { kind: "tax", name: "Income Tax", amount: 200 });
    set(5, { kind: "railroad", name: "Reading Railroad", price: 200 });
    prop(6, "Oriental Ave", "lblue", 100, 50); set(7, { kind: "chance", name: "Chance" });
    prop(8, "Vermont Ave", "lblue", 100, 50); prop(9, "Connecticut Ave", "lblue", 120, 50);
    set(10, { kind: "jail", name: "Jail" });
    prop(11, "St. Charles Place", "pink", 140, 100); set(12, { kind: "utility", name: "Electric Company", price: 150 });
    prop(13, "States Ave", "pink", 140, 100); prop(14, "Virginia Ave", "pink", 160, 100);
    set(15, { kind: "railroad", name: "Pennsylvania Railroad", price: 200 });
    prop(16, "St. James Place", "orange", 180, 100); set(17, { kind: "chest", name: "Community Chest" });
    prop(18, "Tennessee Ave", "orange", 180, 100); prop(19, "New York Ave", "orange", 200, 100);
    set(20, { kind: "free-parking", name: "Free Parking" });
    prop(21, "Kentucky Ave", "red", 220, 150); set(22, { kind: "chance", name: "Chance" });
    prop(23, "Indiana Ave", "red", 220, 150); prop(24, "Illinois Ave", "red", 240, 150);
    set(25, { kind: "railroad", name: "B&O Railroad", price: 200 });
    prop(26, "Atlantic Ave", "yellow", 260, 150); prop(27, "Ventnor Ave", "yellow", 260, 150);
    set(28, { kind: "utility", name: "Water Works", price: 150 }); prop(29, "Marvin Gardens", "yellow", 280, 150);
    set(30, { kind: "go-to-jail", name: "Go To Jail" });
    prop(31, "Pacific Ave", "green", 300, 200); prop(32, "North Carolina Ave", "green", 300, 200);
    set(33, { kind: "chest", name: "Community Chest" }); prop(34, "Pennsylvania Ave", "green", 320, 200);
    set(35, { kind: "railroad", name: "Short Line", price: 200 }); set(36, { kind: "chance", name: "Chance" });
    prop(37, "Park Place", "dblue", 350, 200); set(38, { kind: "tax", name: "Luxury Tax", amount: 100 });
    prop(39, "Boardwalk", "dblue", 400, 200);

    const tokenIds = ["hat", "car", "dog", "ship", "boot", "iron", "thimble", "barrow"];
    const board = {
        id: "classic", name: "Classic", tagline: "The timeless original", tiles, groups,
        chance: [], chest: [],
        tokens: tokenIds.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
        currency: { symbol: "$", suffix: false, scale: 1 },
        palette: {}, labels: { chance: "Chance", chest: "Community Chest", railroad: "Railroad", utility: "Utility", house: "house", hotel: "hotel", jail: "Get Out of Jail Free" },
        fontFamily: "sans-serif", artTheme: "classic",
    };
    board.labels.jail = "Jail";

    const shapes = [
        (c) => `<path d="M12 44 L52 44 L44 22 L20 22 Z M24 22 L32 10 L40 22" fill="${c}"/>`,
        (c) => `<rect x="8" y="26" width="48" height="16" rx="6" fill="${c}"/><circle cx="20" cy="46" r="6" fill="#333"/><circle cx="44" cy="46" r="6" fill="#333"/>`,
        (c) => `<ellipse cx="32" cy="38" rx="18" ry="12" fill="${c}"/><circle cx="46" cy="24" r="9" fill="${c}"/>`,
        (c) => `<path d="M8 38 L56 38 L46 52 L18 52 Z" fill="${c}"/><rect x="30" y="12" width="4" height="26" fill="${c}"/>`,
        (c) => `<path d="M16 12 L32 12 L32 36 L54 44 L54 54 L16 54 Z" fill="${c}"/>`,
        (c) => `<path d="M10 40 L54 40 L48 22 L16 22 Z" fill="${c}"/><rect x="14" y="40" width="36" height="8" fill="#555"/>`,
        (c) => `<path d="M16 16 L48 16 L44 52 L20 52 Z" fill="${c}"/>`,
        (c) => `<path d="M10 30 L46 30 L54 16 L54 40 L10 40 Z" fill="${c}"/><circle cx="26" cy="48" r="7" fill="#444"/>`,
    ];
    const tokenSvg = (id, color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${shapes[tokenIds.indexOf(id)](color)}</svg>`;
    const preview = (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><rect width="240" height="160" fill="${a}"/><rect x="20" y="20" width="200" height="120" fill="${b}" stroke="#222"/><rect x="20" y="20" width="200" height="14" fill="#955436"/><rect x="20" y="126" width="200" height="14" fill="#0072bb"/><text x="120" y="86" font-size="18" text-anchor="middle" fill="#222">TYCOON</text></svg>`;
    const summaries = [
        { id: "classic", name: "Classic", tagline: "The timeless original", previewSvg: preview("#cde6d0", "#e7f3e8"), tokens: tokenIds.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), svg: tokenSvg(id, "#555") })), currencySymbol: "$" },
        { id: "thailand", name: "Thailand", tagline: "Street food to skyscrapers", previewSvg: preview("#f6d9a8", "#fbeacb"), tokens: [], currencySymbol: "฿" },
        { id: "space", name: "Space", tagline: "Colonize the galaxy", previewSvg: preview("#1b1f4b", "#2a2f6b"), tokens: [], currencySymbol: "₡" },
        { id: "fantasy", name: "Fantasy", tagline: "Realms and ruins", previewSvg: preview("#d9c7f0", "#efe5fa"), tokens: [], currencySymbol: "g" },
    ];
    const settings = { startingCash: 1500, salary: 200, doubleSalaryOnGo: false, freeParkingJackpot: false, auctionOnDecline: true, evenBuild: true, rentInJail: true, jailFine: 50, roundLimit: 0, houseSupply: 32, hotelSupply: 12 };

    const lightTokens = { "--dd-surface-panel": "#ffffff", "--dd-surface-section": "#f4f4f2", "--dd-text-primary": "#1d1d1b", "--dd-text-secondary": "#55554f", "--dd-text-tertiary": "#8d8d85", "--dd-border-subtle": "#e4e4de", "--dd-accent": "#6d8f00", "--dd-on-accent": "#ffffff", "--dd-radius-md": "8px" };
    const darkTokens = { "--dd-surface-panel": "#17181a", "--dd-surface-section": "#222428", "--dd-text-primary": "#f0f0ee", "--dd-text-secondary": "#b8bab4", "--dd-text-tertiary": "#7c7f77", "--dd-border-subtle": "#34373c", "--dd-accent": "#a8d400", "--dd-on-accent": "#14180a", "--dd-radius-md": "8px" };

    const P = (seat, userId, name, color, token, o) => Object.assign({ seat, userId, name, color, token, cash: 1500, position: 0, inJail: false, jailTurns: 0, jailCards: { chance: 0, chest: 0 }, bankrupt: false }, o || {});
    const alice = P(0, "u-me", "Somchai", "#e53935", "hat", { cash: 1240, position: 14 });
    const bob = P(1, "u-bob", "Bob <b>Builder</b>", "#1e88e5", "car", { cash: 860, position: 25, jailCards: { chance: 1, chest: 0 } });
    const cara = P(2, "u-cara", "Cara", "#43a047", "dog", { cash: 2010, position: 10, inJail: true, jailTurns: 1 });

    const own = {
        1: { owner: 0, houses: 0, mortgaged: false }, 3: { owner: 0, houses: 0, mortgaged: false },
        11: { owner: 0, houses: 2, mortgaged: false }, 13: { owner: 0, houses: 2, mortgaged: false }, 14: { owner: 0, houses: 1, mortgaged: false },
        5: { owner: 0, houses: 0, mortgaged: true }, 12: { owner: 0, houses: 0, mortgaged: false },
        16: { owner: 1, houses: 0, mortgaged: false }, 18: { owner: 1, houses: 0, mortgaged: false }, 19: { owner: 1, houses: 0, mortgaged: false }, 25: { owner: 1, houses: 0, mortgaged: false },
        37: { owner: 2, houses: 5, mortgaged: false }, 39: { owner: 2, houses: 4, mortgaged: false }, 6: { owner: 2, houses: 0, mortgaged: false }, 8: { owner: 2, houses: 0, mortgaged: false }, 9: { owner: 2, houses: 0, mortgaged: false },
    };
    const log = [
        { id: 1, text: "Somchai rolled 4 + 3 and moved to Virginia Ave.", seat: 0, tone: "dice" },
        { id: 2, text: "Somchai bought Virginia Ave for $160.", seat: 0, tone: "good" },
        { id: 3, text: "Bob paid $40 rent to Cara.", seat: 1, tone: "bad" },
        { id: 4, text: "Bob drew Chance: Advance to Boardwalk.", seat: 1, tone: "card" },
        { id: 5, text: "Cara went to Jail.", seat: 2, tone: "info" },
    ];
    const base = (o) => Object.assign({ schema: 1, gameId: "g1", boardId: "classic", creatorUserId: "u-me", settings, players: [alice, bob, cara], ownership: own, current: 0, phase: { kind: "pre-roll" }, dice: [4, 3], doublesCount: 0, round: 6, housesLeft: 24, hotelsLeft: 11, jackpot: 0, decks: { chance: { order: [], next: 0 }, chest: { order: [], next: 0 } }, pendingTrade: null, log, nextLogId: 6, rng: 1 }, o);

    const tokenSvgs = {};
    [alice, bob, cara].forEach((p) => (tokenSvgs[p.token] = tokenSvg(p.token, p.color)));
    const SV = (seat, legal, o) => Object.assign({ seat, netWorth: 2100 - seat * 300, legal, buildable: [], sellable: [], mortgageable: [], unmortgageable: [] }, o || {});
    const assetSv = { buildable: [11, 13, 14], sellable: [11, 13, 14], mortgageable: [1, 3, 12], unmortgageable: [5] };
    const mkView = (state, o) => Object.assign({ state, board, mySeats: [0], activeSeat: 0, seatViews: [SV(0, ["roll", "build", "sell-building", "mortgage", "unmortgage", "propose-trade"], assetSv), SV(1, []), SV(2, [])], tokenSvgs, presentUserIds: ["u-me", "u-bob"], isCreator: true, pending: false }, o || {});

    const trade = { id: "t1", from: 1, to: 0, give: { cash: 100, tiles: [16], jailCards: 1 }, get: { cash: 0, tiles: [14], jailCards: 0 } };
    const lobbyState = base({ phase: { kind: "lobby" }, players: [alice, bob], ownership: {}, log: [] });
    const lobbyBob = base({ phase: { kind: "lobby" }, players: [bob], ownership: {}, log: [] });

    const games = [
        { gameId: "g1", boardId: "classic", boardName: "Classic", phase: "pre-roll", playerNames: ["Somchai", "Bob", "Cara"] },
        { gameId: "g2", boardId: "thailand", boardName: "Thailand", phase: "lobby", playerNames: ["Dao"] },
    ];

    const init = (mode) => ({ type: "init", me: { userId: "u-me", name: "Somchai", color: "#e53935" }, boards: summaries, defaultSettings: settings, themeTokens: mode === "dark" ? darkTokens : lightTokens, themeMode: mode });
    const sel = (view) => [{ type: "games", games, selected: "g1" }, { type: "view", view }];

    const auctionState = base({ phase: { kind: "auction", auction: { tile: 21, highBid: 120, highBidder: 1, bidders: [0, 1, 2], turn: 0 } } });
    const debtState = base({ phase: { kind: "debt", resume: "post-roll", debt: { debtor: 0, creditor: 2, amount: 1600 } }, players: [Object.assign({}, alice, { cash: 340 }), bob, cara] });

    const S = {
        home: () => [{ type: "games", games, selected: null }, { type: "view", view: null }],
        newgame: () => S.home(),
        lobby: () => sel(mkView(lobbyBob, { mySeats: [], activeSeat: null, seatViews: [], isCreator: false })),
        "lobby-joined": () => sel(mkView(lobbyState, { seatViews: [SV(0, [])], isCreator: true })),
        hotseat: () => sel(mkView(lobbyState, { mySeats: [0, 1], seatViews: [SV(0, []), SV(1, [])] })),
        game: () => sel(mkView(base())),
        "game-tabs": () => S.game(),
        trade: () => sel(mkView(base({ pendingTrade: trade }), { seatViews: [SV(0, ["roll", "propose-trade", "accept-trade", "reject-trade"], assetSv), SV(1, ["cancel-trade"]), SV(2, [])] })),
        buy: () => sel(mkView(base({ phase: { kind: "buy-decision", tile: 21 } }), { seatViews: [SV(0, ["buy", "decline"], assetSv), SV(1, []), SV(2, [])] })),
        auction: () => sel(mkView(auctionState, { seatViews: [SV(0, ["bid", "pass-bid"], assetSv), SV(1, []), SV(2, [])] })),
        debt: () => sel(mkView(debtState, { seatViews: [SV(0, ["declare-bankruptcy", "mortgage", "sell-building"], Object.assign({}, assetSv, { netWorth: 1900 })), SV(1, []), SV(2, [])] })),
        jail: () => sel(mkView(base({ current: 2, players: [alice, bob, cara] }), { mySeats: [2], activeSeat: 2, presentUserIds: ["u-me"], seatViews: [SV(0, []), SV(1, []), SV(2, ["roll", "pay-jail-fine", "use-jail-card"])] })),
        waiting: () => sel(mkView(base({ current: 1 }), { presentUserIds: ["u-me"], seatViews: [SV(0, ["build", "propose-trade"], assetSv), SV(1, []), SV(2, [])] })),
        postroll: () => sel(mkView(base({ phase: { kind: "post-roll", rollAgain: true } }), { seatViews: [SV(0, ["roll", "build", "sell-building", "mortgage", "unmortgage", "propose-trade"], assetSv), SV(1, []), SV(2, [])] })),
        gameover: () => sel(mkView(base({ phase: { kind: "game-over", winner: 2, reason: "round-limit" } }), { seatViews: [SV(0, []), SV(1, [], { netWorth: 1500 }), SV(2, [], { netWorth: 4200 })] })),
        players: () => S.game(), log: () => S.game(), rules: () => S.game(),
        error: () => S.game().concat([{ type: "error", message: "You cannot build on Virginia Ave: build evenly across the color group." }]),
    };
    window.TYCOON_FIX = { scenarios: S, init };
})();

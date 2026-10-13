# Board Tycoon — architecture

A 2–6 player property-trading game (Monopoly-style rules) as a Drawdy extension.
Protocol docs: https://ddp.drawdy.io/llms-full.txt (read the relevant sections before touching the driver).

## Hard constraints from the Drawdy platform

- A driver runs **locally in each user's tab** (shared web worker). There is **no network or messaging channel between users**. The only thing shared between collaborators is the **scene**: element geometry, style and `meta` sync to everyone on a cloud board.
- `src/` may import **nothing** except relative files and the type-only `@drawdy/driver-protocol`. No npm runtime deps, no bundler plugins, no `virtual:` imports. Bundle is built by esbuild → one CJS file (ES2020). Keep source readable (reviewed by humans). No `fetch`, `eval`, `new Function`.
- Element `text` is **not updatable**. Updatable: style fields (`fillColor`, `strokeColor`, `opacity`, `strokeDash`, …), `meta` (shallow-merged), `locked`, `groupId`, `frameId`, `localAnimation`, `frameName`, `width`/`height`, `transform: {x,y}` (absolute top-left). To change text/components: remove + add (new id).
- `add-drawdy-elements` fails atomically if any id already exists.
- Development hot reload only works on **local** boards → hot-seat (several players on one device) must be a first-class mode, and it is also how we test.

## Module map

```
src/
  index.ts              driver entry (activate/onEvent) — wires everything below
  dd.ts                 tiny typed helper around issueCommand (request ids, error unwrap)
  engine/               PURE game rules. No Drawdy imports, no Math.random, no Date.
    types.ts            ★ contract (orchestrator-owned)
    index.ts            public API (see below)
    ...                 reducer, rent, cards, auction, trade, bankruptcy, rng
  boards/
    types.ts            ★ contract: BoardDef (pure data), formatMoney
    layout.ts           ★ shared geometry: tilePlacement, tokenRect, buildingSlots, ownerChipRect …
    classic.ts thailand.ts space.ts fantasy.ts
    index.ts            BOARDS: BoardDef[], getBoard(id)
  art/                  SVG string generators (pure functions → string)
    index.ts            public API (see below)
  sync/                 multiplayer over the scene: envelope, intents, authority, failover
  scene/                render GameState onto the canvas (authority only)
  i18n/                 languages (en, th, zh, es): lang.ts (Lang, normalizeLang, makeTr), engine.ts / scene.ts string tables
  ui/
    messages.ts         ★ contract: driver ⇄ webview
    webview-html.ts     GENERATED from webview/ by scripts/build-webview.mjs — committed
webview/                control panel source: index.html, styles.css, app.js (plain DOM, no framework)
test/                   node:test via tsx — engine tests mostly
```

★ = shared contracts. Don't change them without telling the orchestrator; if you must add a field, add it (optional when possible) and mention it in your report.

## Languages

- **Game language** (`GameState.lang`, missing = `en`) is chosen at creation and never changes. Everything on the shared canvas and in shared state uses it: board art, tile names, cards, tokens, scoreboard, frame name, the game log and engine errors.
- **Board content**: themes are written in English; `src/boards/i18n/<theme>.ts` holds a `BoardText` per language and `localizeBoard(board, lang)` (`src/boards/localize.ts`) overlays it and sets `board.lang`, adding script-capable fonts. The driver localizes the board once per game, so engine, art and scene only ever read `board.lang` and translated names.
- **Panel language** is per user (saved choice, else `navigator.language`), sent to the driver in `ready` / `lang` messages. The panel chrome (`webview/i18n.js`), the theme picker and the driver's error messages to the panel use it.
- `test/i18n.test.ts` checks every theme is fully translated with the same `{money:N}` placeholders.

## Engine API (`src/engine/index.ts`)

```ts
createGame(opts: { gameId: string; board: BoardDef; creatorUserId: string; seed: number; settings?: Partial<GameSettings> }): GameState   // phase "lobby"
applyAction(board: BoardDef, state: GameState, action: Action, actor: Actor): ApplyResult   // never mutates input
seatView(board: BoardDef, state: GameState, seat: Seat): SeatView
netWorth(board: BoardDef, state: GameState, seat: Seat): number
rentFor(board: BoardDef, state: GameState, tile: number, diceTotal: number): number
needsToAct(state: GameState): Seat[]   // seats whose input the game is waiting on
```

Rules are the official ones (US 2008+ rules) with the house rules in `GameSettings`. Movement, rent, cards, jail and GO salary resolve **inside** the `roll` action; the state that comes out is already "landed". The renderer animates from the previous state.

## Multiplayer sync (`src/sync/`)

**Envelope** — stored on the game's root **frame** element as `meta.tycoon` (one key, replaced whole on each write):

```ts
type GameEnvelope = {
  kind: "game"; v: 1;
  version: number;                 // +1 on every authority write
  authorityUserId: string;         // the only client allowed to write this envelope and the game's scene elements
  acks: Record<string, number>;    // userId → last intent seq applied (or rejected)
  errors: Record<string, { seq: number; message: string }>;  // last rejection per user
  state: GameState;
  ids: SceneIds;                   // element ids the renderer created (so any future authority can find/fix them)
};
```

**Intents** — every user writes only to **their own** seat-intent element for that game (a tiny locked, invisible shape inside the frame, id `${gameId}:intent:${hash(userId)}`), `meta.tycoon = { kind: "intent", gameId, userId, intents: {seq, action}[] }` (keep the last 20). One writer per element → no merge conflicts.

**Authority** — applies intents with `seq > acks[userId]` in order via `applyAction`, writes the envelope, then renders the scene diff. The authority's own actions skip the intent element and apply directly. Initially the creator.

**Failover** — every client watches `subscription:collaboration:presence-changed`. If `authorityUserId` has been absent ≥ 4 s, the first present userId in seat order (non-bankrupt seats, then creator) claims authority by writing the envelope with itself as authority and `version + 1`. Everyone computes the same candidate, so claims don't race in practice. Without the `collaboration` permission (denied / local board) the local user is always authority.

**Self-healing** — the authority keeps the envelope in memory. If a scene event shows an older `version` on the frame (e.g. someone hit undo), it re-writes its copy and re-reconciles the scene.

**Discovery** — on activate: `get-drawdy-elements(["meta"])`, pick frames whose `meta.tycoon.kind === "game"`. Then subscribe to `elements-added/updated/removed` with `["meta"]`.

## Scene (`src/scene/`)

The authority renders; others just see synced elements. Everything lives inside the game frame (frame `x,y` = board origin minus padding) and is `locked: true`.

- **Board art**: one native `image` element (id `…:board-img`) with a `data:image/svg+xml,…` URL of `boardSvg(board)` (1220×1220). Not a component: as a component, Drawdy drew it smaller than its box when zoomed out (phones, desktop zoomed far out), so the board drifted away from the chips and tokens. Keep the SVG lean (it syncs).
- **Owner markers**: one image component per owned tile at `ownerChipRect(i)` (`ownerBadgeSvg`: band in the owner color, hatched when mortgaged). Components, not shapes: shapes render under the board art component. Id hashes color + mortgage, so changes swap the element.
- **Buildings**: components with `houseSvg`/`hotelSvg` at `buildingSlots(i)` / `hotelSlot(i)`; add/remove on change (deterministic ids).
- **Tokens**: one component per player at `tokenRect(pos, slot, jailed)`. A move is one update: final `transform` plus a baked `localAnimation` (`scene/fx.ts`) — hop tile by tile, or leap (jail, cards, backwards), or a little skip when making room on a tile.
- **Name tags**: an image component per player (`nameTagSvg`, pill in the player color) centered above the token. Content-addressed by text + color; the text shortens on crowded tiles (3 → short name, 4+ → initial). Moves copy the token's x/y tracks; a tag replaced mid-move is created hidden and pops in when the token lands.
- **Dice**: two components in the center showing `state.dice`, re-created on change, thrown in with a baked tumble (`scene/dice-anim.ts`); doubles add a cheer jump.
- **Juice** (`scene/fx.ts`, all baked keyframes, synced to everyone as `localAnimation`): an animated pass runs chips stamp / houses drop → dice → moves → shockwave + ring pop on landing → coins fly payer→payee (`cashFlows`) → scoreboard text swaps with a punch (green/red flash). Transient effect elements (`${gameId}:fx:…`: shockwaves, coins, confetti) are added hidden, revealed with their animation, removed by timer; leftovers are swept as stale by discovery.
- **Scoreboard**: text/shape elements to the right of the board (name, cash, current-turn marker), rebuilt when it changes.
- **Frame name** shows status: `Board Tycoon · Thailand — Somchai's turn`.

## Art (`src/art/index.ts`)

```ts
boardSvg(board: BoardDef): string                       // full 1220×1220 board, uses layout.ts
boardPreviewSvg(board: BoardDef): string                 // ~240×160 thumbnail for the picker
tokenSvg(board: BoardDef, tokenId: string, color: string): string   // 64×64 viewBox
diceFaceSvg(value: number, palette?: { face: string; pip: string }): string  // 64×64
houseSvg(color?: string): string; hotelSvg(color?: string): string
tileCardSvg(board: BoardDef, tile: number): string       // title-deed / card art for the panel
actionButtonSvg(): string                                 // 24×24 toolbar icon
svgDataUrl(svg: string): string                           // "data:image/svg+xml," + encodeURIComponent
```

All SVG is hand-written strings, deterministic, system fonts only (`board.fontFamily`), no `<script>`, no external refs.

## Webview (`webview/` → `src/ui/webview-html.ts`)

Plain HTML/CSS/JS control panel, ~360 px wide, uses `--dd-*` tokens. Sound effects (`webview/sfx.js`, `BT_SFX`) are synthesized with Web Audio (no audio files); `viewSfx` in `app.js` picks them from the same state diff as the visual `viewFx`. The driver's worker has no audio, so sounds play only in each user's panel. The mute choice is saved in the panel's `localStorage`. Talks to the driver only through `src/ui/messages.ts`. Screens: games list / new game (theme picker + house rules) → lobby (join with name/color/token, "add local player" for hot-seat, creator starts) → game (turn banner, dice, contextual primary action, tabs: Assets, Players, Trade, Log, Rules). The panel is a view: all rules live in the engine; the panel enables buttons from `SeatView.legal`.

## Commands

```
npm run dev        # vite dev server for Drawdy development mode (local boards)
npm run build      # dist/<driver-id>.drawdyx
npm run typecheck
npm test           # tsx --test test/*.test.ts
npm run webview    # regenerate src/ui/webview-html.ts from webview/
```

# Dungeon Escape — Design & Module Contract

A turn-based, top-down dungeon crawler for the browser. Plain JavaScript, no build step, no
external assets or libraries. Everything is drawn on a `<canvas>` with code. It must work when
`index.html` is opened directly from disk (`file://`), so **no ES modules** — every file is a
classic `<script>` that attaches to the global namespace `window.DE`.

Every JS file starts with:

```js
window.DE = window.DE || {};
(function (DE) {
  'use strict';
  // ...
})(window.DE);
```

## Gameplay

- You wake on **Floor 1** of a 5-floor dungeon. Reach the **EXIT portal on Floor 5** to escape.
- Floors 1–4 have **STAIRS** down. On every floor, the stairs/exit room is sealed by a
  **locked door**; find the **key** on that floor to open it.
- Turn-based: each player action (move, attack, wait) is one turn; then every enemy acts once.
- Move into an enemy to attack it. Move into a locked door while holding a key to open it.
- **Fog of war**: you only see tiles within your light radius (line of sight). Explored tiles stay
  dimly visible. Enemies and items are only drawn when currently visible.
- Items: potion (heal), gold, key, sword (+ATK), shield (+DEF), torch (+light radius).
- Spike traps hurt the player when stepped on.
- Score = `gold + kills*10 + (floorReached-1)*100 + (won ? 1000 : 0)`. Best score in
  `localStorage['dungeonEscape.best']` (wrap in try/catch).

Controls: Arrow keys / WASD move, Space or `.` waits a turn, Enter starts/restarts, `M` mutes.
On touch screens an on-screen D-pad is shown.

## File layout & ownership

```
dungeon-escape/
  index.html        (Agent A)
  style.css         (Agent A)
  js/config.js      (Agent B)  constants, tables, helpers, RNG
  js/audio.js       (Agent A)  WebAudio sound effects
  js/dungeon.js     (Agent B)  procedural floor generation
  js/render.js      (Agent C)  canvas renderer + FOV
  js/game.js        (Agent D)  game state, rules, input, HUD
  js/main.js        (Agent A)  bootstrap
```

Script load order in index.html (all at the end of `<body>`):
`config.js, audio.js, dungeon.js, render.js, game.js, main.js`.

Only `main.js` runs code at load time that touches other modules; other files only define things.

---

## 1. `js/config.js` (Agent B)

```js
DE.CONFIG = {
  TILE: 32,          // px per tile on the canvas
  VIEW_W: 25,        // tiles visible horizontally  -> canvas 800 px
  VIEW_H: 17,        // tiles visible vertically    -> canvas 544 px
  MAP_W: 56,
  MAP_H: 40,
  FLOORS: 5,
  FOV_RADIUS: 5,     // starting light radius
  MAX_FOV: 8,
  LOG_LINES: 6,
};

DE.T = { WALL: 0, FLOOR: 1, DOOR_LOCKED: 2, DOOR_OPEN: 3, STAIRS: 4, EXIT: 5, SPIKES: 6 };

DE.isWalkable(t)   // true for FLOOR, DOOR_OPEN, STAIRS, EXIT, SPIKES
DE.isOpaque(t)     // true for WALL, DOOR_LOCKED
DE.idx(floor, x, y)          // y * floor.width + x
DE.inBounds(floor, x, y)
DE.tileAt(floor, x, y)       // DE.T.WALL when out of bounds
DE.setTile(floor, x, y, t)

DE.makeRng(seed)  // mulberry32. Returns an object:
  // next()          float in [0,1)
  // int(min, max)   integer, inclusive both ends
  // pick(array)     random element
  // chance(p)       boolean, true with probability p
  // shuffle(array)  in-place Fisher-Yates, returns the array

DE.DIRS = { up: {x:0,y:-1}, down: {x:0,y:1}, left: {x:-1,y:0}, right: {x:1,y:0} };

DE.PLAYER_BASE = { hp: 20, maxHp: 20, atk: 3, def: 0, fov: 5 };

// sight = chase radius (Manhattan). erratic = chance per turn to move randomly instead.
DE.ENEMIES = {
  slime:    { name: 'Slime',    hp: 5,  atk: 2, def: 0, sight: 5, erratic: 0.25, gold: [0, 3],  minFloor: 1, weight: 4 },
  bat:      { name: 'Bat',      hp: 3,  atk: 1, def: 0, sight: 7, erratic: 0.5,  gold: [0, 2],  minFloor: 1, weight: 3 },
  skeleton: { name: 'Skeleton', hp: 9,  atk: 3, def: 1, sight: 6, erratic: 0,    gold: [2, 6],  minFloor: 2, weight: 3 },
  orc:      { name: 'Orc',      hp: 14, atk: 4, def: 2, sight: 6, erratic: 0,    gold: [5, 12], minFloor: 3, weight: 2 },
  wraith:   { name: 'Wraith',   hp: 11, atk: 5, def: 1, sight: 8, erratic: 0.1,  gold: [8, 16], minFloor: 4, weight: 2 },
};

DE.ITEMS = {
  potion: { name: 'Health Potion', heal: 8 },
  gold:   { name: 'Gold' },               // amount stored on the item instance
  key:    { name: 'Key' },
  sword:  { name: 'Sword',  atk: 1 },
  shield: { name: 'Shield', def: 1 },
  torch:  { name: 'Torch',  fov: 1 },
};
```

## 2. `js/dungeon.js` (Agent B)

```js
DE.generateFloor(level, seed) -> floor
```

Returns:

```js
floor = {
  level,                 // 1..5
  width, height,         // CONFIG.MAP_W, CONFIG.MAP_H
  tiles,                 // Uint8Array(width*height) of DE.T values, index y*width+x
  rooms: [{x, y, w, h}], // interior rectangles (floor tiles)
  start: {x, y},         // player spawn, a FLOOR tile in rooms[0]
  stairs: {x, y},        // STAIRS tile (levels 1-4) or EXIT tile (level 5)
  door: {x, y} | null,   // the DOOR_LOCKED tile guarding the stairs room
  key:  {x, y} | null,   // where the key item lies (also present in items[])
  enemies: [{type, x, y}],          // type is a key of DE.ENEMIES
  items:   [{type, x, y, amount?}], // type is a key of DE.ITEMS; gold has amount
}
```

Algorithm (rooms + corridors):
1. Fill with WALL. Place 8–12 non-overlapping rooms (interior size 4–10 × 4–8), keeping a 1-tile
   wall border around the map and at least 1 wall tile between rooms.
2. Sort rooms by center x, connect each room to the next with an L-shaped 1-wide corridor; add
   1–2 extra random connections for loops.
3. `start` = center of `rooms[0]`. Stairs room = the room whose center is farthest (BFS distance)
   from start. Put STAIRS (or EXIT on level `CONFIG.FLOORS`) at its center.
4. **Locked door:** find every floor tile on the stairs room's boundary entrances (corridor tiles
   directly adjacent to the room's interior rectangle). If there is exactly one entrance, make
   it DOOR_LOCKED. If more, retry generation (new derived seed), up to 60 attempts. Then verify
   with BFS from `start` treating DOOR_LOCKED as blocked: the stairs must be **unreachable** and
   the key position **reachable**. If all attempts fail, accept a floor with `door: null`,
   `key: null` (no lock) rather than an unsolvable one.
5. Key: on a random FLOOR tile in a room other than rooms[0] and the stairs room, reachable
   without the door.
6. Enemies: count `4 + level*2`, chosen by weight from types with `minFloor <= level`. Only on
   FLOOR tiles with Manhattan distance >= 7 from start, never two on one tile.
7. Items (on free FLOOR tiles, not start/stairs/door/key, no two on one tile):
   potions `2 + (level >= 3 ? 1 : 0)`; gold piles `5 + level` with `amount = rng.int(3,10) + level*2`;
   sword with chance 0.5, shield 0.5, torch 0.4. Plus the key.
8. Spikes: `3 + level` SPIKES tiles on random FLOOR tiles (corridor or room) not on/adjacent to
   start, and not on stairs, door, key, item or enemy tiles. Never put spikes on a corridor tile
   whose removal-from-walkable would matter — spikes are walkable, so any floor tile is fine.
9. Deterministic: same `(level, seed)` → same floor. Use `DE.makeRng`.

Also export a debug helper: `DE.floorToAscii(floor)` returns a string (`#` wall, `.` floor,
`+` locked door, `'` open door, `>` stairs, `E` exit, `^` spikes, `@` start, `k` key).

## 3. `js/render.js` (Agent C)

```js
DE.computeFOV(floor, px, py, radius) -> Uint8Array(width*height)
```
1 = visible. A tile is visible if within Euclidean distance `radius + 0.5` and a Bresenham line
from the player to it is not blocked by an opaque tile (`DE.isOpaque`) before reaching it. The
opaque tile itself (wall) is visible so walls render. The player tile is always visible.

```js
const r = new DE.Renderer(canvas);   // canvas is 800x544 (VIEW_W*TILE x VIEW_H*TILE)
r.draw(state);                        // called every animation frame by the game
r.reset();                            // forget tween positions (call on new floor)
```

`state` passed to `draw`:

```js
{
  floor,                      // from generateFloor
  player: { id: 'player', x, y, hp, maxHp, facing: 'up'|'down'|'left'|'right', flashUntil },
  enemies: [{ id, type, x, y, hp, maxHp, flashUntil }],
  items:   [{ id, type, x, y }],
  visible,                    // Uint8Array from computeFOV
  explored,                   // Uint8Array, 1 = seen at some point
  fov,                        // current light radius (number)
  effects: [{ x, y, text, color, born, ttl }], // floating text in tile coords
  shakeUntil,                 // timestamp ms; shake screen ~4px while now < shakeUntil
  now,                        // performance.now()
}
```

Rendering rules:
- Camera centred on the player's (tweened) position, clamped to map edges.
- **Tweening:** keep a map `id -> {x, y}` of display positions; each frame move it toward the
  logical position (e.g. lerp factor 0.35, snap when < 0.01). Unknown ids snap instantly.
- Unexplored tiles: pure black. Explored but not visible: drawn, then darkened to ~30% brightness.
  Visible: full brightness with a warm torch falloff (darker toward the edge of `fov`) and a
  slight flicker using `now`.
- Draw only enemies/items on **visible** tiles.
- Pixel-art style using `fillRect`/paths, no images. Dark palette. Specifics:
  - Wall: stone blocks with mortar lines; a lighter top edge when the tile below is walkable.
  - Floor: dark slate with subtle per-tile variation from a deterministic hash of (x, y).
  - DOOR_LOCKED: wooden door with a gold keyhole. DOOR_OPEN: dark doorway with door edges.
  - STAIRS: descending steps. EXIT: pulsing green/cyan portal.
  - SPIKES: grey triangles on the floor.
  - Player: small hero (head, body, cape) facing `facing`; flashes white while `now < flashUntil`.
  - Enemies: slime (green blob that bobs), bat (purple, flapping wings using `now`), skeleton
    (bone-white with dark eye sockets), orc (big olive with tusks), wraith (translucent pale-blue,
    floating). Flash white while `now < flashUntil`. Small HP bar above an enemy if `hp < maxHp`.
  - Items: potion (red flask), gold (yellow coins), key (gold key, gently bobbing), sword, shield,
    torch (with a tiny flame).
- Floating effects: text rises ~20 px and fades over `ttl` ms, bold 14 px monospace with a dark
  outline. Draw at tween-independent tile coords.
- **Minimap** in the top-right corner (~3 px per tile, semi-transparent dark background): explored
  walkable tiles in grey, the stairs/exit if explored, the player as a bright dot.
- Use `ctx.imageSmoothingEnabled = false`. Must not throw if arrays are empty.

## 4. `js/audio.js` (Agent A)

```js
DE.audio = {
  play(name),        // no-op if muted or AudioContext unavailable
  toggleMute(),      // returns new muted boolean, persisted in localStorage 'dungeonEscape.muted'
  isMuted(),
  unlock(),          // create/resume AudioContext; call on first user gesture
};
```
Names: `step, hit, hurt, kill, pickup, key, door, locked, stairs, potion, trap, death, win`.
Short synthesized blips with OscillatorNode + GainNode envelopes (and a noise buffer for `hit`
/`trap`). Keep volume moderate. Never throw.

## 5. `index.html`, `style.css`, `js/main.js` (Agent A)

Required element ids (the game looks them up by id — names must match exactly):

| id | element | purpose |
|---|---|---|
| `game-canvas` | `<canvas width="800" height="544">` | playfield |
| `hud-hp-fill` | div | HP bar fill; game sets `style.width` to a % |
| `hud-hp-text` | span | e.g. `14 / 20` |
| `hud-floor` | span | e.g. `3 / 5` |
| `hud-gold`, `hud-keys`, `hud-atk`, `hud-def`, `hud-turns`, `hud-kills` | span | numbers |
| `log` | `<ul>` | message log; game appends `<li class="msg-TYPE">`, keeps last 6 |
| `overlay-title` | div | title screen: game name, short how-to, `#best-score` span, `#btn-start` |
| `overlay-dead` | div | "You Died", `#dead-stats` div, `#btn-retry` |
| `overlay-win` | div | "You Escaped!", `#win-stats` div, `#btn-again` |
| `overlay-floor` | div | brief banner, text in `#floor-banner-text` |
| `dpad` | div | touch controls: `<button data-dir="up|down|left|right|wait">` |
| `btn-mute` | button | mute toggle (game updates its text 🔊/🔇) |

- The class `hidden` means `display: none !important`. Initially only `overlay-title` is visible.
- Overlays sit on top of the canvas (absolutely positioned inside a wrapper around the canvas).
- Log message classes: `msg-info`, `msg-good`, `msg-bad`, `msg-loot`.
- Layout: centred column; HUD bar above the canvas, log below. The canvas scales down to fit
  narrow screens (`max-width: 100%; height: auto; image-rendering: pixelated`). No horizontal
  scrolling at 375 px width. `#dpad` only shown on touch devices (`@media (pointer: coarse)`).
- Look: dark dungeon theme (near-black background, stone greys, torch-orange accents), a pixel or
  monospace display font from system fonts (no web-font downloads). Title "DUNGEON ESCAPE".
- `main.js`:
  ```js
  window.addEventListener('DOMContentLoaded', function () {
    DE.game = new DE.Game();
    DE.game.init();
  });
  ```

## 6. `js/game.js` (Agent D)

```js
DE.Game = class {
  init()            // look up DOM by id, bind input, create Renderer, show title, start rAF loop
  newRun()          // reset player to PLAYER_BASE, gold/kills/turns 0, seed = Date.now(), loadFloor(1)
  loadFloor(level)  // generateFloor(level, seed + level*7919); copy enemies/items into live arrays
                    // with unique numeric ids and full hp; fresh explored array; renderer.reset();
                    // show #overlay-floor banner ~1.2 s ("Floor N" / "Final Floor")
  // plus whatever internal methods it needs
};
```

State: `mode` is `'title' | 'playing' | 'dead' | 'won'`. Input only acts while `'playing'`
(Enter on title/dead/won starts a new run; buttons do the same). Call `DE.audio.unlock()` on the
first keydown/pointerdown.

Turn rules (`playerAction(dir | 'wait')`):
1. Set `player.facing`. Target tile `(x+dx, y+dy)`.
2. Enemy there → attack: `dmg = max(1, atk + rng.int(-1,1) - enemy.def)`. Flash enemy
   (`flashUntil = now+120`), floating red damage text, sound `hit`. If hp ≤ 0: remove it, kills++,
   drop gold `rng.int(...ENEMIES[type].gold)` straight into the player's purse (if > 0, yellow
   `+N` text), log "You slay the Skeleton.", sound `kill`.
3. DOOR_LOCKED → with a key: keys--, tile becomes DOOR_OPEN, log, sound `door` (this uses the
   turn). Without: log "The door is locked. Find the key.", sound `locked`, **no turn passes**.
4. Wall → nothing happens, no turn passes.
5. Walkable → move, sound `step`. Then:
   - Item there → pick up (potion heals `heal` capped at maxHp — if already at full HP, still pick
     up and heal 0 is fine; gold adds amount; key: keys++; sword atk+1; shield def+1; torch fov+1
     up to MAX_FOV). Log with `msg-loot`, green/yellow floating text, sound per type.
   - SPIKES → 2 damage, log, sound `trap`, shake.
   - STAIRS → hp += 5 (capped), sound `stairs`, `loadFloor(level+1)`. EXIT → win.
6. `wait` → no movement, it is a turn.
7. If a turn passed: turns++, then each enemy acts:
   - If orthogonally adjacent to the player → attack: `dmg = max(1, atk + rng.int(-1,1) - player.def)`,
     player flash, shake 150 ms, red text, sound `hurt`, log "The Orc hits you for 3.".
   - Else with probability `erratic` → step in a random direction if free.
   - Else if Manhattan distance ≤ `sight` → step toward the player: try the axis with the larger
     gap first, then the other axis. A step is legal only onto a walkable tile (not DOOR_LOCKED),
     not occupied by another enemy or the player.
   - Else 30% chance to wander randomly.
8. Recompute FOV (`DE.computeFOV(floor, x, y, fov)`) and OR it into `explored`. Update HUD.
9. Player hp ≤ 0 → mode `'dead'`, sound `death`, show `#overlay-dead` with cause
   ("Slain by a Wraith on floor 4" / "Killed by spikes on floor 2"), score, best score.
10. Win → mode `'won'`, sound `win`, `#overlay-win` with gold, kills, turns, score, best.

Input:
- `keydown`: Arrow keys / WASD → move, Space / `.` → wait, `m` → mute, Enter → start when not
  playing. `preventDefault` for arrows and space. Holding a key repeats at most every 110 ms
  (ignore events closer than that).
- `#dpad button` → `pointerdown` triggers the same action.
- Floating effects live in `this.effects` with `born = performance.now()`, `ttl = 900`; prune
  expired ones each frame.
- rAF loop calls `renderer.draw(state)` every frame (also on title screen so the dungeon shows
  behind the overlay — generate floor 1 at init for that backdrop).
- Log: `log(text, type)` prepends/appends `<li>`, keeps the last `CONFIG.LOG_LINES`.
- Expose for testing: `DE.game` is the instance (set by main.js); keep `this.player`,
  `this.enemies`, `this.items`, `this.floor`, `this.level`, `this.mode` as public fields.
- Start-of-floor log line: "Floor N. Find the key and the way down." (final floor: "...the
  exit."). Welcome line on run start.

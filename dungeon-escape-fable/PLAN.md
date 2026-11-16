# Dungeon Escape — build plan and shared contract

A top-down, tile-based dungeon crawler for the browser. Find the key on each floor, reach the locked exit door, survive 5 floors.

**Tech:** plain HTML + CSS + vanilla JavaScript on a `<canvas>`. No build step, no libraries, no ES modules, no network assets. The game must work by double-clicking `index.html` (file:// URL), so every JS file is a classic script that attaches to one global, `window.DE`.

Every JS file starts with:

```js
window.DE = window.DE || {};
```

and must not assume any other file has loaded at parse time (only touch other `DE.*` members inside functions).

## Files and owners

| File | Owner | Contains |
|---|---|---|
| `js/config.js` | Agent A | `DE.CONFIG`, `DE.TILE` |
| `js/map.js` | Agent A | `DE.generateLevel`, `DE.isWalkable` |
| `js/audio.js` | Agent A | `DE.sfx` |
| `js/entities.js` | Agent B | player, enemies, movement, combat, pickups, fog, particles |
| `js/render.js` | Agent C | `DE.render` |
| `index.html`, `style.css`, `js/main.js` | Agent D | page, HUD, overlays, input, game loop, state machine |

Script order in `index.html`: config, map, audio, entities, render, main.

Only edit the files you own. If the contract seems wrong or incomplete, do not change it: pick the most reasonable reading, and say so in your final report.

## Gameplay rules

- Grid movement: the player steps one tile at a time (arrow keys or WASD), repeating while a key is held. Rendered position slides smoothly between tiles.
- Walking into an enemy attacks it instead of moving (bump combat).
- Enemies move on their own timers in real time; an enemy that would step onto the player's tile attacks instead.
- Each floor has exactly one key and one locked exit door. Stepping into the door with the key goes to the next floor; without it, shows "The door is locked".
- Potions heal 2 HP (up to max). Coins give score.
- Spike tiles toggle: active for 1 second, inactive for 1 second. Standing on active spikes costs 1 HP.
- After any damage the player is invulnerable for 1 second.
- Fog of war: tiles are hidden until the player has been within sight radius of them.
- HP reaching 0 is game over. Clearing floor 5 wins.
- Score: coin 10, kill 25, floor cleared 100.

## Constants (`js/config.js`, exactly these)

```js
DE.CONFIG = {
  TILE_SIZE: 32,
  VIEW_COLS: 25,        // canvas is 800 x 576
  VIEW_ROWS: 18,
  FLOORS: 5,
  PLAYER_MAX_HP: 6,
  PLAYER_MOVE_DELAY: 0.13,   // seconds between steps while a key is held
  PLAYER_DAMAGE: 1,
  INVULN_TIME: 1.0,
  SIGHT_RADIUS: 6,
  TWEEN_SPEED: 14,           // tiles per second for sliding px/py toward x/y
  SCORE_COIN: 10,
  SCORE_KILL: 25,
  SCORE_FLOOR: 100,
  POTION_HEAL: 2,
  ENEMY_TYPES: {
    slime:    { hp: 2, dmg: 1, moveInterval: 0.9,  chaseRadius: 5 },
    bat:      { hp: 1, dmg: 1, moveInterval: 0.35, chaseRadius: 0 },  // always random
    skeleton: { hp: 3, dmg: 2, moveInterval: 0.6,  chaseRadius: 8 }
  }
};
DE.TILE = { WALL: 0, FLOOR: 1, DOOR: 2, SPIKES: 3 };
```

## Data shapes

### Level (returned by `DE.generateLevel(floor)`, floor is 1..5)

```js
{
  floor: 1,
  width: 35, height: 25,            // width = 31 + 4*floor, height = 23 + 2*floor
  tiles: [[0,0,...], ...],          // tiles[y][x], values from DE.TILE
  seen:  [[false,...], ...],        // seen[y][x], all false initially
  start: { x, y },                  // a FLOOR tile
  exit:  { x, y },                  // the single DOOR tile
  items: [ { type: 'key'|'potion'|'coin', x, y, taken: false } ],
  enemySpawns: [ { type: 'slime'|'bat'|'skeleton', x, y } ]
}
```

Guarantees: rooms joined by corridors; outer border is all WALL; every FLOOR/SPIKES tile, every item and the door are reachable from `start` without crossing the door; exactly one key; the door is far from start (aim for the farthest room); items and spawns sit on FLOOR tiles, never on start, never two on one tile; no spawn within 6 tiles of start; spikes never on start, never adjacent to the door, and never the only path through a 1-wide corridor is fine but keep them few. Counts per floor: enemies 3 + 2*floor, potions 2, coins 6 + 2*floor, spikes 2 + 2*floor. Enemy mix: floor 1 slimes and bats only; skeletons from floor 2, more common on later floors.

### State (created by main.js)

```js
{
  screen: 'title' | 'playing' | 'paused' | 'gameover' | 'win',
  floor: 1,
  level: <Level>,
  player: <Player>,
  enemies: [<Enemy>],
  time: 0,            // seconds of play, total across floors; main.js advances it
  score: 0,
  messages: [ { text, ttl } ],   // ttl in seconds
  particles: [ { x, y, vx, vy, life, maxLife, color, size } ],  // x,y in tile units
  shake: 0            // seconds of screen shake remaining
}
```

### Player

```js
{ x, y,               // integer tile position
  px, py,             // rendered position in tile units, tweens toward x,y
  hp, maxHp, hasKey: false, coins: 0,
  facing: { dx: 0, dy: 1 },
  hurtTimer: 0,       // > 0 means invulnerable (and should flash)
  attackTimer: 0 }    // > 0 for 0.15s after attacking (for a lunge animation)
```

### Enemy

```js
{ type, x, y, px, py, hp, maxHp, dmg, moveInterval, chaseRadius,
  moveTimer,          // counts down; acts at <= 0 then resets to moveInterval
  hurtTimer: 0,       // > 0 for 0.2s after being hit (flash)
  alive: true }
```

## Function contract

### Agent A

- `DE.generateLevel(floor)` returns a Level as above. Use `Math.random`.
- `DE.isWalkable(level, x, y)` returns true only if in bounds and the tile is FLOOR or SPIKES (WALL and DOOR are false).
- `DE.sfx(name)` plays a short synthesized WebAudio sound. Names: `step, hit, hurt, pickup, key, door, locked, death, win`. Creates the AudioContext lazily on first call, must never throw (wrap in try/catch, silently no-op if audio is unavailable or the name is unknown). `step` must be very quiet.

### Agent B (`js/entities.js`)

- `DE.createPlayer(level)` returns a Player at `level.start` with full HP.
- `DE.createEnemies(level)` returns an Enemy array from `level.enemySpawns` using `DE.CONFIG.ENEMY_TYPES`. Give each a random initial `moveTimer` between 0 and its `moveInterval`.
- `DE.addMessage(state, text)` pushes `{ text, ttl: 2.5 }`, keeping at most 4 messages.
- `DE.spikesActive(state)` returns `Math.floor(state.time) % 2 === 0`.
- `DE.revealFog(state)` marks `level.seen` true for tiles within `SIGHT_RADIUS` (Euclidean) of the player.
- `DE.spawnParticles(state, x, y, color, count)` adds burst particles at tile centre.
- `DE.tryMovePlayer(state, dx, dy)` performs one player step and returns one of:
  - `'attack'` — a live enemy was on the target tile; it took `PLAYER_DAMAGE`; sets `attackTimer`, enemy `hurtTimer`, particles, `sfx('hit')`. If it died: `alive = false`, score += SCORE_KILL.
  - `'exit'` — target is the DOOR and the player has the key. Plays `sfx('door')`. Does NOT change floors; main.js does that.
  - `'locked'` — target is the DOOR without the key; message "The door is locked", `sfx('locked')`.
  - `'blocked'` — wall or out of bounds.
  - `'moved'` — player moved; picks up any untaken item on the new tile (key: `hasKey = true`, message "You found the key!", `sfx('key')`; potion: heal, `sfx('pickup')`; coin: `coins++`, score += SCORE_COIN, `sfx('pickup')`), then calls `DE.revealFog`.
  Always updates `player.facing`.
- `DE.updateEntities(state, dt)` called every frame while playing. It: tweens player and enemy `px,py` toward `x,y` at `TWEEN_SPEED`; counts down all timers, `state.shake`, message `ttl` (removing expired), and particles (removing dead); runs enemy AI; applies spike damage; removes dead enemies. Enemy AI on each action: if `chaseRadius > 0` and the player is within it (Manhattan), step one tile toward the player along the axis with the larger distance (falling back to the other axis if blocked), otherwise step in a random direction. Enemies only enter tiles where `DE.isWalkable` is true and no other live enemy stands. If the chosen tile is the player's tile, attack instead of moving.
- Damage to the player (enemy or spikes) is ignored while `hurtTimer > 0`; otherwise hp -= dmg, `hurtTimer = INVULN_TIME`, `state.shake = 0.25`, red particles, `sfx('hurt')`. If hp <= 0: `state.screen = 'gameover'`, `sfx('death')`.

### Agent C (`js/render.js`)

- `DE.render(ctx, state)` draws one frame of the world onto the 800x576 canvas: clear to black, camera centred on the player's `px,py` and clamped to the level bounds, apply screen shake, draw tiles, items, enemies, player, particles, then fog. It draws nothing if `state.level` is missing. It does NOT draw HUD text, messages or menus (those are DOM, owned by Agent D).
- Everything is drawn with canvas primitives, no image files. Aim for a cohesive pixel-art-like look: stone walls with a lighter top edge and some brick detail, floor tiles with subtle per-tile variation (derive it from x,y so it is stable, never from `Math.random` per frame), a wooden door with a lock (shown open-ish or glowing when the player has the key), spikes clearly different when active vs retracted (use `DE.spikesActive(state)`), a bobbing golden key, a red potion, spinning or shimmering coins, distinct enemies (green slime that squishes, purple bat that flaps, bone-white skeleton), a hero with visible facing direction, a lunge offset while `attackTimer > 0`, flashing while `hurtTimer > 0`, white flash on enemies while their `hurtTimer > 0`, small HP pips over damaged enemies.
- Fog: unseen tiles are solid black; seen tiles outside the current sight radius are dimmed (about 55% black); tiles in sight are lit with a soft radial falloff around the player. Enemies and items are only drawn when within the current sight radius.
- Use `performance.now()` for idle animations. Only draw tiles that are on screen.

### Agent D (`index.html`, `style.css`, `js/main.js`)

- Page: dark themed, centred game frame containing `<canvas id="game" width="800" height="576">`, a HUD bar (hearts for HP, floor n/5, key indicator, coins, time mm:ss, score), a message log overlaid at the bottom of the canvas, and a full-canvas overlay used for title, pause, game over and win screens. Scales down to fit small windows (CSS only, keep the canvas internal size 800x576, use `image-rendering: pixelated`). Show the controls somewhere under the frame.
- `main.js` exposes `DE.state`, `DE.newGame()`, `DE.startFloor(n)`.
  - `newGame`: fresh state, score 0, time 0, then `startFloor(1)` and screen `'playing'`.
  - `startFloor(n)`: `level = DE.generateLevel(n)`; on floor 1 create a new player with `DE.createPlayer(level)`; on later floors keep hp, maxHp and coins but move the player to `level.start` (set x, y, px, py) and set `hasKey = false`; `enemies = DE.createEnemies(level)`; clear particles; call `DE.revealFog(state)`; message "Floor n".
  - Input: arrows and WASD move (track held keys; most recently pressed direction wins; step immediately on keydown, then every `PLAYER_MOVE_DELAY` while held). Enter or Space starts from title and restarts from gameover/win. P or Escape toggles pause. `preventDefault` on arrows and space so the page does not scroll.
  - On `tryMovePlayer` returning `'exit'`: score += SCORE_FLOOR; if floor is `FLOORS`, screen = `'win'` and `sfx('win')`; else `startFloor(floor + 1)`.
  - Loop with `requestAnimationFrame`, dt clamped to 0.05s. While playing: advance `state.time`, handle held-key movement, `DE.updateEntities(state, dt)`. Always call `DE.render(ctx, state)` and refresh the HUD/overlay DOM (only write to the DOM when a value changed).
  - Detect `screen` becoming `'gameover'` (set by entities.js) and show the overlay with final score, floor reached and time. Win overlay shows score and time.
  - Keep a best score in `localStorage` inside try/catch and show it on the title and end screens.

## Verification each agent must do

- Run `node --check` on every JS file you wrote.
- Agents A and B: also write a throwaway Node test (set `globalThis.window = globalThis` first, then `require` the files you need) that exercises your functions, run it, fix failures, then delete the test file. Agent A must flood-fill 50 generated levels per floor to prove the reachability guarantees.
- Final report: files written, anything in the contract you had to interpret, anything left unfinished.

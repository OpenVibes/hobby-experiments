window.DE = window.DE || {};

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

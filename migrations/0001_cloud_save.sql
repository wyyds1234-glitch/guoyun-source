PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_saves (
  player_id TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT 'primary',
  game_version INTEGER NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  client_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ruler TEXT NOT NULL,
  kingdom TEXT NOT NULL,
  world_year INTEGER NOT NULL,
  world_month INTEGER NOT NULL,
  world_day INTEGER NOT NULL,
  gold INTEGER NOT NULL DEFAULT 0,
  grain INTEGER NOT NULL DEFAULT 0,
  population INTEGER NOT NULL DEFAULT 0,
  prestige INTEGER NOT NULL DEFAULT 0,
  province_count INTEGER NOT NULL DEFAULT 0,
  troop_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, slot),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_saves_rank
  ON game_saves (province_count DESC, prestige DESC, troop_count DESC);

CREATE INDEX IF NOT EXISTS idx_game_saves_updated
  ON game_saves (updated_at DESC);

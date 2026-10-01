PRAGMA foreign_keys = ON;

-- Keep the original migration append-only. These fields make the static map
-- package and optimistic save revision explicit without putting GeoJSON in a
-- player save.
ALTER TABLE game_saves ADD COLUMN map_version TEXT NOT NULL DEFAULT 'tang741-v1';
ALTER TABLE game_saves ADD COLUMN save_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  save_slot TEXT NOT NULL DEFAULT 'primary',
  map_version TEXT NOT NULL DEFAULT 'tang741-v1',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_player
  ON game_sessions (player_id, updated_at DESC);

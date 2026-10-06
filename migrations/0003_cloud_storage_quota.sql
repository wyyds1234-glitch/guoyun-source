PRAGMA foreign_keys = ON;

-- D1 Free storage is account-wide. Keep each configured game database below
-- 1.8 GiB so production and preview together leave room for other D1 data,
-- SQLite indexes, and database overhead. Row limits bound small-save churn.
CREATE TABLE IF NOT EXISTS game_storage_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  player_count INTEGER NOT NULL CHECK (player_count >= 0),
  save_count INTEGER NOT NULL CHECK (save_count >= 0),
  save_bytes INTEGER NOT NULL CHECK (save_bytes >= 0),
  max_players INTEGER NOT NULL CHECK (max_players > 0),
  max_saves INTEGER NOT NULL CHECK (max_saves > 0),
  max_save_bytes INTEGER NOT NULL CHECK (max_save_bytes > 0)
);

INSERT OR IGNORE INTO game_storage_limits (
  id, player_count, save_count, save_bytes, max_players, max_saves, max_save_bytes
)
SELECT 1,
  (SELECT COUNT(*) FROM players),
  (SELECT COUNT(*) FROM game_saves),
  (SELECT COALESCE(SUM(length(CAST(state_json AS BLOB))), 0) FROM game_saves),
  50000, 50000, 1932735283;

CREATE TRIGGER IF NOT EXISTS game_players_quota_before_insert
BEFORE INSERT ON players
WHEN NOT EXISTS (SELECT 1 FROM players WHERE id = NEW.id)
 AND (SELECT player_count >= max_players FROM game_storage_limits WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'game_player_quota_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS game_players_quota_after_insert
AFTER INSERT ON players
BEGIN
  UPDATE game_storage_limits SET player_count = player_count + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS game_players_quota_after_delete
AFTER DELETE ON players
BEGIN
  UPDATE game_storage_limits SET player_count = player_count - 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS game_saves_quota_before_insert
BEFORE INSERT ON game_saves
WHEN NOT EXISTS (SELECT 1 FROM game_saves WHERE player_id = NEW.player_id AND slot = NEW.slot)
 AND (
   (SELECT save_count >= max_saves FROM game_storage_limits WHERE id = 1)
   OR (SELECT save_bytes + length(CAST(NEW.state_json AS BLOB)) > max_save_bytes
       FROM game_storage_limits WHERE id = 1)
 )
BEGIN
  SELECT RAISE(ABORT, 'game_save_quota_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS game_saves_quota_before_update
BEFORE UPDATE OF state_json ON game_saves
WHEN (SELECT save_bytes - length(CAST(OLD.state_json AS BLOB))
                   + length(CAST(NEW.state_json AS BLOB)) > max_save_bytes
      FROM game_storage_limits WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'game_save_quota_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS game_saves_quota_after_insert
AFTER INSERT ON game_saves
BEGIN
  UPDATE game_storage_limits SET save_count = save_count + 1,
    save_bytes = save_bytes + length(CAST(NEW.state_json AS BLOB)) WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS game_saves_quota_after_update
AFTER UPDATE OF state_json ON game_saves
BEGIN
  UPDATE game_storage_limits SET save_bytes = save_bytes - length(CAST(OLD.state_json AS BLOB))
    + length(CAST(NEW.state_json AS BLOB)) WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS game_saves_quota_after_delete
AFTER DELETE ON game_saves
BEGIN
  UPDATE game_storage_limits SET save_count = save_count - 1,
    save_bytes = save_bytes - length(CAST(OLD.state_json AS BLOB)) WHERE id = 1;
END;

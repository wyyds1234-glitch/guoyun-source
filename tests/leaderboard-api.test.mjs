import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/leaderboard.js";

test("leaderboard endpoint is disabled without reading either database", async () => {
  const env = {
    GAME_DB: { prepare() { assert.fail("disabled endpoint must not read player saves"); } },
    LEADERBOARD_DB: { prepare() { assert.fail("disabled endpoint must not read ranking data"); } },
  };
  const response = await onRequestGet({ env });

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "leaderboard_disabled", message: "排行榜功能已停用。" },
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequestDelete, onRequestPut } from "../functions/api/save.js";

function database() {
  const sql = new DatabaseSync(":memory:");
  for (const name of ["0001_cloud_save.sql", "0002_cloud_sessions_and_versions.sql", "0003_cloud_storage_quota.sql"]) {
    sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const db = {
    prepare(query) {
      return { bind(...values) {
        const params = Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
        return {
          async first() { return sql.prepare(query).get(params) || null; },
          async run() { return sql.prepare(query).run(params); },
          execute() { return { results: sql.prepare(query).all(params), success: true }; },
        };
      } };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sql, db };
}

function request(code, state, expectedRevision = null, method = "PUT") {
  return new Request("https://game.test/api/save", {
    method,
    headers: { authorization: `Bearer ${code}` },
    ...(method === "PUT" ? { body: JSON.stringify({ expectedRevision, state }) } : {}),
  });
}

test("database quota blocks rotating identities and oversized writes while allowing existing saves to update", async () => {
  const { sql, db } = database();
  const firstCode = "TX-ABCDEFGH-JKMNPQRS-TUVWXYZ2-3456789A";
  const secondCode = "TX-BCDEFGHJ-KMNPQRST-UVWXYZ23-456789AB";
  const initial = {
    version: 5, ruler: "玄宗", kingdom: "唐", calendar: { year: 741, month: 1, day: 1 },
    gold: 850, provinces: {}, regions: {}, padding: "",
  };
  try {
    sql.prepare(`UPDATE game_storage_limits
      SET max_players = 1, max_saves = 1,
          max_save_bytes = length(CAST(? AS BLOB)) WHERE id = 1`).run(JSON.stringify(initial));

    const created = await onRequestPut({ request: request(firstCode, initial), env: { GAME_DB: db } });
    assert.equal(created.status, 200);
    assert.deepEqual({ ...sql.prepare("SELECT player_count, save_count, save_bytes FROM game_storage_limits").get() }, {
      player_count: 1, save_count: 1, save_bytes: Buffer.byteLength(JSON.stringify(initial)),
    });

    const updated = await onRequestPut({ request: request(firstCode, { ...initial, gold: 851 }, 1), env: { GAME_DB: db } });
    assert.equal(updated.status, 200, "existing identity may update its current slot at full quota");

    const tooLarge = await onRequestPut({ request: request(firstCode, { ...initial, padding: "x" }, 2), env: { GAME_DB: db } });
    assert.equal(tooLarge.status, 507);
    assert.equal((await tooLarge.json()).error.code, "save_storage_full");
    assert.equal(sql.prepare("SELECT revision FROM game_saves").get().revision, 2, "rejected updates leave the prior save intact");

    const newIdentity = await onRequestPut({ request: request(secondCode, initial), env: { GAME_DB: db } });
    assert.equal(newIdentity.status, 507);
    assert.equal((await newIdentity.json()).error.code, "save_storage_full");
    assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM players").get().count, 1, "failed batch rolls back the attempted player row");

    assert.equal((await onRequestDelete({ request: request(firstCode, null, null, "DELETE"), env: { GAME_DB: db } })).status, 200);
    assert.deepEqual({ ...sql.prepare("SELECT player_count, save_count, save_bytes FROM game_storage_limits").get() }, {
      player_count: 1, save_count: 0, save_bytes: 0,
    });
    const reusedIdentity = await onRequestPut({ request: request(secondCode, initial), env: { GAME_DB: db } });
    assert.equal(reusedIdentity.status, 507, "deleted saves do not make rotating identities an unlimited allocator");
  } finally {
    sql.close();
  }
});

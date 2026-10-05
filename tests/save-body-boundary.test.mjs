import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAccessCode } from "../functions/_shared/auth.js";
import { MAX_SAVE_BYTES } from "../functions/_shared/save.js";
import { onRequestPut } from "../functions/api/save.js";
import { onRequestPost as createGame } from "../functions/api/game/new.js";
import { onRequestPost as saveCollection } from "../functions/api/game/saves.js";

const routes = [
  { path: "/api/save", method: "PUT", handle: onRequestPut },
  { path: "/api/game/new", method: "POST", handle: createGame },
  { path: "/api/game/saves", method: "POST", handle: saveCollection },
];
const encode = (text) => new TextEncoder().encode(text);
const noDatabase = { prepare() { assert.fail("rejected input must not reach D1"); } };
let nextIp = 1;

function streamedRequest(route, chunks, options = {}) {
  const observed = { pulls: 0, bytes: 0, cancels: 0 };
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      observed.pulls += 1;
      if (options.readError) return controller.error(new Error("disconnected"));
      if (index === chunks.length) return controller.close();
      const chunk = chunks[index++];
      observed.bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      observed.cancels += 1;
      if (options.cancelError) throw new Error("cancellation failed");
      if (options.cancelPending) return new Promise(() => {});
    },
  }, { highWaterMark: 0 });
  const headers = {
    authorization: `Bearer ${options.code || createAccessCode()}`,
    "content-type": "application/json",
    "cf-connecting-ip": options.ip || `203.0.113.${nextIp++}`,
    origin: "https://tianxia-ddr.pages.dev",
    ...options.headers,
  };
  if (options.noAuth) delete headers.authorization;
  const request = new Request(`https://game.test${route.path}`, {
    method: route.method, headers, body: stream, duplex: "half",
  });
  return { request, observed };
}

function database() {
  const sql = new DatabaseSync(":memory:");
  for (const name of ["0001_cloud_save.sql", "0002_cloud_sessions_and_versions.sql"]) {
    sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const db = {
    prepare(query) {
      return { bind(...values) {
        const params = Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
        return {
          async first() { return sql.prepare(query).get(params) || null; },
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

function validBody(expectedRevision = null) {
  return JSON.stringify({ expectedRevision, state: {
    version: 5, ruler: "玄宗", kingdom: "唐", calendar: { year: 741, month: 1, day: 1 },
    provinces: {}, regions: {}, armies: {}, logs: [], padding: "",
  } });
}

for (const route of routes) {
  test(`${route.path}: missing or invalid auth leaves the body unread`, async () => {
    for (const options of [{ noAuth: true }, { headers: { authorization: "Bearer invalid" } }]) {
      const { request, observed } = streamedRequest(route, [new Uint8Array(MAX_SAVE_BYTES + 1)], options);
      const response = await route.handle({ request, env: { GAME_DB: noDatabase } });
      assert.equal(response.status, 401);
      assert.equal(observed.pulls, 0);
    }
  });

  test(`${route.path}: rate rejection leaves the body unread`, async () => {
    const code = createAccessCode();
    const ip = `198.51.100.${nextIp++}`;
    let rejected;
    for (let count = 0; count <= 120; count += 1) {
      const probe = streamedRequest(route, [encode("{")], { code, ip });
      const response = await route.handle({ request: probe.request, env: { GAME_DB: noDatabase } });
      if (response.status === 429) { rejected = probe.observed; break; }
      assert.equal(response.status, 400);
    }
    assert.ok(rejected, "configured request limit must be reached");
    assert.equal(rejected.pulls, 0);
  });

  test(`${route.path}: excessive declared length is rejected before reading`, async () => {
    const { request, observed } = streamedRequest(route, [encode("{}")], {
      headers: { "content-length": String(MAX_SAVE_BYTES + 1) },
    });
    assert.equal((await route.handle({ request, env: { GAME_DB: noDatabase } })).status, 413);
    assert.equal(observed.pulls, 0);
  });

  test(`${route.path}: omitted, understated or nonnumeric length cannot bypass the stream limit`, async () => {
    for (const headers of [{}, { "content-length": "1" }, { "content-length": "invalid" }]) {
      for (const chunks of [
        [new Uint8Array(MAX_SAVE_BYTES + 1), new Uint8Array(32)],
        [new Uint8Array(MAX_SAVE_BYTES), new Uint8Array(1), new Uint8Array(32)],
      ]) {
        const { request, observed } = streamedRequest(route, chunks, { headers });
        const response = await route.handle({ request, env: { GAME_DB: noDatabase } });
        assert.equal(response.status, 413);
        assert.equal((await response.json()).error.code, "save_too_large");
        assert.equal(observed.bytes, MAX_SAVE_BYTES + 1);
        assert.equal(observed.pulls, chunks.length - 1, "tail must remain unread");
        assert.equal(observed.cancels, 1);
      }
    }
  });

  test(`${route.path}: cancellation failure or delay does not change the 413 response`, async () => {
    for (const options of [{ cancelError: true }, { cancelPending: true }]) {
      const { request, observed } = streamedRequest(route, [new Uint8Array(MAX_SAVE_BYTES + 1)], options);
      let timer;
      try {
        const response = await Promise.race([
          route.handle({ request, env: { GAME_DB: noDatabase } }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("overflow response waited for cancellation")), 1000); }),
        ]);
        assert.equal(response.status, 413);
        assert.equal(observed.cancels, 1);
      } finally { clearTimeout(timer); }
    }
  });

  test(`${route.path}: valid 512KiB save with split UTF-8 preserves creation, updates and conflicts`, async () => {
    const code = createAccessCode();
    const base = validBody();
    const body = base.replace('"padding":""', `"padding":"${"x".repeat(MAX_SAVE_BYTES - encode(base).byteLength)}"`);
    const bytes = encode(body);
    assert.equal(bytes.byteLength, MAX_SAVE_BYTES);
    const split = encode(body.slice(0, body.indexOf("玄"))).byteLength + 1;
    const { sql, db } = database();
    try {
      const first = streamedRequest(route, [new Uint8Array(0), bytes.subarray(0, split), bytes.subarray(split)], { code });
      const created = await route.handle({ request: first.request, env: { GAME_DB: db } });
      assert.equal(created.status, 200);
      assert.equal((await created.json()).revision, 1);
      const updated = streamedRequest(route, [encode(validBody(1))], { code });
      assert.equal((await route.handle({ request: updated.request, env: { GAME_DB: db } })).status, 200);
      const stale = streamedRequest(route, [encode(validBody(1))], { code });
      const conflict = await route.handle({ request: stale.request, env: { GAME_DB: db } });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.headers.get("x-save-revision"), "2");
      const row = sql.prepare("SELECT revision, state_json FROM game_saves").get();
      assert.equal(row.revision, 2);
      assert.equal(JSON.parse(row.state_json).ruler, "玄宗");
      assert.equal(first.observed.cancels, 0);
    } finally { sql.close(); }
  });

  test(`${route.path}: empty, malformed, invalid UTF-8 and disconnected bodies return controlled errors`, async () => {
    const malformedUtf8 = encode(validBody().replace("玄宗", "a"));
    malformedUtf8[encode(validBody().slice(0, validBody().indexOf("玄"))).byteLength] = 0xff;
    for (const [chunks, options] of [
      [[], {}], [[encode("{")], {}], [[malformedUtf8], {}], [[], { readError: true }],
    ]) {
      const { request } = streamedRequest(route, chunks, options);
      const response = await route.handle({ request, env: { GAME_DB: noDatabase } });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "invalid_save");
      assert.equal(response.headers.get("access-control-allow-origin"), "https://tianxia-ddr.pages.dev");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
  });
}

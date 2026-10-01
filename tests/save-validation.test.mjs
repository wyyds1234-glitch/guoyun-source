import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAccessCode } from "../functions/_shared/auth.js";
import { parseSaveBody } from "../functions/_shared/save.js";

test("normalizes a cloud access code", () => {
  const code = normalizeAccessCode("tx-abcdefgh-jkmnpqrs-tuvwxyz2-3456789a");
  assert.equal(code, "TX-ABCDEFGH-JKMNPQRS-TUVWXYZ2-3456789A");
});

test("accepts a bounded version 5 save", () => {
  const result = parseSaveBody(JSON.stringify({
    state: {
      version: 5,
      ruler: "昭明",
      kingdom: "大晟",
      calendar: { year: 189, month: 1, day: 1 },
      gold: 850,
      grain: 900,
      population: 4200,
      prestige: 12,
      provinces: { si: { owner: "player" } },
      regions: { luoyang: { owner: "player" } },
      armies: { tiger: { infantry: 390, archers: 90, cavalry: 30 } },
    },
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.value.summary.provinceCount, 1);
  assert.equal(result.value.summary.troopCount, 510);
});

test("carries an optimistic cloud revision without accepting invalid versions", () => {
  const result = parseSaveBody(JSON.stringify({
    expectedRevision: 7,
    state: {
      version: 5,
      ruler: "昭明",
      kingdom: "大晟",
      calendar: { year: 741, month: 1, day: 1 },
      provinces: { si: { owner: "player" } },
      regions: { changan: { owner: "player" } },
    },
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.value.expectedRevision, 7);
  assert.match(parseSaveBody(JSON.stringify({ expectedRevision: "bad", state: { version: 5, provinces: {}, regions: {} } })).error, /版本号/);
});

test("rejects an incompatible save", () => {
  const result = parseSaveBody(JSON.stringify({ state: { version: 4, provinces: {}, regions: {} } }));
  assert.match(result.error, /版本/);
});

test("rejects save-derived text with unsafe types or excessive length", () => {
  const base = {
    version: 5,
    ruler: "玄宗",
    kingdom: "大唐",
    provinces: { jingji: { owner: "player" } },
    regions: { changan: { owner: "player" } },
    armies: { tiger: { name: "神策第一军", commander: "郭子仪", infantry: 10, archers: 0, cavalry: 0 } },
    logs: [],
    enemyCampaigns: {},
  };
  assert.match(parseSaveBody(JSON.stringify({ state: { ...base, ruler: 123 } })).error, /文字字段/);
  assert.match(parseSaveBody(JSON.stringify({ state: { ...base, armies: { tiger: { ...base.armies.tiger, name: "x".repeat(81) } } } })).error, /军团文字字段/);
  assert.match(parseSaveBody(JSON.stringify({ state: { ...base, logs: [{ type: "war", date: "天宝", text: "x".repeat(601) }] } })).error, /日志文字字段/);
});

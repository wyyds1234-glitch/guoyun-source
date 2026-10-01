import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const game = await readFile(new URL("../public/game.js", import.meta.url), "utf8");

test("legacy Shence army name is corrected at render time without mutating saves", () => {
  assert.match(game, /const armyDisplayName = \(army\) => army\?\.name === "神策第一军" \? "彍骑第一军"/);
  assert.match(game, /function renderArmy\([\s\S]*?armyDisplayName\(army\)/);
  assert.match(game, /function renderBattlePlanPanel\([\s\S]*?armyDisplayName\(army\)/);
  assert.match(game, /function renderLogs\([\s\S]*?historicalDisplayText\(entry\.text\)/);
  assert.doesNotMatch(game, /army\.name\s*=/);
  assert.doesNotMatch(game, /state\.armies\[[^\]]+\]\.name\s*=/);
});

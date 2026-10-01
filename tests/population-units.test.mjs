import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const game = await readFile(new URL("../public/game.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/play/index.html", import.meta.url), "utf8");

test("population is presented as an abstract index and grows at a restrained monthly rate", () => {
  const start = game.indexOf("  function getIncome(");
  const end = game.indexOf("  function calculateMonthlyBalance(", start);
  const state = { season: 0, morale: 68, marketLevel: 1, provinces: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${i}`, { prosperity: 80, farms: 1 }])) };
  const context = vm.createContext({
    state,
    ownedProvinces: () => Object.keys(state.provinces),
    SEASONS: [{ gold: 1, grain: 1 }],
    getUpkeep: () => 100,
    Math,
  });
  vm.runInContext(game.slice(start, end), context);
  assert.equal(context.getIncome().population, 8);
  assert.match(html, /人口规模点数，并非历史人口统计/);
  assert.match(game, /人口规模增 \$\{fmt\(income\.population\)\} 点/);
});

test("initial recruitment population cost matches the 200-person starting formation", () => {
  assert.match(game, /NEW_ARMY_COST = Object\.freeze\(\{ gold: 260, grain: 180, population: 200 \}\)/);
  assert.match(game, /infantry: 160,\s*archers: 30,\s*cavalry: 10/);
  assert.match(html, /200 人口点[^<]*<br>初编 160 步卒 · 30 弓手 · 10 骑兵（共 200 人）/);
  assert.doesNotMatch(html, /220 人口/);
});

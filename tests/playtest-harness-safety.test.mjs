import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/playtest-flow.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("full-playtest entry point is discoverable and uses a clean browser context", () => {
  assert.equal(packageJson.scripts["qa:playtest"], "node scripts/playtest-flow.mjs");
  assert.match(script, /browser\.newContext\(\{viewport/);
  assert.match(script, /assert\.equal\(initialStorage\.origins\.length,0\)/);
  assert.match(script, /refuse to operate an existing campaign/);
});

test("playtest removes only its generated cloud save code, including after failure", () => {
  assert.match(script, /qaCloudAccessCodes\.add\(cloudPreflight\.accessCode\)/);
  assert.match(script, /qaCloudAccessCodes\.add\(await tab\.evaluate/);
  assert.ok(script.indexOf('await browser.close();') < script.indexOf("method:'DELETE'"),'close browsers before deleting QA slots so autosave cannot recreate them');
  assert.match(script, /finally\{[\s\S]*?method:'DELETE'[\s\S]*?Bearer \$\{qaCloudAccessCode\}/);
  assert.doesNotMatch(script, /report\.(?:accessCode|qaCloudAccessCode)/);
});

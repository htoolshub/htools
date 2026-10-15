import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?umami-settings=1`);

test.after(async () => {
  await compiledShared.cleanup();
});

test("Umami script URLs accept only normalized HTTP(S) addresses", () => {
  assert.equal(
    shared.normalizeUmamiScriptUrl("  https://analytics.example.com/script.js  "),
    "https://analytics.example.com/script.js"
  );
  assert.equal(
    shared.normalizeUmamiScriptUrl("http://localhost:3000/script.js"),
    "http://localhost:3000/script.js"
  );
  assert.equal(shared.normalizeUmamiScriptUrl("javascript:alert(1)"), "");
  assert.equal(shared.normalizeUmamiScriptUrl("data:text/javascript,alert(1)"), "");
  assert.equal(shared.normalizeUmamiScriptUrl("not a URL"), "");
});

test("Umami Website ID normalization trims input and enforces its bound", () => {
  assert.equal(shared.normalizeUmamiWebsiteId("  website-id  "), "website-id");
  assert.equal(shared.normalizeUmamiWebsiteId("x".repeat(250)).length, 200);
});

test("Umami admin writes invalidate the public site configuration", async () => {
  const adminEndpoint = await readFile(
    new URL("../../functions/api/admin/umami-settings.ts", import.meta.url),
    "utf8"
  );
  const siteSettingsEndpoint = await readFile(
    new URL("../../functions/api/site-settings.ts", import.meta.url),
    "utf8"
  );
  const sharedSource = await readFile(
    new URL("../../functions/_shared.ts", import.meta.url),
    "utf8"
  );

  assert.match(adminEndpoint, /requireAdmin\(request, env\)/);
  assert.match(adminEndpoint, /saveUmamiSettings\(env, payload\)/);
  assert.match(adminEndpoint, /invalidatePublicApiCache\(env\)/);
  assert.match(siteSettingsEndpoint, /getUmamiSettings/);
  assert.match(siteSettingsEndpoint, /Promise\.all/);
  assert.match(siteSettingsEndpoint, /umami: umamiSettings\.enabled/);
  assert.doesNotMatch(sharedSource, /umamiSettings: "umami-settings/);
  assert.match(sharedSource, /parsed\.enabled === true && Boolean\(scriptUrl && websiteId\)/);
  assert.match(sharedSource, /enabled && \(!scriptUrl \|\| !websiteId\)/);
});

test("public pages load the native Umami script from the existing site request", async () => {
  const app = await readFile(new URL("../../src/App.tsx", import.meta.url), "utf8");
  const publicApi = await readFile(
    new URL("../../src/public-api.ts", import.meta.url),
    "utf8"
  );

  assert.match(app, /loadSiteConfiguration/);
  assert.match(app, /!umamiSettings\.enabled/);
  assert.match(app, /script\.src = umamiSettings\.scriptUrl/);
  assert.match(app, /script\.dataset\.websiteId = umamiSettings\.websiteId/);
  assert.match(app, /script\.dataset\.htoolsUmami = "true"/);
  assert.match(app, /document\.querySelectorAll\(UMAMI_SCRIPT_SELECTOR\)/);
  assert.match(app, /script\.remove\(\)/);
  assert.doesNotMatch(app, /components\/UmamiAnalytics/);
  assert.match(publicApi, /loadSiteConfiguration/);
  assert.doesNotMatch(publicApi, /\/api\/umami-settings/);
});

test("complete backups include safe service configuration", async () => {
  const backup = await readFile(
    new URL("../../functions/api/admin/backup.ts", import.meta.url),
    "utf8"
  );

  assert.match(backup, /const SAFE_SETTING_KEYS = \[[\s\S]*"umami_settings"/);
  assert.match(backup, /const SAFE_SETTING_KEYS = \[[\s\S]*"github_settings"/);
  assert.match(backup, /const SAFE_SETTING_KEYS = \[[\s\S]*"image_bed_settings"/);
  assert.match(backup, /const SAFE_SETTING_KEYS = \[[\s\S]*"admin_turnstile_enabled"/);
  assert.match(backup, /SAFE_SETTING_KEYS\.map\(\(\) => "\?"\)\.join\(", "\)/);
  assert.match(backup, /WHERE key IN \(\$\{SAFE_SETTING_PLACEHOLDERS\}\)/);
  assert.match(backup, /\.bind\(\.\.\.SAFE_SETTING_KEYS\)/);
});

test("maintenance restores refresh complete Umami state without a public endpoint", async () => {
  const app = await readFile(new URL("../../src/App.tsx", import.meta.url), "utf8");
  const adminApp = await readFile(
    new URL("../../src/AdminApp.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = await readFile(
    new URL("../../src/admin-api.ts", import.meta.url),
    "utf8"
  );

  const umamiCard = await readFile(
    new URL("../../src/components/admin-settings/UmamiSettingsCard.tsx", import.meta.url),
    "utf8"
  );

  assert.match(adminApi, /loadSiteConfiguration/);
  assert.match(app, /onUmamiSettingsChange=\{setUmamiSettings\}/);
  assert.match(umamiCard, /function applySettings/);
  assert.match(umamiCard, /onSettingsChange\(normalized\)/);
  assert.match(adminApp, /onSettingsChange=\{onUmamiSettingsChange\}/);
  assert.match(
    umamiCard,
    /async function loadSettings\([\s\S]*loadUmamiSettings\(token, \{ signal \}\)[\s\S]*applySettings\(loaded\)/
  );
  assert.match(
    adminApp,
    /function refreshSettingsAfterMaintenance\(\)[\s\S]*loadSiteConfiguration\(\)[\s\S]*setSettingsReloadKey\(\(current\) => current \+ 1\)/
  );
  assert.match(
    adminApp,
    /const \[source, proxy, configuration, telegram, ai\] = await Promise\.all/
  );
  assert.match(adminApp, /reloadKey=\{settingsReloadKey\}/);
  assert.match(umamiCard, /\}, \[reloadKey, token\]\)/);
  assert.match(
    adminApp,
    /function factoryReset\(\)[\s\S]*await refreshSettingsAfterMaintenance\(\)/
  );
  assert.match(
    adminApp,
    /function restoreBackup\(\)[\s\S]*await refreshSettingsAfterMaintenance\(\)/
  );
});

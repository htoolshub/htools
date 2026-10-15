import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helpersSource = await readFile(
  new URL("../../src/site-helpers.ts", import.meta.url),
  "utf8"
);
const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const sharedSource = await readFile(
  new URL("../../functions/_shared.ts", import.meta.url),
  "utf8"
);

test("home hero helper keeps Chinese and English overrides independent", () => {
  assert.match(helpersSource, /getHomeHeroSettings\(settings: SiteSettings\)/);
  assert.match(helpersSource, /getHomeHeroSettings\(settings\)\[locale\]/);
  assert.match(helpersSource, /customContent\.titleTop\.trim\(\) \|\| t\.home\.titleTop/);
  assert.match(helpersSource, /customContent\.titleBottom\.trim\(\) \|\| t\.home\.titleBottom/);
  assert.match(helpersSource, /customContent\.description\.trim\(\) \|\| t\.home\.description/);
});

test("site settings expose an independent home PATCH card", () => {
  assert.match(adminSource, /onSubmit=\{saveHomeHeroForm\}/);
  assert.match(adminSource, /section: "home"/);
  assert.match(adminSource, /homeHeroDirty/);
  assert.match(adminSource, /resetHomeHeroSettings/);
  assert.match(adminSource, /homeChinese/);
  assert.match(adminSource, /homeEnglish/);
});

test("home hero fields display language defaults while preserving effective dirty checks", () => {
  assert.match(adminSource, /function getHomeHeroFormContent\(/);
  assert.match(adminSource, /titleTop: content\.titleTop \|\| defaults\.titleTop/);
  assert.match(adminSource, /titleBottom: content\.titleBottom \|\| defaults\.titleBottom/);
  assert.match(adminSource, /description: content\.description \|\| defaults\.description/);
  assert.match(adminSource, /JSON\.stringify\(homeHeroForm\) !== JSON\.stringify\(persistedHomeHeroForm\)/);
});

test("home settings are normalized and stored inside the existing site settings JSON", () => {
  assert.match(sharedSource, /homeHero: normalizeHomeHeroSettings\(value\.homeHero\)/);
  assert.match(sharedSource, /if \(payload\.section === "home"\)/);
  assert.match(sharedSource, /homeHero: payload\.homeHero/);
  assert.match(sharedSource, /titleTop: normalizeHomeHeroText/);
});

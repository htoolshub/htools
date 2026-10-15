import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDisplaySource, articleHelpersSource, adminAppSource] =
  await Promise.all([
    readFile(new URL("../../src/admin-display.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/article-helpers.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8")
  ]);

test("GitHub metadata labels use the explicit locale", () => {
  assert.match(
    adminDisplaySource,
    /getGitHubMetadataDetailText\(locale: Locale\)/
  );
  assert.match(adminDisplaySource, /const chinese = locale === "zh"/);
  assert.doesNotMatch(adminDisplaySource, /categories\.All/);
  assert.match(
    adminAppSource,
    /getGitHubMetadataDetailText\(locale\)/
  );
});

test("message locale detection uses the canonical translation object", () => {
  assert.match(articleHelpersSource, /return t === translations\.zh/);
  assert.doesNotMatch(articleHelpersSource, /categories\.All/);
});

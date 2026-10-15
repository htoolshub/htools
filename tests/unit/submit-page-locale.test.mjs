import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  submitSource,
  submitApiSource,
  appSource,
  checkSource,
  settingsSource,
  sharedSource,
  typeSource,
  zhSource,
  enSource
] = await Promise.all([
  read("../../src/SubmitPage.tsx"),
  read("../../src/submit-api.ts"),
  read("../../src/App.tsx"),
  read("../../functions/api/submission-check.ts"),
  read("../../functions/api/submission-settings.ts"),
  read("../../functions/_shared.ts"),
  read("../../src/i18n/type.ts"),
  read("../../src/i18n/zh.ts"),
  read("../../src/i18n/en.ts")
]);

const submitPageFields = [
  "settingsUnavailable",
  "alreadyListed",
  "checkFailed",
  "issueUrlFailed",
  "githubMetadataAction",
  "githubMetadataSuccess",
  "githubMetadataNotFound",
  "githubMetadataRateLimited",
  "githubMetadataFailed",
  "submitHint",
  "validationNameRequired",
  "validationNameTooLong",
  "validationUrlRequired",
  "validationUrlInvalid",
  "validationDescriptionRequired",
  "validationDescriptionTooLong",
  "validationCategoryRequired",
  "projectInfoTitle",
  "projectInfoDescription",
  "categoryDescription"
];

test("direct GitHub submission copy is defined for both locales", () => {
  for (const field of submitPageFields) {
    const definition = new RegExp(`\\b${field}:`);
    assert.match(typeSource, definition);
    assert.match(zhSource, definition);
    assert.match(enSource, definition);
    assert.match(submitSource, new RegExp(`t\\.submitPage\\.${field}\\b`));
  }
});

test("submission page loads with the public bundle and uses the shared toast", () => {
  assert.match(appSource, /import SubmitPageContent from "\.\/SubmitPage"/);
  assert.doesNotMatch(appSource, /lazy\(\(\) => import\("\.\/SubmitPage"\)\)/);
  assert.match(appSource, /notify=\{notify\}/);
  assert.doesNotMatch(appSource, /submit-route-fallback/);
});

test("public submission no longer signs users in or loads Turnstile", () => {
  for (const source of [submitSource, submitApiSource]) {
    assert.doesNotMatch(source, /GitHubAuthState|github\/login|github\/logout|github\/me/);
    assert.doesNotMatch(source, /Turnstile|turnstileToken|authState/);
  }
  assert.doesNotMatch(submitSource, /submit-status|viewExistingTool|issueNumber/);
  assert.match(submitSource, /className="primary-button submit-submit-button"/);
});

test("submission checks only the local tool database", () => {
  assert.match(checkSource, /SELECT url, demo_url FROM tools/);
  assert.match(checkSource, /getCanonicalSubmissionUrl/);
  assert.doesNotMatch(checkSource, /api\.github\.com|access_token|GITHUB_TOKEN/);
  assert.match(submitSource, /notify\(\{ message: t\.submitPage\.alreadyListed, tone: "info" \}\)/);
});

test("submission GitHub metadata stays browser-direct with safe automatic and forced manual refresh", () => {
  assert.match(submitSource, /<PublicGlowAction[\s\S]*?handleGitHubMetadata/);
  assert.match(submitSource, /loadBrowserGitHubMetadata\(sourceUrl, \{ forceRefresh \}\)/);
  assert.match(submitSource, /forceRefresh: false,[\s\S]*overwriteExisting: false/);
  assert.match(submitSource, /forceRefresh: true,[\s\S]*overwriteExisting: true/);
  assert.match(submitSource, /scheduleAutomaticProjectLookup\(event\.target\.value\)/);
  assert.match(submitSource, /window\.setTimeout\([\s\S]*runAutomaticProjectLookup\(sourceUrl\)[\s\S]*800/);
  assert.match(submitSource, /clearAutomaticLookupTimer\(\);[\s\S]*runAutomaticProjectLookup\(form\.url, true\)/);
  assert.match(submitSource, /pendingLookup\?\.url === normalizedUrl/);
  assert.match(submitSource, /GITHUB_REPOSITORY_SHORTHAND/);
  assert.match(submitSource, /shorthand\[2\]\.replace\(\/\\\.git\$\/i, ""\)/);
  assert.match(submitSource, /shouldApplyGitHubMetadataValue/);
  assert.match(submitSource, /metadata\.topics\.slice\(0, 8\)/);
  assert.match(submitSource, /localStorage\.removeItem\(LEGACY_SUBMISSION_DRAFT_KEY\)/);
  assert.doesNotMatch(submitSource, /localStorage\.setItem/);
  assert.doesNotMatch(submitSource, /lastAutomaticMetadataRepoRef/);
  assert.doesNotMatch(submitSource, /\/api\/admin\/github-metadata|GITHUB_TOKEN/);
});

test("submission placeholders use the public HTools repository and concise descriptions", () => {
  assert.match(zhSource, /例如 https:\/\/github\.com\/shaoyouvip\/htools 或 shaoyouvip\/htools/);
  assert.match(zhSource, /用 1-2 句话说明工具的主要功能和用途/);
  assert.doesNotMatch(zhSource, /帮助谁、带来什么结果/);
  assert.match(enSource, /https:\/\/github\.com\/shaoyouvip\/htools or shaoyouvip\/htools/);
  assert.doesNotMatch(enSource, /who it helps, and what result it creates/);
});

test("GitHub issue URL contains visible structured content without hidden markers", () => {
  assert.match(submitApiSource, /https:\/\/github\.com\/\$\{encodeURIComponent\(owner\)\}/);
  assert.match(submitApiSource, /searchParams\.set\("template"/);
  assert.match(submitApiSource, /searchParams\.set\("title"/);
  assert.match(submitApiSource, /searchParams\.set\("body"/);
  assert.doesNotMatch(submitApiSource, /htools-submission-url|<!--/);
});

test("public settings expose only the target repository", () => {
  assert.match(settingsSource, /owner: settings\.owner/);
  assert.match(settingsSource, /repo: settings\.repo/);
  assert.doesNotMatch(settingsSource, /clientId|clientSecret|callbackUrl|access_token/);
});

test("submission refreshes repository settings on return and immediately before navigation", () => {
  assert.match(submitSource, /window\.addEventListener\("focus", refreshWhenActive\)/);
  assert.match(submitSource, /document\.addEventListener\("visibilitychange", refreshWhenActive\)/);
  assert.match(submitSource, /const latestSettings = await refreshSubmissionSettings\(true\)/);
  assert.match(submitSource, /buildGitHubIssueUrl\(latestSettings,/);
});

test("legacy OAuth routes and persistent user sessions are removed", async () => {
  for (const path of [
    "../../functions/api/github/login.ts",
    "../../functions/api/github/callback.ts",
    "../../functions/api/github/me.ts",
    "../../functions/api/github/logout.ts",
    "../../functions/api/submissions.ts"
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)));
  }
  assert.doesNotMatch(sharedSource, /type GitHubSessionRow|access_token TEXT|public_repo/);
  assert.match(sharedSource, /DROP TABLE IF EXISTS github_sessions/);
  assert.match(sharedSource, /DROP TABLE IF EXISTS github_oauth_states/);
});

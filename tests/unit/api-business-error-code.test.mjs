import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("major API business failures return stable error codes", async () => {
  const [shared, submissionCheck, authLogin, security] = await Promise.all([
    read("../../functions/_shared.ts"),
    read("../../functions/api/submission-check.ts"),
    read("../../functions/api/auth/login.ts"),
    read("../../functions/api/admin/security.ts")
  ]);

  for (const code of ["INVALID_REQUEST", "INVALID_PASSWORD", "SERVER_ERROR"]) {
    assert.ok(shared.includes(`| "${code}"`) || shared.includes(`=\n  | "${code}"`));
  }
  assert.match(submissionCheck, /"INVALID_REQUEST"/);
  assert.match(submissionCheck, /"SERVER_ERROR"/);
  assert.match(authLogin, /"INVALID_PASSWORD"/);
  assert.match(security, /"INVALID_PASSWORD"/);
});

test("duplicate checks return only a boolean without exposing tool details", async () => {
  const submissionCheck = await read("../../functions/api/submission-check.ts");

  assert.match(submissionCheck, /return json\([\s\S]*?\{ exists \}/);
  assert.doesNotMatch(submissionCheck, /existingTool|tool\.name|tool\.url\s*[,}]/);
});

test("duplicate content sources return a stable conflict before fetching the feed", async () => {
  const source = await read("../../functions/api/admin/content-sources/index.ts");
  const duplicateCheck = source.indexOf("SELECT id FROM content_sources WHERE url = ?");
  const previewFetch = source.indexOf("const preview = await fetchFeedPreview");

  assert.ok(duplicateCheck >= 0 && duplicateCheck < previewFetch);
  assert.match(source, /Content source URL already exists\./);
  assert.match(source, /"CONFLICT"[\s\S]{0,60}status: 409/);
  assert.match(source, /UNIQUE constraint failed:\\s\*content_sources\\\.url/);
});

test("public duplicate checks bound request size, URL length and request frequency", async () => {
  const submissionCheck = await read("../../functions/api/submission-check.ts");

  assert.match(submissionCheck, /MAX_REQUEST_BODY_BYTES = 4 \* 1024/);
  assert.match(submissionCheck, /MAX_PROJECT_URL_LENGTH = 2048/);
  assert.match(submissionCheck, /RATE_LIMIT_MAX_REQUESTS = 30/);
  assert.match(submissionCheck, /"RATE_LIMITED"/);
  assert.match(submissionCheck, /status: 429/);
  assert.match(submissionCheck, /status: error\.status/);
  assert.match(submissionCheck, /JSON\.parse/);
});

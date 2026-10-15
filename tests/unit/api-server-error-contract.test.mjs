import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("read, export, and maintenance failures use SERVER_ERROR", async () => {
  const endpoints = [
    "../../functions/api/site-settings.ts",
    "../../functions/api/proxy-settings.ts",
    "../../functions/api/admin/tool-source.ts",
    "../../functions/api/admin/categories.ts",
    "../../functions/api/admin/source-settings.ts",
    "../../functions/api/admin/backup.ts",
    "../../functions/api/admin/factory-reset.ts"
  ];

  for (const path of endpoints) {
    const source = await read(path);
    assert.match(source, /jsonError\(message, "SERVER_ERROR", \{[\s\S]*?status: 500/);
  }
});

test("mixed endpoints retain INVALID_REQUEST for user-supplied writes", async () => {
  for (const path of [
    "../../functions/api/admin/categories.ts",
    "../../functions/api/admin/source-settings.ts"
  ]) {
    const source = await read(path);
    assert.match(source, /writeErrorResponse\(/);
  }

  const backup = await read("../../functions/api/admin/backup.ts");
  assert.match(backup, /badRequest\(message\)/);
  assert.match(backup, /MAX_BACKUP_BODY_BYTES = 10 \* 1024 \* 1024/);
  assert.match(backup, /normalizeBackupPayload\(await readLimitedJsonBody\(request\)\)/);
  assert.match(backup, /totalBytes > MAX_BACKUP_BODY_BYTES/);
  assert.match(backup, /const data = await readBackupData\(db\);\s+validateBackupIntegrity\(data\);\s+const counts = createBackupCounts\(data\)/);
  assert.match(backup, /validateBackupIntegrity\(normalized\)/);
  assert.match(backup, /assertUnique\(data\.tools, \(row\) => row\.id, "tool id"\)/);
  assert.match(backup, /assertUnique\(data\.articles, \(row\) => row\.slug, "article slug"\)/);
  assert.match(backup, /assertUnique\(data\.contentSources, \(row\) => row\.url, "content source url"\)/);
  assert.match(backup, /content item \$\{item\.id\} references a missing content source/);
  assert.match(backup, /article \$\{article\.id\} references a missing content item/);
  assert.match(backup, /article\.content_item_id !== item\.id/);
  assert.match(backup, /item\.article_id !== article\.id/);
  assert.doesNotMatch(backup, /row\.tool_id/);
  assert.doesNotMatch(backup, /row\.link_preview_enabled/);
});

test("full backup export validates database relationships before returning data", async () => {
  const backup = await read("../../functions/api/admin/backup.ts");
  assert.match(
    backup,
    /const data = await readBackupData\(db\);\s+validateBackupIntegrity\(data\);\s+const counts = createBackupCounts\(data\)/
  );
  assert.match(backup, /error instanceof BackupDataError/);
  assert.match(backup, /"BACKUP_DATA_INVALID"/);
});

test("bulk upload validation and D1 execution use different error classes", async () => {
  for (const path of [
    "../../functions/api/admin/backup.ts",
    "../../functions/api/admin/import-tools.ts"
  ]) {
    const source = await read(path);
    assert.match(source, /return badRequest\(message\)/);
    assert.match(source, /jsonError\(message, "SERVER_ERROR", \{ status: 500 \}\)/);
  }
});

test("content feed endpoints distinguish request, missing, upstream, and internal failures", async () => {
  const shared = await read("../../functions/_shared.ts");
  assert.match(shared, /error instanceof UpstreamServiceError/);
  assert.match(shared, /"SERVER_ERROR", \{ status: 502, headers \}/);
  assert.match(shared, /throw new InvalidRequestError\("Feed URL is not allowed\."\)/);

  for (const path of [
    "../../functions/api/admin/content-sources/preview.ts",
    "../../functions/api/admin/content-sources/[id]/sync.ts",
    "../../functions/api/admin/content-items/[id]/to-article.ts"
  ]) {
    const source = await read(path);
    assert.match(source, /writeErrorResponse\(/);
  }

  for (const path of [
    "../../functions/api/admin/content-sources/[id]/sync.ts",
    "../../functions/api/admin/content-items/[id]/to-article.ts"
  ]) {
    const source = await read(path);
    assert.match(source, /"NOT_FOUND", \{ status: 404 \}/);
  }
});

test("changing a content source URL clears items from the previous feed", async () => {
  const source = await read("../../functions/api/admin/content-sources/[id].ts");
  assert.match(source, /const urlChanged = payload\.url !== existing\.url/);
  assert.match(
    source,
    /if \(urlChanged\) \{[\s\S]*DELETE FROM content_items WHERE source_id = \?/
  );
});

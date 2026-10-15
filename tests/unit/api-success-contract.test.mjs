import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("shared success helpers distinguish actions from resource deletion", async () => {
  const shared = await read("../../functions/_shared.ts");

  assert.match(shared, /type ApiActionSuccess = \{\s*success: true;/);
  assert.match(shared, /export function jsonDeleted/);
  assert.match(shared, /success: true, deleted: true, resource, id/);
});

test("delete endpoints share the resource deletion contract", async () => {
  const endpoints = [
    ["../../functions/api/admin/tools/[id].ts", "tool"],
    ["../../functions/api/admin/articles/[id].ts", "article"],
    ["../../functions/api/admin/content-sources/[id].ts", "contentSource"]
  ];

  for (const [path, resource] of endpoints) {
    const source = await read(path);
    assert.match(source, new RegExp(`jsonDeleted\\("${resource}", id\\)`));
    assert.doesNotMatch(source, /json\(\{ ok: true \}\)/);
  }
});

test("create and update endpoints never return a successful null resource", async () => {
  const endpoints = [
    "../../functions/api/admin/tools/index.ts",
    "../../functions/api/admin/articles/index.ts",
    "../../functions/api/admin/articles/[id].ts",
    "../../functions/api/admin/content-sources/index.ts",
    "../../functions/api/admin/content-sources/[id].ts",
    "../../functions/api/admin/content-items/[id]/to-article.ts"
  ];

  for (const path of endpoints) {
    const source = await read(path);
    assert.doesNotMatch(source, /\?\s*\w+FromRow\([^)]*\)\s*:\s*null/);
    assert.match(source, /jsonError\([\s\S]*?"SERVER_ERROR"[\s\S]*?status:\s*500/);
  }
});

test("resource creation uses 201 while updates keep the default 200 response", async () => {
  const createEndpoints = [
    "../../functions/api/admin/tools/index.ts",
    "../../functions/api/admin/articles/index.ts",
    "../../functions/api/admin/content-sources/index.ts",
    "../../functions/api/admin/content-items/[id]/to-article.ts"
  ];

  for (const path of createEndpoints) {
    const source = await read(path);
    assert.match(source, /articleFromRow\(article\)|toolFromRow\(row\)|articleFromRow\(row\)|contentSourceFromRow\(row\)/);
    assert.match(source, /status:\s*201/);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("single-resource endpoints use the shared NOT_FOUND response", async () => {
  const endpoints = [
    "../../functions/api/admin/tools/[id].ts",
    "../../functions/api/admin/articles/[id].ts",
    "../../functions/api/admin/articles/preview/[slug].ts",
    "../../functions/api/admin/content-sources/[id].ts",
    "../../functions/api/admin/content-sources/[id]/sync.ts",
    "../../functions/api/admin/content-items/[id]/preview.ts",
    "../../functions/api/admin/content-items/[id]/to-article.ts"
  ];

  for (const path of endpoints) {
    const source = await read(path);
    assert.match(source, /jsonError\([^\n]+"NOT_FOUND", \{ status: 404 \}\)/);
    assert.doesNotMatch(source, /json\(\{ error: [^\n]+not found[^\n]+status: 404/i);
  }
});

test("resource deletion reports missing targets instead of false success", async () => {
  const endpoints = [
    "../../functions/api/admin/tools/[id].ts",
    "../../functions/api/admin/articles/[id].ts",
    "../../functions/api/admin/content-sources/[id].ts"
  ];

  for (const path of endpoints) {
    const source = await read(path);
    const deleteHandler = source.slice(source.indexOf("onRequestDelete"));
    assert.match(deleteHandler, /NOT_FOUND/);
    assert.match(deleteHandler, /jsonDeleted/);
  }
});

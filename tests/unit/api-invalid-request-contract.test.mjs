import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("core mutation endpoints share the INVALID_REQUEST helper", async () => {
  const endpoints = [
    "../../functions/api/admin/tools/index.ts",
    "../../functions/api/admin/tools/[id].ts",
    "../../functions/api/admin/articles/index.ts",
    "../../functions/api/admin/articles/[id].ts",
    "../../functions/api/admin/content-sources/index.ts",
    "../../functions/api/admin/content-sources/[id].ts",
    "../../functions/api/admin/content-sources/preview.ts",
    "../../functions/api/admin/content-sources/[id]/sync.ts",
    "../../functions/api/admin/content-items/[id]/to-article.ts"
  ];

  for (const path of endpoints) {
    const source = await read(path);
    assert.match(source, /(badRequest|writeErrorResponse)\(/);
    assert.doesNotMatch(source, /json\(\{ error:[\s\S]{0,100}status:\s*400/);
  }
});

test("write errors distinguish validation failures from server failures", async () => {
  const shared = await read("../../functions/_shared.ts");

  assert.match(shared, /error instanceof SyntaxError \|\| error instanceof InvalidRequestError/);
  assert.match(shared, /"INVALID_REQUEST", \{ status: 400, headers \}/);
  assert.match(shared, /"SERVER_ERROR", \{ status: 500, headers \}/);
});

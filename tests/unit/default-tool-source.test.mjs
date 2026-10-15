import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?default-source=1`);

after(() => compiledShared.cleanup());

test("the bundled default tool source is unique and fully importable", async () => {
  const source = JSON.parse(
    await readFile(new URL("../../public/htools.json", import.meta.url), "utf8")
  );

  assert.ok(Array.isArray(source));
  assert.equal(source.length, 157);

  const ids = new Set();
  const urls = new Set();
  for (const item of source) {
    const payload = shared.validateToolPayload(item);
    const normalizedUrl = payload.url.trim().replace(/\/+$/, "").toLowerCase();

    assert.equal(typeof item.updatedAt, "string");
    assert.ok(item.updatedAt.length > 0);
    assert.equal(typeof item.id, "string");
    assert.ok(item.id.length > 0);
    assert.equal(ids.has(item.id), false, `duplicate id: ${item.id}`);
    assert.equal(urls.has(normalizedUrl), false, `duplicate URL: ${payload.url}`);
    ids.add(item.id);
    urls.add(normalizedUrl);
  }
});

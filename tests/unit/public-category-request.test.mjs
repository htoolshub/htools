import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const client = await compileTypescriptModule(new URL("../../src/api-client.ts", import.meta.url));
const api = await compileTypescriptModule(new URL("../../src/public-api.ts", import.meta.url), {
  importReplacements: { "./api-client": client.url.href }
});
const { loadPublicCategoryData } = await import(api.url.href);
const data = {
  categories: [{ category: "Tools", total: 20, featured_total: 1 }],
  settings: { tools: ["Tools"], articles: [], push: [], content: [] }
};
after(async () => { await api.cleanup(); await client.cleanup(); });

test("category requests time out, support cancellation, and recover on retry", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  await assert.rejects(loadPublicCategoryData({ timeoutMs: 10 }), { code: "REQUEST_TIMEOUT" });
  const controller = new AbortController();
  const cancelled = loadPublicCategoryData({ signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });

  globalThis.fetch.mock.mockImplementation(async (url) => {
    assert.equal(url, "/api/categories");
    return Response.json(data);
  });
  assert.deepEqual(await loadPublicCategoryData(), data);
});

test("invalid category responses reject before reaching UI state and allow retry", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  fetch.mock.mockImplementation(async () => new Response("<html>Unavailable</html>"));
  await assert.rejects(loadPublicCategoryData(), SyntaxError);

  for (const invalid of [
    null,
    {},
    { categories: data.categories },
    { settings: data.settings },
    { ...data, categories: [null] },
    { ...data, categories: [{ category: {}, total: 1, featured_total: 0 }] },
    { ...data, categories: [{ category: "Tools", total: -1, featured_total: 0 }] },
    { ...data, settings: { ...data.settings, tools: [null] } }
  ]) {
    fetch.mock.mockImplementation(async () => Response.json(invalid));
    await assert.rejects(loadPublicCategoryData(), /Invalid category response/);
  }

  for (const valid of [data, { ...data, categories: [] }]) {
    fetch.mock.mockImplementation(async () => Response.json(valid));
    assert.deepEqual(await loadPublicCategoryData(), valid);
  }
});

import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?public-cache=1`);
const originalCaches = globalThis.caches;

after(async () => {
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
  await compiledShared.cleanup();
});

class FakeCache {
  constructor() {
    this.entries = new Map();
    this.deletes = [];
  }

  async match(request) {
    return this.entries.get(request.url)?.clone();
  }

  async put(request, response) {
    this.entries.set(request.url, response.clone());
  }

  async delete(request) {
    this.deletes.push(request.url);
    return this.entries.delete(request.url);
  }
}

let cache;
beforeEach(() => {
  cache = new FakeCache();
  globalThis.caches = { default: cache };
});

test("a cache hit reuses JSON without calling the loader again", async () => {
  let loads = 0;
  const load = async () => ({ tools: [{ id: `tool-${++loads}` }] });
  const options = {
    cacheKey: shared.PUBLIC_API_CACHE_KEYS.tools,
    cacheVersion: "v1",
    ttlSeconds: 30,
    shouldCache: (data) => data.tools.length > 0
  };

  const first = await shared.cachedPublicJson(
    new Request("https://example.com/api/tools?ignored=1"),
    load,
    options
  );
  const second = await shared.cachedPublicJson(
    new Request("https://alternate.example.net/api/tools?ignored=2"),
    load,
    options
  );

  assert.equal(loads, 1);
  assert.equal(first.headers.get("X-HTools-Cache"), "MISS");
  assert.equal(second.headers.get("X-HTools-Cache"), "HIT");
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(first.headers.get("Cache-Control"), "private, no-cache, max-age=0");
  assert.ok(first.headers.get("ETag"));
});

test("If-None-Match returns 304 from cache without loading D1", async () => {
  let loads = 0;
  const options = {
    cacheKey: shared.PUBLIC_API_CACHE_KEYS.articles,
    cacheVersion: "v1",
    ttlSeconds: 30
  };
  const first = await shared.cachedPublicJson(
    new Request("https://example.com/api/articles"),
    async () => ({ articles: [{ id: ++loads }] }),
    options
  );
  const etag = first.headers.get("ETag");
  const mismatched = await shared.cachedPublicJson(
    new Request("https://example.com/api/articles", {
      headers: { "If-None-Match": '"different"' }
    }),
    async () => ({ articles: [{ id: ++loads }] }),
    options
  );
  const conditional = await shared.cachedPublicJson(
    new Request("https://example.com/api/articles", {
      headers: { "If-None-Match": etag }
    }),
    async () => ({ articles: [{ id: ++loads }] }),
    options
  );

  assert.equal(loads, 1);
  assert.equal(mismatched.status, 200);
  assert.equal(mismatched.headers.get("X-HTools-Cache"), "HIT");
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  assert.equal(conditional.headers.get("X-HTools-Cache"), "HIT");
});

test("empty lists bypass cache so newly added data is immediately visible", async () => {
  let loads = 0;
  const options = {
    cacheKey: shared.PUBLIC_API_CACHE_KEYS.tools,
    cacheVersion: "v1",
    ttlSeconds: 30,
    shouldCache: (data) => data.tools.length > 0
  };
  const load = async () => {
    loads += 1;
    return { tools: loads === 1 ? [] : [{ id: "new-tool" }] };
  };

  const empty = await shared.cachedPublicJson(
    new Request("https://example.com/api/tools"),
    load,
    options
  );
  const populated = await shared.cachedPublicJson(
    new Request("https://example.com/api/tools"),
    load,
    options
  );

  assert.equal(loads, 2);
  assert.equal(empty.headers.get("Cache-Control"), "no-store");
  assert.equal(empty.headers.get("X-HTools-Cache"), "BYPASS");
  assert.deepEqual(await populated.json(), { tools: [{ id: "new-tool" }] });
});

test("a D1 cache version invalidates every origin without reviving stale entries", async () => {
  const env = createCacheVersionEnv("v1");
  let loads = 0;
  const firstVersion = await shared.getPublicApiCacheVersion(env);
  const first = await shared.cachedPublicJson(
    new Request("https://pages.example.dev/api/tools"),
    async () => ({ tools: [{ id: `tool-${++loads}` }] }),
    {
      cacheKey: shared.PUBLIC_API_CACHE_KEYS.tools,
      cacheVersion: firstVersion,
      ttlSeconds: 30
    }
  );
  assert.equal(first.headers.get("X-HTools-Cache"), "MISS");

  await shared.invalidatePublicApiCache(env);
  const secondVersion = await shared.getPublicApiCacheVersion(env);
  assert.notEqual(secondVersion, firstVersion);

  const refreshed = await shared.cachedPublicJson(
    new Request("https://custom.example.com/api/tools"),
    async () => ({ tools: [{ id: `tool-${++loads}` }] }),
    {
      cacheKey: shared.PUBLIC_API_CACHE_KEYS.tools,
      cacheVersion: secondVersion,
      ttlSeconds: 30
    }
  );
  const repeated = await shared.cachedPublicJson(
    new Request("https://pages.example.dev/api/tools"),
    async () => ({ tools: [{ id: `tool-${++loads}` }] }),
    {
      cacheKey: shared.PUBLIC_API_CACHE_KEYS.tools,
      cacheVersion: secondVersion,
      ttlSeconds: 30
    }
  );

  assert.equal(loads, 2);
  assert.equal(refreshed.headers.get("X-HTools-Cache"), "MISS");
  assert.equal(repeated.headers.get("X-HTools-Cache"), "HIT");
  assert.deepEqual(await repeated.json(), { tools: [{ id: "tool-2" }] });
});

test("Cache API failures fall back to the loader", async () => {
  let loads = 0;
  globalThis.caches = {
    default: {
      async match() {
        throw new Error("cache unavailable");
      },
      async put() {
        throw new Error("cache unavailable");
      }
    }
  };

  const response = await shared.cachedPublicJson(
    new Request("https://example.com/api/proxy-settings"),
    async () => ({ settings: { enabled: ++loads === 1 } }),
    {
      cacheKey: shared.PUBLIC_API_CACHE_KEYS.proxySettings,
      cacheVersion: "v1",
      ttlSeconds: 15
    }
  );

  assert.equal(response.status, 200);
  assert.equal(loads, 1);
  assert.deepEqual(await response.json(), { settings: { enabled: true } });
});

test("cache-version update failures are surfaced to admin writes", async () => {
  const env = createCacheVersionEnv("v1", { failWrites: true });
  await assert.rejects(
    shared.invalidatePublicApiCache(env),
    /cache version write failed/
  );
});

function createCacheVersionEnv(initialVersion, options = {}) {
  const state = { version: initialVersion };
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...binds) {
          values = binds;
          return this;
        },
        async first() {
          if (sql.includes("SELECT value FROM app_settings")) {
            if (values[0] === "database_schema_version") return { value: "17" };
            if (values[0] === "public_api_cache_version") {
              return state.version ? { value: state.version } : null;
            }
          }
          return null;
        },
        async run() {
          if (options.failWrites) throw new Error("cache version write failed");
          if (
            sql.includes("INSERT INTO app_settings") &&
            values[0] === "public_api_cache_version"
          ) {
            state.version = values[1];
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };
  return { DB: db };
}

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const compiledTools = await compileTypescriptModule(
  new URL("../../functions/api/tools/index.ts", import.meta.url),
  { importReplacements: { "../../_shared": compiledShared.url.href } }
);
const compiledSearch = await compileTypescriptModule(
  new URL("../../functions/api/tools/search.ts", import.meta.url),
  { importReplacements: { "../../_shared": compiledShared.url.href } }
);
const toolsApi = await import(`${compiledTools.url.href}?public-tools=page`);
const searchApi = await import(`${compiledSearch.url.href}?public-tools=search`);
const shared = await import(`${compiledShared.url.href}?public-tools=shared`);

after(async () => {
  await Promise.all([
    compiledShared.cleanup(),
    compiledTools.cleanup(),
    compiledSearch.cleanup()
  ]);
});

const toolBase = {
  name: "Tool",
  description: "Description",
  url: "https://example.com",
  demo_url: "",
  image: "",
  category: "Developer Tools",
  tags: '["Workers"]',
  github_language: "TypeScript",
  github_license: "MIT",
  featured: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-03T00:00:00.000Z"
};

function createDatabase({ rows = [], counts = [] } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.binds = values;
          return this;
        },
        async first() {
          if (sql.includes("SELECT value FROM app_settings")) {
            return call.binds[0] === "database_schema_version"
              ? { value: "18" }
              : { value: "cache-version" };
          }
          return null;
        },
        async all() {
          if (sql.includes("GROUP BY category")) return { results: counts };
          if (sql.includes("FROM tools")) return { results: rows };
          return { results: [] };
        }
      };
    }
  };
  return { db, calls };
}

async function pageRequest(url, mock) {
  return toolsApi.onRequestGet({
    request: new Request(url),
    env: { DB: mock.db },
    waitUntil() {}
  });
}

function pageCall(mock) {
  return mock.calls.find(
    (call) => call.sql.includes("ORDER BY updated_at DESC") && call.sql.includes("LIMIT ?")
  );
}

test("public tools return stable pages, categories, and featured totals", async () => {
  const mock = createDatabase({
    rows: [
      { ...toolBase, id: "tool-3" },
      { ...toolBase, id: "tool-2" },
      { ...toolBase, id: "tool-1" }
    ],
    counts: [
      { category: "Developer Tools", total: 3, featured_total: 1 },
      { category: "Email", total: 2, featured_total: 1 }
    ]
  });
  const response = await pageRequest(
    "https://example.com/api/tools?limit=2",
    mock
  );
  const body = await response.json();
  const call = pageCall(mock);

  assert.equal(response.status, 200);
  assert.deepEqual(body.tools.map((tool) => tool.id), ["tool-3", "tool-2"]);
  assert.equal(body.limit, 2);
  assert.equal(body.hasMore, true);
  assert.ok(body.nextCursor);
  assert.equal(body.total, 5);
  assert.deepEqual(body.categoryCounts, { "Developer Tools": 3, Email: 2 });
  assert.equal(body.featuredTotal, 2);
  assert.deepEqual(call.binds, [3]);
  assert.match(call.sql, /updated_at DESC, created_at DESC, id DESC/);
});

test("tool cursors are filter-bound and use all stable sort fields", async () => {
  const firstMock = createDatabase({
    rows: [
      { ...toolBase, id: "tool-3" },
      { ...toolBase, id: "tool-2" },
      { ...toolBase, id: "tool-1" }
    ],
    counts: [{ category: "Developer Tools", total: 3, featured_total: 0 }]
  });
  const first = await pageRequest(
    "https://example.com/api/tools?category=Developer%20Tools&limit=2",
    firstMock
  ).then((response) => response.json());
  const secondMock = createDatabase({ rows: [{ ...toolBase, id: "tool-1" }] });
  const secondResponse = await pageRequest(
    `https://example.com/api/tools?category=Developer%20Tools&limit=2&counts=0&cursor=${encodeURIComponent(first.nextCursor)}`,
    secondMock
  );
  const second = await secondResponse.json();
  const call = pageCall(secondMock);

  assert.deepEqual(second.tools.map((tool) => tool.id), ["tool-1"]);
  assert.equal(second.categoryCounts, null);
  assert.equal(second.featuredTotal, null);
  assert.deepEqual(call.binds, [
    "Developer Tools",
    toolBase.updated_at,
    toolBase.updated_at,
    toolBase.created_at,
    toolBase.created_at,
    "tool-2",
    3
  ]);

  const invalid = createDatabase();
  const invalidResponse = await pageRequest(
    `https://example.com/api/tools?featured=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    invalid
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.calls.length, 0);
});

test("tool pagination uses sixteen as the default page size", async () => {
  const mock = createDatabase();
  await pageRequest("https://example.com/api/tools?counts=0", mock);
  assert.equal(pageCall(mock).binds.at(-1), 17);
});

test("tool search is independent, escaped, limited, and never cached", async () => {
  const mock = createDatabase({ rows: [{ ...toolBase, id: "tool-search" }] });
  const query = "%_\\";
  const response = await searchApi.onRequestGet({
    request: new Request(
      `https://example.com/api/tools/search?q=${encodeURIComponent(query)}`
    ),
    env: { DB: mock.db }
  });
  const body = await response.json();
  const call = mock.calls.find(
    (entry) => entry.sql.includes("name LIKE") && entry.sql.includes("FROM tools")
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(body.tools.map((tool) => tool.id), ["tool-search"]);
  assert.deepEqual(
    call.binds.slice(0, 4),
    Array(4).fill(shared.createSearchTerms(query).likePattern)
  );
  assert.equal(call.binds.at(-1), 8);

  const blank = createDatabase();
  const blankResponse = await searchApi.onRequestGet({
    request: new Request("https://example.com/api/tools/search?q="),
    env: { DB: blank.db }
  });
  assert.deepEqual(await blankResponse.json(), { tools: [] });
  assert.equal(blank.calls.length, 0);
});

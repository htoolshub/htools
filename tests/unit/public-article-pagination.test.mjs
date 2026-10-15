import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const compiledArticles = await compileTypescriptModule(
  new URL("../../functions/api/articles/index.ts", import.meta.url),
  { importReplacements: { "../../_shared": compiledShared.url.href } }
);
const articlesApi = await import(
  `${compiledArticles.url.href}?public-article-pagination=1`
);

after(async () => {
  await Promise.all([compiledShared.cleanup(), compiledArticles.cleanup()]);
});

const articleBase = {
  slug: "article",
  title: "Article",
  summary: "Summary",
  content: "private body sentinel",
  cover_image: "",
  category: "guide",
  tags: "[]",
  published: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  published_at: "2026-01-03T00:00:00.000Z"
};

function createDatabase({ rows = [], categoryCounts = [] } = {}) {
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
              ? { value: "17" }
              : { value: "cache-version" };
          }
          return null;
        },
        async all() {
          if (sql.includes("GROUP BY category")) {
            return { results: categoryCounts };
          }
          if (sql.includes("FROM articles")) {
            return { results: rows };
          }
          return { results: [] };
        }
      };
    }
  };
  return { db, calls };
}

async function request(url, mock) {
  return articlesApi.onRequestGet({
    request: new Request(url),
    env: { DB: mock.db },
    waitUntil() {}
  });
}

function listCall(mock) {
  return mock.calls.find(
    (call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM articles")
  );
}

test("public articles return stable summary pagination and category counts", async () => {
  const mock = createDatabase({
    rows: [
      { ...articleBase, id: "article-3", sort_key: "2026-01-03T00:00:00.000Z" },
      { ...articleBase, id: "article-2", sort_key: "2026-01-03T00:00:00.000Z" },
      { ...articleBase, id: "article-1", sort_key: "2026-01-02T00:00:00.000Z" }
    ],
    categoryCounts: [
      { category: "guide", total: 3 },
      { category: "news", total: 2 }
    ]
  });
  const response = await request(
    "https://example.com/api/articles?category=guide&limit=2",
    mock
  );
  const body = await response.json();
  const call = listCall(mock);

  assert.equal(response.status, 200);
  assert.deepEqual(body.articles.map((article) => article.id), ["article-3", "article-2"]);
  assert.equal(body.limit, 2);
  assert.equal(body.hasMore, true);
  assert.ok(body.nextCursor);
  assert.equal(body.total, 3);
  assert.deepEqual(body.categoryCounts, { guide: 3, news: 2 });
  assert.ok(call.sql.includes("published = 1"));
  assert.ok(call.sql.includes("category = ?"));
  assert.deepEqual(call.binds, ["guide", 3]);
  assert.doesNotMatch(call.sql.split("FROM articles", 1)[0], /\bcontent\b/);
  assert.equal("content" in body.articles[0], false);
  assert.doesNotMatch(JSON.stringify(body), /private body sentinel/);
});

test("public article cursors bind the category and use a keyset range", async () => {
  const firstMock = createDatabase({
    rows: [
      { ...articleBase, id: "article-3", sort_key: "2026-01-03T00:00:00.000Z" },
      { ...articleBase, id: "article-2", sort_key: "2026-01-03T00:00:00.000Z" },
      { ...articleBase, id: "article-1", sort_key: "2026-01-02T00:00:00.000Z" }
    ],
    categoryCounts: [{ category: "guide", total: 3 }]
  });
  const firstResponse = await request(
    "https://example.com/api/articles?category=guide&limit=2",
    firstMock
  );
  const firstBody = await firstResponse.json();
  const secondMock = createDatabase({
    rows: [
      { ...articleBase, id: "article-1", sort_key: "2026-01-02T00:00:00.000Z" }
    ]
  });
  const secondResponse = await request(
    `https://example.com/api/articles?category=guide&limit=2&counts=0&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    secondMock
  );
  const secondBody = await secondResponse.json();
  const call = listCall(secondMock);

  assert.equal(secondResponse.status, 200);
  assert.deepEqual(secondBody.articles.map((article) => article.id), ["article-1"]);
  assert.equal(secondBody.hasMore, false);
  assert.equal(secondBody.total, null);
  assert.equal(secondBody.categoryCounts, null);
  assert.match(call.sql, /updated_at, created_at\) < \?/);
  assert.match(call.sql, /id < \?/);
  assert.deepEqual(call.binds, [
    "guide",
    "2026-01-03T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z",
    "article-2",
    3
  ]);

  const wrongCategory = createDatabase();
  const invalidResponse = await request(
    `https://example.com/api/articles?category=news&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    wrongCategory
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(wrongCategory.calls.length, 0);
});

test("public article pagination normalizes limits and rejects malformed cursors", async () => {
  const defaults = createDatabase();
  await request("https://example.com/api/articles?counts=0", defaults);
  assert.equal(listCall(defaults).binds.at(-1), 21);

  const limited = createDatabase();
  await request("https://example.com/api/articles?limit=999&counts=0", limited);
  assert.equal(listCall(limited).binds.at(-1), 51);

  const fallback = createDatabase();
  await request("https://example.com/api/articles?limit=invalid&counts=0", fallback);
  assert.equal(listCall(fallback).binds.at(-1), 21);

  const invalid = createDatabase();
  const response = await request(
    "https://example.com/api/articles?cursor=invalid",
    invalid
  );
  assert.equal(response.status, 400);
  assert.equal(invalid.calls.length, 0);
});

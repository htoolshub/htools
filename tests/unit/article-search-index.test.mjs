import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const compiledSearch = await compileTypescriptModule(
  new URL("../../functions/api/articles/search.ts", import.meta.url),
  { importReplacements: { "../../_shared": compiledShared.url.href } }
);
const shared = await import(`${compiledShared.url.href}?article-search=shared`);
const searchApi = await import(`${compiledSearch.url.href}?article-search=endpoint`);

after(async () => {
  await Promise.all([compiledShared.cleanup(), compiledSearch.cleanup()]);
});

const articleRow = {
  id: "article-1",
  slug: "chinese-cache-guide",
  title: "Cloudflare 中文缓存指南",
  summary: "Edge Runtime",
  content: "数据库迁移方案不得出现在响应中",
  cover_image: "",
  category: "guide",
  tags: '["Cloudflare"]',
  published: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  published_at: "2026-01-02T00:00:00.000Z"
};

function createDatabase(handler) {
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
          if (sql.includes("SELECT value FROM app_settings")) return { value: "18" };
          return null;
        },
        async all() {
          return handler(call);
        }
      };
    }
  };
  return { db, calls };
}

async function search(query, mock) {
  return searchApi.onRequestGet({
    request: new Request(`https://example.com/api/articles/search?q=${encodeURIComponent(query)}`),
    env: { DB: mock.db }
  });
}

function searchCalls(mock) {
  return mock.calls.filter((call) =>
    call.sql.includes("FROM articles") && !call.sql.includes("app_settings")
  );
}

test("public article search uses FTS for Chinese and English terms", async () => {
  const mock = createDatabase(async () => ({ results: [articleRow] }));

  const chinese = await search("中文缓存", mock);
  const english = await search("Cloudflare", mock);
  const calls = searchCalls(mock);

  assert.equal(chinese.status, 200);
  assert.equal(english.status, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.sql.includes("articles_search MATCH ?")));
  assert.deepEqual(calls.map((call) => call.binds[0]), [
    shared.createSearchTerms("中文缓存").ftsPhrase,
    shared.createSearchTerms("Cloudflare").ftsPhrase
  ]);
  assert.ok(calls.every((call) => call.binds.at(-1) === 6));
});

test("short Chinese and special-character queries use escaped LIKE", async () => {
  const mock = createDatabase(async () => ({ results: [articleRow] }));

  await search("缓存", mock);
  await search("%_", mock);
  const calls = searchCalls(mock);

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => /LIKE \? ESCAPE/.test(call.sql)));
  assert.ok(calls.every((call) => !call.sql.includes("MATCH ?")));
  assert.equal(calls[0].binds[0], shared.createSearchTerms("缓存").likePattern);
  assert.equal(calls[1].binds[0], shared.createSearchTerms("%_").likePattern);
  assert.deepEqual(calls[1].binds.slice(0, 5), Array(5).fill(calls[1].binds[0]));
});

test("missing FTS falls back to LIKE and never leaks article content", async () => {
  let attempts = 0;
  const mock = createDatabase(async (call) => {
    attempts += 1;
    if (call.sql.includes("MATCH ?")) throw new Error("no such table: articles_search");
    return { results: [articleRow] };
  });

  const response = await search('迁移方案 " OR -', mock);
  const body = await response.json();
  const calls = searchCalls(mock);

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].sql.includes("MATCH ?"));
  assert.match(calls[1].sql, /LIKE \? ESCAPE/);
  assert.equal(calls[1].binds[0], shared.createSearchTerms('迁移方案 " OR -').likePattern);
  assert.equal(body.articles.length, 1);
  assert.equal(body.articles[0].slug, articleRow.slug);
  assert.equal("content" in body.articles[0], false);
  assert.doesNotMatch(JSON.stringify(body), /不得出现在响应中/);
});

test("blank article searches do not access D1", async () => {
  const mock = createDatabase(async () => {
    throw new Error("search should not run");
  });
  const response = await search("   ", mock);

  assert.deepEqual(await response.json(), { articles: [] });
  assert.equal(mock.calls.length, 0);
});

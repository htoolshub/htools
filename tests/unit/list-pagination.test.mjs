import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?lists=1`);
const compiledArticles = await compileTypescriptModule(
  new URL("../../functions/api/admin/articles/index.ts", import.meta.url),
  { importReplacements: { "../../../_shared": compiledShared.url.href } }
);
const compiledContentItems = await compileTypescriptModule(
  new URL("../../functions/api/admin/content-items/index.ts", import.meta.url),
  { importReplacements: { "../../../_shared": compiledShared.url.href } }
);
const compiledApiClient = await compileTypescriptModule(
  new URL("../../src/api-client.ts", import.meta.url)
);
const compiledAdminContentApi = await compileTypescriptModule(
  new URL("../../src/admin-api.ts", import.meta.url),
  {
    importReplacements: { "./api-client": compiledApiClient.url.href },
    transformSource: (source) => `import { readJson } from "./api-client";\n${source.slice(
      source.indexOf("export async function loadContentItems("),
      source.indexOf("export async function convertContentItemToArticle(")
    )}`
  }
);
const articleApi = await import(`${compiledArticles.url.href}?lists=articles`);
const contentApi = await import(`${compiledContentItems.url.href}?lists=content`);
const adminContentApi = await import(compiledAdminContentApi.url.href);

after(async () => {
  await Promise.all([
    compiledShared.cleanup(),
    compiledArticles.cleanup(),
    compiledContentItems.cleanup(),
    compiledApiClient.cleanup(),
    compiledAdminContentApi.cleanup()
  ]);
});

function createMockDatabase({
  articleRows = [],
  contentRows = [],
  sourceCountRows = [{ source_id: "source-1", total: 3, filtered_total: 3 }],
  ftsUnavailable = false,
  // 会话签名密钥现在存在 D1 里(app_settings.session_secret),签发和校验令牌都要读它。
  // 给一枚固定值当桩;传 null 就模拟"另一个还没生成密钥的库",此时令牌必须验不过。
  sessionSecret = "mock-session-secret"
} = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      return {
        bind(...binds) {
          call.binds = binds;
          return this;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes("SELECT value FROM app_settings")) {
            if (call.binds[0] === "session_secret") {
              return sessionSecret ? { value: sessionSecret } : null;
            }
            return { value: "18" };
          }
          if (sql.includes("COUNT(*) AS total FROM articles")) return { total: 3 };
          if (sql.includes("COUNT(*) AS total") && sql.includes("content_items")) {
            return { total: 3 };
          }
          return null;
        },
        async all() {
          if (ftsUnavailable && sql.includes("content_items_search MATCH ?")) {
            throw new Error("no such table: content_items_search");
          }
          if (sql.includes("FROM app_settings") && sql.includes("key IN")) {
            return {
              results: sessionSecret
                ? [{ key: "session_secret", value: sessionSecret }]
                : []
            };
          }
          if (sql.includes("AS sort_key") && sql.includes("FROM articles")) {
            return { results: articleRows };
          }
          if (sql.includes("AS sort_key") && sql.includes("FROM content_items")) {
            return { results: contentRows };
          }
          if (sql.includes("FROM articles") && sql.includes("GROUP BY category")) {
            return { results: [{ category: "news", total: 3 }] };
          }
          if (sql.includes("content_items.source_id") && sql.includes("GROUP BY")) {
            return { results: sourceCountRows };
          }
          if (sql.includes("FROM content_items") && sql.includes("GROUP BY category")) {
            return { results: [{ category: "news", total: 3 }] };
          }
          return { results: [] };
        }
      };
    }
  };
  return { db, calls };
}

async function authenticatedRequest(url, db) {
  const env = { ADMIN_PASSWORD: "test-password", DB: db };
  const token = await shared.createToken(env);
  return {
    env,
    request: new Request(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
  };
}

const articleBase = {
  slug: "article",
  title: "Article",
  summary: "Summary",
  content: "must not be returned",
  cover_image: "",
  category: "news",
  tags: "[]",
  published: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  published_at: "2026-01-01T00:00:00.000Z"
};

test("admin article list returns summaries and a stable keyset cursor", async () => {
  const articleRows = [
    { ...articleBase, id: "article-3", sort_key: "2026-01-03T00:00:00.000Z" },
    { ...articleBase, id: "article-2", sort_key: "2026-01-02T00:00:00.000Z" },
    { ...articleBase, id: "article-1", sort_key: "2026-01-01T00:00:00.000Z" }
  ];
  const mock = createMockDatabase({ articleRows });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/articles?limit=2",
    mock.db
  );
  const response = await articleApi.onRequestGet(context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.articles.length, 2);
  assert.equal(body.hasMore, true);
  assert.equal(body.total, 3);
  assert.deepEqual(body.categoryCounts, { news: 3 });
  assert.ok(body.nextCursor);
  assert.equal("content" in body.articles[0], false);
  assert.equal(
    mock.calls.some((call) => /^\s*SELECT COUNT\(\*\) AS total FROM articles/.test(call.sql)),
    false
  );

  const projection = mock.calls
    .find((call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM articles"))
    .sql.split("FROM articles", 1)[0];
  assert.doesNotMatch(projection, /\bcontent\b/);

  mock.calls.length = 0;
  const nextContext = await authenticatedRequest(
    `https://example.com/api/admin/articles?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`,
    mock.db
  );
  await articleApi.onRequestGet(nextContext);
  const nextCall = mock.calls.find(
    (call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM articles")
  );
  assert.match(nextCall.sql, /id < \?/);
  assert.deepEqual(nextCall.binds.slice(0, 3), [
    "2026-01-02T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    "article-2"
  ]);
});

test("invalid admin article cursor returns 400", async () => {
  const mock = createMockDatabase();
  const context = await authenticatedRequest(
    "https://example.com/api/admin/articles?cursor=invalid",
    mock.db
  );
  const response = await articleApi.onRequestGet(context);
  assert.equal(response.status, 400);
});

test("admin article search uses the FTS index without returning content", async () => {
  const mock = createMockDatabase({
    articleRows: [
      { ...articleBase, id: "article-1", sort_key: "2026-01-01T00:00:00.000Z" }
    ]
  });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/articles?q=%E4%B8%AD%E6%96%87%E7%BC%93%E5%AD%98",
    mock.db
  );
  const response = await articleApi.onRequestGet(context);
  const body = await response.json();
  const searchCalls = mock.calls.filter((call) =>
    call.sql.includes("articles_search MATCH ?")
  );

  assert.equal(response.status, 200);
  assert.equal(body.articles.length, 1);
  assert.equal("content" in body.articles[0], false);
  assert.equal(searchCalls.length, 2);
  assert.ok(
    searchCalls.every(
      (call) => call.binds[0] === shared.createSearchTerms("中文缓存").ftsPhrase
    )
  );
});

const contentBase = {
  source_id: "source-1",
  source_title: "Source",
  source_url: "https://example.com/feed.xml",
  external_id: "external",
  title: "Item",
  summary: "Summary",
  content: "must not be returned",
  linked_article_content: "must not be returned",
  url: "https://example.com/item",
  author: "Author",
  cover_image: "",
  category: "news",
  tags: "[]",
  published_at: "2026-01-01T00:00:00.000Z",
  synced_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  article_id: null,
  linked_article_id: null,
  linked_article_slug: null,
  linked_article_title: null,
  linked_article_published: null
};

test("content item list returns summaries and a stable keyset cursor", async () => {
  const contentRows = [
    { ...contentBase, id: "item-3", sort_key: "2026-01-03T00:00:00.000Z" },
    { ...contentBase, id: "item-2", sort_key: "2026-01-02T00:00:00.000Z" },
    { ...contentBase, id: "item-1", sort_key: "2026-01-01T00:00:00.000Z" }
  ];
  const mock = createMockDatabase({ contentRows });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/content-items?limit=2",
    mock.db
  );
  const response = await contentApi.onRequestGet(context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.items.length, 2);
  assert.equal(body.hasMore, true);
  assert.equal(body.total, 3);
  assert.deepEqual(body.sourceCounts, { "source-1": 3 });
  assert.deepEqual(body.categoryCounts, { news: 3 });
  assert.equal(mock.calls.filter((call) => call.sql.includes("GROUP BY")).length, 2);
  assert.equal("content" in body.items[0], false);
  assert.equal("linked_article_content" in body.items[0], false);
  assert.equal(
    mock.calls.some(
      (call) => /^\s*SELECT COUNT\(\*\) AS total\s+FROM content_items/.test(call.sql)
    ),
    false
  );

  const projection = mock.calls
    .find(
      (call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM content_items")
    )
    .sql.split("FROM content_items", 1)[0];
  assert.doesNotMatch(projection, /content_items\.content(?:\s|,)/);
  assert.doesNotMatch(projection, /articles\.content/);

  mock.calls.length = 0;
  const nextContext = await authenticatedRequest(
    `https://example.com/api/admin/content-items?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`,
    mock.db
  );
  await contentApi.onRequestGet(nextContext);
  const nextCall = mock.calls.find(
    (call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM content_items")
  );
  assert.match(nextCall.sql, /content_items\.id < \?/);
  assert.deepEqual(nextCall.binds.slice(0, 3), [
    "2026-01-02T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    "item-2"
  ]);
});

test("内容追加页关闭统计后保留游标、筛选和排序，且不执行分组查询", async () => {
  const sortKey = "2026-01-01T00:00:00.000Z";
  const cursor = Buffer.from(JSON.stringify({ sort: "oldest", sortKey, id: "item-1" }))
    .toString("base64url");
  const contentRows = [
    { ...contentBase, id: "item-2", sort_key: "2026-01-02T00:00:00.000Z" },
    { ...contentBase, id: "item-3", sort_key: "2026-01-03T00:00:00.000Z" },
    { ...contentBase, id: "item-4", sort_key: "2026-01-04T00:00:00.000Z" }
  ];
  const mock = createMockDatabase({ contentRows });
  const query = new URLSearchParams({
    counts: "0", sourceId: "source-1", category: "news", sort: "oldest", limit: "2", cursor
  });
  const response = await contentApi.onRequestGet(await authenticatedRequest(
    `https://example.com/api/admin/content-items?${query}`, mock.db
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.items.map((item) => item.id), ["item-2", "item-3"]);
  assert.equal(body.hasMore, true);
  assert.equal(body.limit, 2);
  assert.equal(mock.calls.filter((call) => call.sql.includes("GROUP BY")).length, 0);
  assert.equal(body.total, null);
  assert.equal(body.sourceCounts, null);
  assert.equal(body.categoryCounts, null);
  assert.deepEqual(JSON.parse(Buffer.from(body.nextCursor, "base64url").toString()), {
    sort: "oldest", sortKey: "2026-01-03T00:00:00.000Z", id: "item-3"
  });
  const pageCall = mock.calls.find((call) => call.sql.includes("AS sort_key"));
  assert.match(pageCall.sql, /ORDER BY sort_key ASC, content_items\.id ASC/);
  assert.match(pageCall.sql, /content_items\.category = \?/);
  assert.match(pageCall.sql, /content_items\.source_id = \?/);
  assert.match(pageCall.sql, /content_items\.id > \?/);
  assert.deepEqual(pageCall.binds, ["news", "source-1", sortKey, sortKey, "item-1", 3]);
});

test("内容搜索关闭统计时，FTS 正常和降级路径均不执行分组查询", async () => {
  const query = "前端观察";
  const terms = shared.createSearchTerms(query);
  for (const ftsUnavailable of [false, true]) {
    const mock = createMockDatabase({
      ftsUnavailable,
      contentRows: [{ ...contentBase, id: "item-1", sort_key: contentBase.published_at }]
    });
    const response = await contentApi.onRequestGet(await authenticatedRequest(
      `https://example.com/api/admin/content-items?counts=0&category=news&sourceId=source-1&q=${encodeURIComponent(query)}`,
      mock.db
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(mock.calls.filter((call) => call.sql.includes("GROUP BY")).length, 0);
    assert.equal(body.total, null);
    assert.equal(body.sourceCounts, null);
    assert.equal(body.categoryCounts, null);
    const pageCalls = mock.calls.filter((call) => call.sql.includes("AS sort_key"));
    assert.equal(pageCalls.length, ftsUnavailable ? 2 : 1);
    assert.match(pageCalls[0].sql, /content_items_search MATCH \?/);
    assert.deepEqual(pageCalls[0].binds, ["news", terms.ftsPhrase, "source-1", 51]);
    if (ftsUnavailable) {
      assert.match(pageCalls[1].sql, /content_sources\.title LIKE/);
      assert.deepEqual(pageCalls[1].binds, ["news", ...Array(6).fill(terms.likePattern), "source-1", 51]);
    }
  }
});

test("内容列表只有显式 counts=0 才跳过统计，FTS 降级仍保留默认统计", async () => {
  for (const counts of [null, "1", "false"]) {
    const mock = createMockDatabase({ ftsUnavailable: true });
    const query = new URLSearchParams({ q: "前端观察" });
    if (counts !== null) query.set("counts", counts);
    const response = await contentApi.onRequestGet(await authenticatedRequest(
      `https://example.com/api/admin/content-items?${query}`, mock.db
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.total, 3);
    assert.deepEqual(body.sourceCounts, { "source-1": 3 });
    assert.deepEqual(body.categoryCounts, { news: 3 });
    assert.equal(mock.calls.filter((call) => call.sql.includes("GROUP BY")).length, 4);
  }
});

test("内容列表客户端仅在显式关闭统计时发送 counts=0，并保留空统计响应", async (t) => {
  const requests = [];
  const body = {
    items: [], limit: 2, hasMore: false, nextCursor: null,
    total: null, sourceCounts: null, categoryCounts: null
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: new URL(url, "https://example.com"), options });
    return Response.json(body);
  });
  for (const includeCounts of [undefined, true, false]) {
    assert.deepEqual(await adminContentApi.loadContentItems("test-token", {
      sourceId: "source-1", category: "news", query: "前端观察", sort: "oldest",
      limit: 2, cursor: "cursor-value", includeCounts
    }), body);
  }

  assert.deepEqual(requests.map(({ url }) => url.searchParams.get("counts")), [null, null, "0"]);
  for (const { url, options } of requests) {
    assert.equal(url.pathname, "/api/admin/content-items");
    assert.deepEqual(Object.fromEntries([...url.searchParams].filter(([key]) => key !== "counts")), {
      sourceId: "source-1", category: "news", q: "前端观察", sort: "oldest",
      limit: "2", cursor: "cursor-value"
    });
    assert.equal(options.headers.Authorization, "Bearer test-token");
  }
});

test("content item oldest sorting uses a sort-bound keyset cursor", async () => {
  const contentRows = [
    { ...contentBase, id: "item-a", title: "Alpha", sort_key: "2026-01-03T00:00:00.000Z" },
    { ...contentBase, id: "item-b", title: "Beta", sort_key: "2026-01-02T00:00:00.000Z" },
    { ...contentBase, id: "item-c", title: "Charlie", sort_key: "2026-01-01T00:00:00.000Z" }
  ];
  const mock = createMockDatabase({ contentRows });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/content-items?limit=2&sort=oldest",
    mock.db
  );
  const response = await contentApi.onRequestGet(context);
  const body = await response.json();
  const firstCall = mock.calls.find(
    (call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM content_items")
  );

  assert.equal(response.status, 200);
  assert.match(firstCall.sql, /ORDER BY sort_key ASC, content_items\.id ASC/);
  assert.ok(body.nextCursor);

  mock.calls.length = 0;
  const nextContext = await authenticatedRequest(
    `https://example.com/api/admin/content-items?limit=2&sort=oldest&cursor=${encodeURIComponent(body.nextCursor)}`,
    mock.db
  );
  const nextResponse = await contentApi.onRequestGet(nextContext);
  const nextCall = mock.calls.find(
    (call) => call.sql.includes("AS sort_key") && call.sql.includes("FROM content_items")
  );

  assert.equal(nextResponse.status, 200);
  assert.match(nextCall.sql, /COALESCE\(content_items\.published_at, content_items\.updated_at, content_items\.created_at\) > \?/);
  assert.deepEqual(nextCall.binds.slice(0, 3), [
    "2026-01-02T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    "item-b"
  ]);

  const wrongSortContext = await authenticatedRequest(
    `https://example.com/api/admin/content-items?limit=2&sort=latest&cursor=${encodeURIComponent(body.nextCursor)}`,
    mock.db
  );
  const wrongSortResponse = await contentApi.onRequestGet(wrongSortContext);
  assert.equal(wrongSortResponse.status, 400);
});

test("content item search uses FTS for item and source-title filtering", async () => {
  const mock = createMockDatabase({
    contentRows: [
      { ...contentBase, id: "item-1", sort_key: "2026-01-01T00:00:00.000Z" }
    ]
  });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/content-items?q=%E5%89%8D%E7%AB%AF%E8%A7%82%E5%AF%9F",
    mock.db
  );
  const response = await contentApi.onRequestGet(context);
  const body = await response.json();
  const searchCalls = mock.calls.filter((call) =>
    call.sql.includes("content_items_search MATCH ?")
  );

  assert.equal(response.status, 200);
  assert.equal(body.items.length, 1);
  assert.equal("content" in body.items[0], false);
  assert.equal(searchCalls.length, 2);
  assert.ok(
    searchCalls.every(
      (call) => call.binds[0] === shared.createSearchTerms("前端观察").ftsPhrase
    )
  );
  const sourceCountCall = mock.calls.find(
    (call) => call.sql.includes("GROUP BY content_items.source_id")
  );
  assert.doesNotMatch(sourceCountCall.sql, /JOIN content_sources/);
});

test("short content-item searches keep the source-title LIKE join", async () => {
  const mock = createMockDatabase({
    contentRows: [
      { ...contentBase, id: "item-1", sort_key: "2026-01-01T00:00:00.000Z" }
    ]
  });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/content-items?q=%E5%89%8D%E7%AB%AF",
    mock.db
  );
  const response = await contentApi.onRequestGet(context);
  const sourceCountCall = mock.calls.find(
    (call) => call.sql.includes("GROUP BY content_items.source_id")
  );

  assert.equal(response.status, 200);
  assert.match(sourceCountCall.sql, /JOIN content_sources/);
  assert.match(sourceCountCall.sql, /content_sources\.title LIKE/);
});

test("source counts stay unfiltered by category while the total follows the filter", async () => {
  const mock = createMockDatabase({
    contentRows: [
      { ...contentBase, id: "item-1", sort_key: "2026-01-01T00:00:00.000Z" }
    ],
    sourceCountRows: [
      { source_id: "source-1", total: 30, filtered_total: 0 },
      { source_id: "source-2", total: 2, filtered_total: 2 }
    ]
  });
  const context = await authenticatedRequest(
    "https://example.com/api/admin/content-items?category=news",
    mock.db
  );
  const response = await contentApi.onRequestGet(context);
  const body = await response.json();
  const sourceCountCall = mock.calls.find(
    (call) => call.sql.includes("GROUP BY content_items.source_id")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(body.sourceCounts, { "source-1": 30, "source-2": 2 });
  assert.equal(body.total, 2);
  assert.doesNotMatch(sourceCountCall.sql, /WHERE[\s\S]*content_items\.category/);
  assert.match(
    sourceCountCall.sql,
    /SUM\(CASE WHEN content_items\.category = \? THEN 1 ELSE 0 END\) AS filtered_total/
  );
  assert.deepEqual(sourceCountCall.binds, ["news"]);
});

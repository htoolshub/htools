import assert from "node:assert/strict";
import childProcess, { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wranglerPath = resolve(
  repositoryRoot,
  "node_modules/wrangler/bin/wrangler.js"
);
const schemaPath = resolve(repositoryRoot, "db/schema.sql");

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  );
  return port;
}

async function startPagesDev(assetsPath, persistPath) {
  const port = await getFreePort();
  const inspectorPort = await getFreePort();
  const child = spawn(
    process.execPath,
    [
      wranglerPath,
      "pages",
      "dev",
      assetsPath,
      "--d1",
      "DB",
      "--persist-to",
      persistPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--compatibility-date",
      "2026-06-30",
      "--binding",
      "ADMIN_PASSWORD=test-password",
      // 用字符串桩顶掉根目录 wrangler.toml 里的 [ai] 绑定:AI 绑定在 pages dev 下
      // 必须去 Cloudflare 建远端会话,非交互环境还要 CLOUDFLARE_API_TOKEN ——
      // 这台机器对 Cloudflare 时通时断,一断整轮集成测试就起不来(2026-08-16 实测两次)。
      // 浏览器回归脚本早就这么做了(scripts/browser-regression.mjs 的 AI=browser-regression-ai)。
      "--binding",
      "AI=integration-ai",
      "--binding",
      "TURNSTILE_SITE_KEY=",
      "--binding",
      "TURNSTILE_SECRET_KEY=",
      "--log-level",
      "error"
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  const origin = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler Pages exited before startup.\n${logs}`);
    }
    try {
      const response = await fetch(`${origin}/api/tools`);
      if (response.ok) {
        return { child, response, logs: () => logs };
      }
      logs += `\n/api/tools returned ${response.status}: ${await response.text()}`;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  await stopPagesDev(child);
  throw new Error(`Timed out starting Wrangler Pages.\n${logs}`);
}

async function stopPagesDev(child) {
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  if (child.exitCode !== null) return;
  const waitForExit = (timeout) =>
    Promise.race([
      exited.then(() => true),
      new Promise((resolveDelay) =>
        setTimeout(() => resolveDelay(false), timeout)
      )
    ]);

  child.kill("SIGTERM");
  if (await waitForExit(5_000)) return;

  child.kill("SIGKILL");
  if (!(await waitForExit(5_000))) {
    throw new Error("Wrangler Pages did not exit after SIGKILL.");
  }
}

async function runWrangler(root, configPath, persistPath, inputArgs) {
  const child = spawn(
    process.execPath,
    [
      wranglerPath,
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      persistPath,
      "--yes",
      "--json",
      ...inputArgs
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const result = await new Promise((resolveResult, rejectResult) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      callback();
    };
    const fail = (error) => finish(() => rejectResult(error));
    const timeout = setTimeout(() => {
      fail(new Error(`Wrangler D1 command timed out.\n${stderr || stdout}`));
    }, 60_000);

    child.once("error", fail);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed)) finish(() => resolveResult(parsed));
      } catch {
        // Wait until Wrangler has emitted a complete JSON response.
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        fail(
          new Error(
            `Wrangler D1 command exited with ${signal ?? code}.\n${stderr || stdout}`
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        finish(() => resolveResult(parsed));
      } catch {
        fail(new Error(`Wrangler D1 command returned invalid JSON.\n${stdout}`));
      }
    });
  });
  assert.ok(Array.isArray(result));
  assert.ok(result.every((entry) => entry.success === true));
  return result;
}

test("the D1 runner rejects invalid JSON after a successful exit", {
  timeout: 1_000
}, async (t) => {
  const spawnMock = t.mock.method(childProcess, "spawn", () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true
    });
    queueMicrotask(() => {
      child.stdout.end("not json");
      child.emit("exit", 0, null);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawnMock.mock.restore();
    syncBuiltinESMExports();
  });

  await assert.rejects(
    runWrangler("unused", "unused", "unused", []),
    /Wrangler D1 command returned invalid JSON\.\nnot json/
  );
});

test("the production schema initializes a real local D1 database idempotently", {
  timeout: 240_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "htools-d1-integration-"));
  const configPath = join(root, "wrangler.json");
  const persistPath = join(root, "persist");

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        name: "htools-d1-integration",
        compatibility_date: "2026-06-30",
        d1_databases: [
          {
            binding: "DB",
            database_name: "htools-d1-integration",
            database_id: "00000000-0000-0000-0000-000000000001"
          }
        ]
      }),
      "utf8"
    );

    await runWrangler(root, configPath, persistPath, ["--file", schemaPath]);
    await runWrangler(root, configPath, persistPath, [
      "--command",
      `INSERT INTO tools (id, name, description, url, image, category)
       VALUES ('integration-sentinel', 'Sentinel', 'Preserved row',
               'https://example.com', '', 'test');
       INSERT INTO articles
         (id, slug, title, summary, content, category, tags, published)
       VALUES
         ('search-article', 'search-article', 'Cloudflare 中文缓存指南',
          '边缘运行环境', '正文中的数据库迁移方案', 'guide', '["D1"]', 1);
       INSERT INTO content_sources (id, title, url)
       VALUES ('search-source', '前端观察周刊', 'https://example.com/feed.xml');
       INSERT INTO content_items
         (id, source_id, external_id, title, summary, url, author, tags)
       VALUES
         ('search-item', 'search-source', 'entry-1', 'TypeScript 性能实践',
          '构建速度优化', 'https://example.com/entry-1', 'Alice', '["Vite"]')`
    ]);
    await runWrangler(root, configPath, persistPath, ["--file", schemaPath]);

    const checks = await runWrangler(root, configPath, persistPath, [
      "--command",
      `SELECT name, type FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY type, name;
       PRAGMA table_info(tools);
       SELECT value FROM app_settings WHERE key = 'database_schema_version';
       SELECT COUNT(*) AS total FROM app_settings
       WHERE key = 'database_schema_version';
       SELECT COUNT(*) AS total FROM tools WHERE id = 'integration-sentinel';
       SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_items';
       SELECT article_id FROM articles_search
       WHERE articles_search MATCH '"中文缓存"';
       SELECT article_id FROM articles_search
       WHERE articles_search MATCH '"cloudflare"';
       SELECT item_id FROM content_items_search
       WHERE content_items_search MATCH '"前端观察"';
       SELECT name FROM sqlite_master WHERE type = 'trigger'
       AND name IN (
         'articles_search_ai', 'articles_search_au', 'articles_search_ad',
         'content_items_search_ai', 'content_items_search_au',
         'content_items_search_ad', 'content_sources_search_au',
         'content_sources_search_ad'
       ) ORDER BY name`
    ]);

    const schemaObjects = checks[0].results;
    const tables = schemaObjects
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name);
    const indexes = schemaObjects
      .filter((entry) => entry.type === "index")
      .map((entry) => entry.name);

    const requiredTables = [
      "app_settings",
      "articles",
      "articles_search",
      "content_items",
      "content_items_search",
      "content_sources",
      "telegram_push_locks",
      "telegram_messages",
      "tools"
    ];
    assert.ok(requiredTables.every((table) => tables.includes(table)));
    const requiredIndexes = [
      "idx_articles_category_latest_sort",
      "idx_articles_category_name_sort",
      "idx_articles_latest_sort",
      "idx_articles_name_sort",
      "idx_articles_public_sort",
      "idx_articles_public_category_sort",
      "idx_content_items_category_latest_sort",
      "idx_content_items_latest_sort",
      "idx_content_items_source_latest_sort",
      "idx_content_sources_category",
      "idx_telegram_messages_resource",
      "idx_tools_category_latest_sort",
      "idx_tools_featured_latest_sort",
      "idx_tools_latest_sort"
    ];
    assert.ok(requiredIndexes.every((index) => indexes.includes(index)));
    assert.ok(
      [
        "idx_articles_published",
        "idx_articles_category",
        "idx_articles_slug",
        "idx_content_items_source",
        "idx_content_items_category",
        "idx_tools_category",
        "idx_tools_featured"
      ].every((index) => !indexes.includes(index))
    );

    const toolColumns = new Map(
      checks[1].results.map((column) => [column.name, column])
    );
    assert.deepEqual(
      [...toolColumns.keys()],
      [
        "id",
        "name",
        "description",
        "url",
        "demo_url",
        "image",
        "category",
        "tags",
        "github_language",
        "github_license",
        "featured",
        "created_at",
        "updated_at"
      ]
    );
    assert.equal(toolColumns.get("github_language").notnull, 1);
    assert.equal(toolColumns.get("github_language").dflt_value, "''");
    assert.equal(toolColumns.get("github_license").notnull, 1);
    assert.equal(toolColumns.get("github_license").dflt_value, "''");

    assert.deepEqual(checks[2].results, [{ value: "17" }]);
    assert.equal(checks[3].results[0].total, 1);
    assert.equal(checks[4].results[0].total, 1);
    assert.match(
      checks[5].results[0].sql,
      /UNIQUE\s*\(\s*source_id\s*,\s*external_id\s*\)/i
    );
    assert.deepEqual(checks[6].results, [{ article_id: "search-article" }]);
    assert.deepEqual(checks[7].results, [{ article_id: "search-article" }]);
    assert.deepEqual(checks[8].results, [{ item_id: "search-item" }]);
    assert.equal(checks[9].results.length, 8);

    const triggerChecks = await runWrangler(root, configPath, persistPath, [
      "--command",
      `UPDATE articles SET content = '更新后的发布流程' WHERE id = 'search-article';
       SELECT article_id FROM articles_search
       WHERE articles_search MATCH '"数据库迁移"';
       SELECT article_id FROM articles_search
       WHERE articles_search MATCH '"发布流程"';
       UPDATE content_items SET title = 'React 路由性能实践'
       WHERE id = 'search-item';
       SELECT item_id FROM content_items_search
       WHERE content_items_search MATCH '"TypeScript"';
       SELECT item_id FROM content_items_search
       WHERE content_items_search MATCH '"React 路由"';
       UPDATE content_sources SET title = '工程效率周刊'
       WHERE id = 'search-source';
       SELECT item_id FROM content_items_search
       WHERE content_items_search MATCH '"前端观察"';
       SELECT item_id FROM content_items_search
       WHERE content_items_search MATCH '"工程效率"';
       DELETE FROM articles WHERE id = 'search-article';
       DELETE FROM content_items WHERE id = 'search-item';
       SELECT COUNT(*) AS total FROM articles_search
       WHERE article_id = 'search-article';
       SELECT COUNT(*) AS total FROM content_items_search
       WHERE item_id = 'search-item'`
    ]);
    assert.deepEqual(triggerChecks[0].results, []);
    assert.deepEqual(triggerChecks[1].results, []);
    assert.deepEqual(triggerChecks[2].results, [{ article_id: "search-article" }]);
    assert.deepEqual(triggerChecks[3].results, []);
    assert.deepEqual(triggerChecks[4].results, []);
    assert.deepEqual(triggerChecks[5].results, [{ item_id: "search-item" }]);
    assert.deepEqual(triggerChecks[6].results, []);
    assert.deepEqual(triggerChecks[7].results, []);
    assert.deepEqual(triggerChecks[8].results, [{ item_id: "search-item" }]);
    assert.deepEqual(triggerChecks[9].results, []);
    assert.deepEqual(triggerChecks[10].results, []);
    assert.equal(triggerChecks[11].results[0].total, 0);
    assert.equal(triggerChecks[12].results[0].total, 0);

    const queryPlanChecks = await runWrangler(root, configPath, persistPath, [
      "--command",
      `EXPLAIN QUERY PLAN
         SELECT id FROM articles
         WHERE published = 1
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         WHERE category = 'guide'
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         ORDER BY title ASC, id ASC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         WHERE category = 'guide'
         ORDER BY title ASC, id ASC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT content_items.id
         FROM content_items
         JOIN content_sources ON content_sources.id = content_items.source_id
         LEFT JOIN articles ON articles.id = content_items.article_id
         ORDER BY COALESCE(content_items.published_at,
                           content_items.updated_at,
                           content_items.created_at) DESC,
                  content_items.id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT content_items.id
         FROM content_items
         JOIN content_sources ON content_sources.id = content_items.source_id
         LEFT JOIN articles ON articles.id = content_items.article_id
         WHERE content_items.source_id = 'search-source'
         ORDER BY COALESCE(content_items.published_at,
                           content_items.updated_at,
                           content_items.created_at) DESC,
                  content_items.id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT content_items.id
         FROM content_items
         JOIN content_sources ON content_sources.id = content_items.source_id
         LEFT JOIN articles ON articles.id = content_items.article_id
         WHERE content_items.category = 'guide'
         ORDER BY COALESCE(content_items.published_at,
                           content_items.updated_at,
                           content_items.created_at) DESC,
                  content_items.id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         WHERE COALESCE(published_at, updated_at, created_at) < '2026-01-02'
            OR (COALESCE(published_at, updated_at, created_at) = '2026-01-02'
                AND id < 'article-2')
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         WHERE (title, id) > ('Article', 'article-2')
         ORDER BY title ASC, id ASC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT content_items.id
         FROM content_items
         JOIN content_sources ON content_sources.id = content_items.source_id
         LEFT JOIN articles ON articles.id = content_items.article_id
         WHERE COALESCE(content_items.published_at,
                        content_items.updated_at,
                        content_items.created_at) < '2026-01-02'
            OR (COALESCE(content_items.published_at,
                         content_items.updated_at,
                         content_items.created_at) = '2026-01-02'
                AND content_items.id < 'item-2')
         ORDER BY COALESCE(content_items.published_at,
                           content_items.updated_at,
                           content_items.created_at) DESC,
                  content_items.id DESC
         LIMIT 51;
       EXPLAIN QUERY PLAN
         SELECT id FROM articles
         WHERE published = 1 AND category = 'guide'
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
         LIMIT 21`
    ]);
    const expectedPlanIndexes = [
      "idx_articles_public_sort",
      "idx_articles_latest_sort",
      "idx_articles_category_latest_sort",
      "idx_articles_name_sort",
      "idx_articles_category_name_sort",
      "idx_content_items_latest_sort",
      "idx_content_items_source_latest_sort",
      "idx_content_items_category_latest_sort",
      "idx_articles_latest_sort",
      "idx_articles_name_sort",
      "idx_content_items_latest_sort",
      "idx_articles_public_category_sort"
    ];
    expectedPlanIndexes.forEach((indexName, index) => {
      assert.ok(
        queryPlanChecks[index].results.some((row) =>
          String(row.detail ?? "").includes(indexName)
        ),
        `Expected query plan to use ${indexName}.`
      );
    });
    assert.ok(
      queryPlanChecks.every((plan) =>
        plan.results.every(
          (row) => !String(row.detail ?? "").includes("USE TEMP B-TREE FOR ORDER BY")
        )
      ),
      "Expected indexed list queries to avoid temporary ORDER BY sorting."
    );
    assert.ok(
      queryPlanChecks[8].results.some((row) =>
        String(row.detail ?? "").includes("(<expr><?)")
      ),
      "Expected article latest cursor to use an index range constraint."
    );
    assert.ok(
      queryPlanChecks[9].results.some((row) =>
        String(row.detail ?? "").includes("(title,id)>")
      ),
      "Expected article name cursor to use an index range constraint."
    );
    assert.ok(
      queryPlanChecks[10].results.some((row) =>
        String(row.detail ?? "").includes("(<expr><?)")
      ),
      "Expected content-item cursor to use an index range constraint."
    );

    const toolPlanChecks = await runWrangler(root, configPath, persistPath, [
      "--command",
      `EXPLAIN QUERY PLAN
         SELECT id FROM tools
         ORDER BY updated_at DESC, created_at DESC, id DESC
         LIMIT 17;
       EXPLAIN QUERY PLAN
         SELECT id FROM tools
         WHERE category = 'test'
         ORDER BY updated_at DESC, created_at DESC, id DESC
         LIMIT 17;
       EXPLAIN QUERY PLAN
         SELECT id FROM tools
         WHERE featured = 1
         ORDER BY updated_at DESC, created_at DESC, id DESC
         LIMIT 17;
       EXPLAIN QUERY PLAN
         SELECT id FROM tools
         WHERE updated_at < '2026-01-03'
            OR (updated_at = '2026-01-03' AND
                (created_at < '2026-01-02' OR
                 (created_at = '2026-01-02' AND id < 'tool-2')))
         ORDER BY updated_at DESC, created_at DESC, id DESC
         LIMIT 17;
       EXPLAIN QUERY PLAN
         SELECT category, COUNT(*) FROM tools GROUP BY category`
    ]);
    const expectedToolPlanIndexes = [
      "idx_tools_latest_sort",
      "idx_tools_category_latest_sort",
      "idx_tools_featured_latest_sort",
      "idx_tools_latest_sort",
      "idx_tools_category_latest_sort"
    ];
    expectedToolPlanIndexes.forEach((indexName, index) => {
      assert.ok(
        toolPlanChecks[index].results.some((row) =>
          String(row.detail ?? "").includes(indexName)
        ),
        `Expected tool query plan to use ${indexName}.`
      );
    });
    assert.ok(
      toolPlanChecks.every((plan) =>
        plan.results.every(
          (row) => !String(row.detail ?? "").includes("USE TEMP B-TREE")
        )
      ),
      "Expected tool list queries to avoid temporary sorting or grouping."
    );

    const orderingChecks = await runWrangler(root, configPath, persistPath, [
      "--command",
      `INSERT INTO articles
         (id, slug, title, summary, content, category, tags, published,
          created_at, updated_at, published_at)
       VALUES
         ('order-a', 'order-a', 'Alpha', '', '', 'guide', '[]', 1,
          '2026-01-01', '2026-01-01', '2026-03-01'),
         ('order-b', 'order-b', 'Beta', '', '', 'guide', '[]', 1,
          '2026-01-01', '2026-01-01', '2026-03-01'),
         ('order-fallback', 'order-fallback', 'Fallback', '', '', 'guide', '[]', 1,
          '2026-01-01', '2026-02-01', NULL),
         ('order-draft', 'order-draft', 'Draft', '', '', 'guide', '[]', 0,
          '2026-01-01', '2026-04-01', NULL);
       INSERT INTO content_items
         (id, source_id, external_id, title, summary, url, author, tags,
          created_at, updated_at, published_at)
       VALUES
         ('item-a', 'search-source', 'order-a', 'Alpha', '',
          'https://example.com/order-a', '', '[]',
          '2026-01-01', '2026-01-01', '2026-03-01'),
         ('item-b', 'search-source', 'order-b', 'Beta', '',
          'https://example.com/order-b', '', '[]',
          '2026-01-01', '2026-01-01', '2026-03-01'),
         ('item-fallback', 'search-source', 'order-fallback', 'Fallback', '',
          'https://example.com/order-fallback', '', '[]',
          '2026-01-01', '2026-02-01', NULL);
       SELECT id FROM articles
       WHERE published = 1
       ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC;
       SELECT id FROM articles
       WHERE COALESCE(published_at, updated_at, created_at) < '2026-03-01'
          OR (COALESCE(published_at, updated_at, created_at) = '2026-03-01'
              AND id < 'order-b')
       ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC;
       SELECT id FROM content_items
       WHERE COALESCE(published_at, updated_at, created_at) < '2026-03-01'
          OR (COALESCE(published_at, updated_at, created_at) = '2026-03-01'
              AND id < 'item-b')
       ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC`
    ]);
    assert.deepEqual(orderingChecks[2].results, [
      { id: "order-b" },
      { id: "order-a" },
      { id: "order-fallback" }
    ]);
    assert.deepEqual(orderingChecks[3].results, [
      { id: "order-a" },
      { id: "order-fallback" }
    ]);
    assert.deepEqual(orderingChecks[4].results, [
      { id: "item-a" },
      { id: "item-fallback" }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("Pages Functions automatically initialize and upgrade a real local D1 database", {
  timeout: 180_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "htools-pages-d1-integration-"));
  const assetsPath = join(root, "assets");
  const configPath = join(root, "wrangler.json");
  const emptyPersistPath = join(root, "empty-persist");
  const legacyPersistPath = join(root, "legacy-persist");
  const version14PersistPath = join(root, "version-14-persist");
  const version15PersistPath = join(root, "version-15-persist");
  let pagesProcess = null;

  try {
    await mkdir(assetsPath, { recursive: true });
    await writeFile(join(assetsPath, "index.html"), "<!doctype html><title>test</title>");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "htools-pages-d1-integration",
        compatibility_date: "2026-06-30",
        d1_databases: [
          {
            binding: "DB",
            database_name: "DB",
            database_id: "DB"
          }
        ]
      }),
      "utf8"
    );

    const emptyPages = await startPagesDev(assetsPath, emptyPersistPath);
    pagesProcess = emptyPages.child;
    const emptyBody = await emptyPages.response.json();
    assert.deepEqual(emptyBody, {
      tools: [],
      limit: 16,
      hasMore: false,
      nextCursor: null,
      total: 0,
      categoryCounts: {},
      featuredTotal: 0
    });
    await stopPagesDev(pagesProcess);
    pagesProcess = null;

    const emptyChecks = await runWrangler(
      root,
      configPath,
      emptyPersistPath,
      [
        "--command",
        `SELECT COUNT(*) AS total FROM sqlite_master
         WHERE type = 'table' AND name IN
           ('tools', 'app_settings', 'articles', 'content_sources',
            'content_items', 'telegram_messages', 'telegram_push_locks');
         SELECT value FROM app_settings WHERE key = 'database_schema_version'`
      ]
    );
    assert.equal(emptyChecks[0].results[0].total, 7);
    assert.deepEqual(emptyChecks[1].results, [{ value: "17" }]);

    await runWrangler(root, configPath, legacyPersistPath, [
      "--command",
      `CREATE TABLE tools (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         description TEXT NOT NULL,
         url TEXT NOT NULL,
         demo_url TEXT NOT NULL DEFAULT '',
         image TEXT NOT NULL,
         category TEXT NOT NULL,
         tags TEXT NOT NULL DEFAULT '[]',
         featured INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       INSERT INTO tools (id, name, description, url, image, category)
       VALUES ('legacy-tool', 'Legacy', 'Preserve me',
               'https://example.com/legacy', '', 'test');
       CREATE TABLE app_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       INSERT INTO app_settings (key, value) VALUES
         ('database_schema_version', '8'),
         ('github_settings',
          '{"enabled":true,"owner":" legacy-owner ","repo":" legacy-repo ","clientId":"visitor-client","clientSecret":"visitor-secret","labels":["tool"]}'),
         ('github_submission_cooldown:legacy-user', '2026-07-18T00:00:00.000Z');
       CREATE TABLE github_oauth_states (
         state TEXT PRIMARY KEY,
         code_verifier TEXT NOT NULL,
         expires_at TEXT NOT NULL
       );
       INSERT INTO github_oauth_states VALUES
         ('legacy-state', 'legacy-verifier', '2099-01-01T00:00:00.000Z');
       CREATE TABLE github_sessions (
         id TEXT PRIMARY KEY,
         github_user_id TEXT NOT NULL,
         github_login TEXT NOT NULL,
         access_token TEXT NOT NULL,
         expires_at TEXT NOT NULL
       );
       INSERT INTO github_sessions VALUES
         ('legacy-session', '1', 'legacy-user', 'legacy-token',
          '2099-01-01T00:00:00.000Z');
       CREATE TABLE telegram_tool_messages (
         id TEXT PRIMARY KEY,
         tool_id TEXT NOT NULL,
         chat_id TEXT NOT NULL,
         target_ref TEXT NOT NULL DEFAULT '',
         message_id TEXT NOT NULL,
         message_markdown TEXT NOT NULL DEFAULT '',
         media_enabled INTEGER NOT NULL DEFAULT 1,
         media_url TEXT NOT NULL DEFAULT '',
         last_pushed_hash TEXT NOT NULL DEFAULT '',
         sent_at TEXT NOT NULL DEFAULT '',
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       INSERT INTO telegram_tool_messages (
         id, tool_id, chat_id, target_ref, message_id, message_markdown,
         media_enabled, media_url, last_pushed_hash, sent_at, updated_at
       ) VALUES (
         'legacy-telegram', 'legacy-tool', '-1001234567890', '-1001234567890',
         '42', '**Legacy**', 1, 'https://example.com/legacy.png',
         'legacy-hash', '2026-07-20T00:00:00.000Z',
         '2026-07-20T00:00:00.000Z'
       )`
    ]);

    const legacyPages = await startPagesDev(assetsPath, legacyPersistPath);
    pagesProcess = legacyPages.child;
    const legacyBody = await legacyPages.response.json();
    assert.equal(legacyBody.tools.length, 1);
    assert.equal(legacyBody.tools[0].id, "legacy-tool");
    await stopPagesDev(pagesProcess);
    pagesProcess = null;

    const legacyChecks = await runWrangler(
      root,
      configPath,
      legacyPersistPath,
      [
        "--command",
        `PRAGMA table_info(tools);
         SELECT github_language, github_license FROM tools
         WHERE id = 'legacy-tool';
         SELECT value FROM app_settings WHERE key = 'database_schema_version';
         SELECT name FROM sqlite_master WHERE type = 'table'
         AND name IN ('github_oauth_states', 'github_sessions') ORDER BY name;
         SELECT value FROM app_settings WHERE key = 'github_settings';
         SELECT COUNT(*) AS total FROM app_settings
         WHERE key LIKE 'github_submission_cooldown:%';
         SELECT name FROM sqlite_master WHERE type = 'table'
         AND name IN ('telegram_messages', 'telegram_tool_messages')
         ORDER BY name;
         SELECT resource_type, resource_id, chat_id, target_ref, message_id,
                message_markdown, media_enabled, media_url, last_pushed_hash
         FROM telegram_messages WHERE id = 'legacy-telegram';
         SELECT name FROM sqlite_master WHERE type = 'index'
         AND name = 'idx_telegram_messages_resource'`
      ]
    );
    const legacyColumns = legacyChecks[0].results.map((column) => column.name);
    assert.ok(legacyColumns.includes("github_language"));
    assert.ok(legacyColumns.includes("github_license"));
    assert.deepEqual(legacyChecks[1].results, [
      { github_language: "", github_license: "" }
    ]);
    assert.deepEqual(legacyChecks[2].results, [{ value: "17" }]);
    assert.deepEqual(legacyChecks[3].results, []);
    assert.deepEqual(JSON.parse(legacyChecks[4].results[0].value), {
      enabled: true,
      owner: "legacy-owner",
      repo: "legacy-repo",
      labels: ["tool"]
    });
    assert.equal(legacyChecks[5].results[0].total, 0);
    assert.deepEqual(legacyChecks[6].results, [{ name: "telegram_messages" }]);
    assert.deepEqual(legacyChecks[7].results, [{
      resource_type: "tool",
      resource_id: "legacy-tool",
      chat_id: "-1001234567890",
      target_ref: "-1001234567890",
      message_id: "42",
      message_markdown: "**Legacy**",
      media_enabled: 1,
      media_url: "https://example.com/legacy.png",
      last_pushed_hash: "legacy-hash"
    }]);
    assert.deepEqual(legacyChecks[8].results, [
      { name: "idx_telegram_messages_resource" }
    ]);

    await runWrangler(root, configPath, version14PersistPath, [
      "--command",
      `CREATE TABLE app_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       INSERT INTO app_settings (key, value)
       VALUES ('database_schema_version', '14');
       CREATE TABLE telegram_messages (
         id TEXT PRIMARY KEY,
         resource_type TEXT NOT NULL CHECK (resource_type IN ('tool', 'article', 'custom')),
         resource_id TEXT NOT NULL,
         custom_title TEXT NOT NULL DEFAULT '',
         resource_data TEXT NOT NULL DEFAULT '',
         category TEXT NOT NULL DEFAULT '',
         chat_id TEXT NOT NULL,
         target_ref TEXT NOT NULL DEFAULT '',
         message_id TEXT NOT NULL,
         message_markdown TEXT NOT NULL DEFAULT '',
         media_enabled INTEGER NOT NULL DEFAULT 0,
         media_url TEXT NOT NULL DEFAULT '',
         last_pushed_hash TEXT NOT NULL DEFAULT '',
         sent_at TEXT NOT NULL DEFAULT '',
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE(resource_type, resource_id, chat_id)
       );
       CREATE INDEX idx_telegram_messages_resource
       ON telegram_messages (resource_type, resource_id, updated_at DESC);
       INSERT INTO telegram_messages (
         id, resource_type, resource_id, custom_title, resource_data, category,
         chat_id, target_ref, message_id, message_markdown, media_enabled,
         media_url, last_pushed_hash, sent_at, updated_at
       ) VALUES (
         'v14-record', 'custom', 'custom-v14', 'Version 14',
         '{"type":"custom","id":"custom-v14","title":"Version 14","description":"Keep every field","url":"","demoUrl":"","image":"","category":"archive","tags":["v14"]}',
         'archive', '-1001234567890', '-1001234567890', '88',
         '**Version 14**', 1, 'https://example.com/v14.png', 'v14-hash',
         '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z'
       )`
    ]);

    const version14Pages = await startPagesDev(assetsPath, version14PersistPath);
    pagesProcess = version14Pages.child;
    await version14Pages.response.json();
    await stopPagesDev(pagesProcess);
    pagesProcess = null;

    const version14Checks = await runWrangler(
      root,
      configPath,
      version14PersistPath,
      [
        "--command",
        `SELECT value FROM app_settings WHERE key = 'database_schema_version';
         SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'telegram_messages';
         SELECT id, resource_type, resource_id, custom_title, resource_data, category,
                chat_id, target_ref, message_id, message_markdown, media_enabled,
                media_url, last_pushed_hash, sent_at, updated_at
         FROM telegram_messages WHERE id = 'v14-record';
         SELECT name FROM sqlite_master WHERE type = 'index'
         AND name = 'idx_telegram_messages_resource';
         SELECT name FROM sqlite_master WHERE type = 'table'
         AND name = 'telegram_push_locks'`
      ]
    );
    assert.deepEqual(version14Checks[0].results, [{ value: "17" }]);
    assert.match(version14Checks[1].results[0].sql, /'content'/);
    assert.deepEqual(version14Checks[2].results, [{
      id: "v14-record",
      resource_type: "custom",
      resource_id: "custom-v14",
      custom_title: "Version 14",
      resource_data: '{"type":"custom","id":"custom-v14","title":"Version 14","description":"Keep every field","url":"","demoUrl":"","image":"","category":"archive","tags":["v14"]}',
      category: "archive",
      chat_id: "-1001234567890",
      target_ref: "-1001234567890",
      message_id: "88",
      message_markdown: "**Version 14**",
      media_enabled: 1,
      media_url: "https://example.com/v14.png",
      last_pushed_hash: "v14-hash",
      sent_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z"
    }]);
    assert.deepEqual(version14Checks[3].results, [
      { name: "idx_telegram_messages_resource" }
    ]);
    assert.deepEqual(version14Checks[4].results, [
      { name: "telegram_push_locks" }
    ]);

    await runWrangler(root, configPath, version15PersistPath, [
      "--command",
      `CREATE TABLE app_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       INSERT INTO app_settings (key, value)
       VALUES ('database_schema_version', '15');
       CREATE TABLE telegram_messages (
         id TEXT PRIMARY KEY,
         resource_type TEXT NOT NULL CHECK (resource_type IN ('tool', 'article', 'content', 'custom')),
         resource_id TEXT NOT NULL,
         custom_title TEXT NOT NULL DEFAULT '',
         resource_data TEXT NOT NULL DEFAULT '',
         category TEXT NOT NULL DEFAULT '',
         chat_id TEXT NOT NULL,
         target_ref TEXT NOT NULL DEFAULT '',
         message_id TEXT NOT NULL,
         message_markdown TEXT NOT NULL DEFAULT '',
         media_enabled INTEGER NOT NULL DEFAULT 0,
         media_url TEXT NOT NULL DEFAULT '',
         last_pushed_hash TEXT NOT NULL DEFAULT '',
         sent_at TEXT NOT NULL DEFAULT '',
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE(resource_type, resource_id, chat_id)
       );
       INSERT INTO telegram_messages (
         id, resource_type, resource_id, custom_title, resource_data, category,
         chat_id, target_ref, message_id, message_markdown, media_enabled,
         media_url, last_pushed_hash, sent_at, updated_at
       ) VALUES (
         'v15-record', 'custom', 'custom-v15', 'Version 15',
         '{"type":"custom","id":"custom-v15","title":"Version 15","description":"Keep the record","url":"","demoUrl":"","image":"","category":"archive","tags":[]}',
         'archive', '', '', '', '**Version 15**', 0, '', '', '',
         '2026-08-07T00:00:00.000Z'
       )`
    ]);

    const version15Pages = await startPagesDev(assetsPath, version15PersistPath);
    pagesProcess = version15Pages.child;
    await version15Pages.response.json();
    await stopPagesDev(pagesProcess);
    pagesProcess = null;

    const version15Checks = await runWrangler(
      root,
      configPath,
      version15PersistPath,
      [
        "--command",
        `SELECT value FROM app_settings WHERE key = 'database_schema_version';
         SELECT name FROM sqlite_master WHERE type = 'table'
         AND name = 'telegram_push_locks';
         SELECT id, custom_title, message_markdown, updated_at
         FROM telegram_messages WHERE id = 'v15-record'`
      ]
    );
    assert.deepEqual(version15Checks[0].results, [{ value: "17" }]);
    assert.deepEqual(version15Checks[1].results, [{ name: "telegram_push_locks" }]);
    assert.deepEqual(version15Checks[2].results, [{
      id: "v15-record",
      custom_title: "Version 15",
      message_markdown: "**Version 15**",
      updated_at: "2026-08-07T00:00:00.000Z"
    }]);
  } finally {
    if (pagesProcess) await stopPagesDev(pagesProcess);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("public article pages use stable cursors, category filters, and isolated caches", {
  timeout: 180_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "htools-public-articles-integration-"));
  const assetsPath = join(root, "assets");
  const configPath = join(root, "wrangler.json");
  const persistPath = join(root, "persist");
  let pagesProcess = null;

  try {
    await mkdir(assetsPath, { recursive: true });
    await writeFile(join(assetsPath, "index.html"), "<!doctype html><title>test</title>");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "htools-public-articles-integration",
        compatibility_date: "2026-06-30",
        d1_databases: [
          { binding: "DB", database_name: "DB", database_id: "DB" }
        ]
      }),
      "utf8"
    );
    await runWrangler(root, configPath, persistPath, ["--file", schemaPath]);
    await runWrangler(root, configPath, persistPath, [
      "--command",
      `INSERT INTO articles
         (id, slug, title, summary, content, category, tags, published,
          created_at, updated_at, published_at)
       VALUES
         ('public-b', 'public-b', 'Public B', 'Summary B',
          'private body sentinel B', 'news', '[]', 1,
          '2026-01-01', '2026-01-01', '2026-03-01'),
         ('public-a', 'public-a', 'Public A', 'Summary A',
          'private body sentinel A', 'news', '[]', 1,
          '2026-01-01', '2026-01-01', '2026-03-01'),
         ('guide-1', 'guide-1', 'Guide', 'Guide summary',
          'private guide body', 'guide', '[]', 1,
          '2026-01-01', '2026-01-01', '2026-02-01'),
         ('fallback-1', 'fallback-1', 'Fallback', 'Fallback summary',
          'private fallback body', 'guide', '[]', 1,
          '2026-01-01', '2026-01-15', NULL),
         ('draft-1', 'draft-1', 'Draft', 'Draft summary',
          'private draft body', 'news', '[]', 0,
          '2026-01-01', '2026-04-01', NULL)`
    ]);

    const pages = await startPagesDev(assetsPath, persistPath);
    pagesProcess = pages.child;
    const origin = new URL(pages.response.url).origin;
    const first = await fetch(`${origin}/api/articles?limit=2`);
    const firstBody = await first.json();

    assert.equal(first.status, 200);
    assert.equal(first.headers.get("X-HTools-Cache"), "MISS");
    assert.deepEqual(firstBody.articles.map((article) => article.id), [
      "public-b",
      "public-a"
    ]);
    assert.equal(firstBody.total, 4);
    assert.deepEqual(firstBody.categoryCounts, { guide: 2, news: 2 });
    assert.equal(firstBody.hasMore, true);
    assert.ok(firstBody.nextCursor);
    assert.ok(firstBody.articles.every((article) => !("content" in article)));
    assert.doesNotMatch(JSON.stringify(firstBody), /private .* body/);

    const repeated = await waitForCacheHit(`${origin}/api/articles?limit=2`);
    assert.equal(repeated.headers.get("X-HTools-Cache"), "HIT");

    const second = await fetch(
      `${origin}/api/articles?limit=2&counts=0&cursor=${encodeURIComponent(firstBody.nextCursor)}`
    );
    const secondBody = await second.json();
    assert.equal(second.headers.get("X-HTools-Cache"), "MISS");
    assert.deepEqual(secondBody.articles.map((article) => article.id), [
      "guide-1",
      "fallback-1"
    ]);
    assert.equal(secondBody.hasMore, false);
    assert.equal(secondBody.total, null);
    assert.equal(secondBody.categoryCounts, null);

    const guide = await fetch(`${origin}/api/articles?category=guide&limit=10`);
    const guideBody = await guide.json();
    assert.equal(guide.headers.get("X-HTools-Cache"), "MISS");
    assert.deepEqual(guideBody.articles.map((article) => article.id), [
      "guide-1",
      "fallback-1"
    ]);

    const invalid = await fetch(
      `${origin}/api/articles?category=news&cursor=${encodeURIComponent(firstBody.nextCursor)}`
    );
    assert.equal(invalid.status, 400);
  } finally {
    if (pagesProcess) await stopPagesDev(pagesProcess);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("public tool pages and search are independent while admin still loads all tools", {
  timeout: 180_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "htools-public-tools-integration-"));
  const assetsPath = join(root, "assets");
  const configPath = join(root, "wrangler.json");
  const persistPath = join(root, "persist");
  let pagesProcess = null;

  try {
    await mkdir(assetsPath, { recursive: true });
    await writeFile(join(assetsPath, "index.html"), "<!doctype html><title>test</title>");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "htools-public-tools-integration",
        compatibility_date: "2026-06-30",
        d1_databases: [
          { binding: "DB", database_name: "DB", database_id: "DB" }
        ]
      }),
      "utf8"
    );
    await runWrangler(root, configPath, persistPath, ["--file", schemaPath]);
    const values = Array.from({ length: 21 }, (_, offset) => {
      const index = offset + 1;
      const id = `tool-${String(index).padStart(2, "0")}`;
      const name = index === 21 ? "Needle Tool" : `Tool ${index}`;
      const category = index % 2 === 0 ? "Developer Tools" : "Email";
      const featured = index % 5 === 0 ? 1 : 0;
      const day = String(31 - index).padStart(2, "0");
      return `('${id}', '${name}', 'Description ${index}',
        'https://example.com/${id}', '', '', '${category}', '[]', '', '',
        ${featured}, '2026-01-${day}T00:00:00.000Z',
        '2026-01-${day}T00:00:00.000Z')`;
    }).join(",\n");
    await runWrangler(root, configPath, persistPath, [
      "--command",
      `INSERT INTO tools
         (id, name, description, url, demo_url, image, category, tags,
          github_language, github_license, featured, created_at, updated_at)
       VALUES ${values}`
    ]);

    const pages = await startPagesDev(assetsPath, persistPath);
    pagesProcess = pages.child;
    const origin = new URL(pages.response.url).origin;
    const home = await fetch(`${origin}/api/tools?limit=8&counts=0`);
    const homeBody = await home.json();
    assert.equal(home.headers.get("X-HTools-Cache"), "MISS");
    assert.equal(homeBody.tools.length, 8);
    assert.equal(homeBody.hasMore, true);
    assert.equal(homeBody.categoryCounts, null);

    const homeHit = await waitForCacheHit(`${origin}/api/tools?limit=8&counts=0`);
    assert.equal(homeHit.headers.get("X-HTools-Cache"), "HIT");

    const first = await fetch(`${origin}/api/tools?limit=16`);
    const firstBody = await first.json();
    assert.equal(first.headers.get("X-HTools-Cache"), "HIT");
    assert.equal(firstBody.tools.length, 16);
    assert.equal(firstBody.total, 21);
    assert.equal(firstBody.hasMore, true);
    assert.ok(firstBody.nextCursor);
    assert.deepEqual(firstBody.categoryCounts, {
      "Developer Tools": 10,
      Email: 11
    });
    assert.equal(firstBody.featuredTotal, 4);

    const second = await fetch(
      `${origin}/api/tools?limit=16&counts=0&cursor=${encodeURIComponent(firstBody.nextCursor)}`
    );
    const secondBody = await second.json();
    assert.equal(second.headers.get("X-HTools-Cache"), "MISS");
    assert.equal(secondBody.tools.length, 5);
    assert.equal(secondBody.hasMore, false);
    assert.equal(secondBody.tools.at(-1).id, "tool-21");
    assert.equal(
      new Set([...firstBody.tools, ...secondBody.tools].map((tool) => tool.id)).size,
      21
    );

    const featured = await fetch(`${origin}/api/tools?featured=1&limit=16`);
    const featuredBody = await featured.json();
    assert.equal(featuredBody.tools.length, 4);
    assert.ok(featuredBody.tools.every((tool) => tool.featured === true));

    const search = await fetch(`${origin}/api/tools/search?q=Needle`);
    const searchBody = await search.json();
    assert.equal(search.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(searchBody.tools.map((tool) => tool.id), ["tool-21"]);

    const loginResponse = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" })
    });
    const login = await loginResponse.json();
    const admin = await fetch(`${origin}/api/admin/tools`, {
      headers: { Authorization: `Bearer ${login.token}` }
    });
    const adminBody = await admin.json();
    assert.equal(admin.status, 200);
    assert.equal(adminBody.tools.length, 21);
  } finally {
    if (pagesProcess) await stopPagesDev(pagesProcess);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("public API cache hits, revalidates, and invalidates after admin writes", {
  timeout: 180_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "htools-public-cache-integration-"));
  const assetsPath = join(root, "assets");
  const configPath = join(root, "wrangler.json");
  const persistPath = join(root, "persist");
  let pagesProcess = null;

  try {
    await mkdir(assetsPath, { recursive: true });
    await writeFile(join(assetsPath, "index.html"), "<!doctype html><title>test</title>");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "htools-public-cache-integration",
        compatibility_date: "2026-06-30",
        d1_databases: [
          {
            binding: "DB",
            database_name: "DB",
            database_id: "DB"
          }
        ]
      }),
      "utf8"
    );
    await runWrangler(root, configPath, persistPath, ["--file", schemaPath]);
    await runWrangler(root, configPath, persistPath, [
      "--command",
      `INSERT INTO tools
         (id, name, description, url, image, category, created_at, updated_at)
       VALUES
         ('cached-tool', 'Cached Tool', 'Initial tool',
          'https://example.com/cached-tool', '', 'test',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
       INSERT INTO app_settings (key, value, updated_at)
       VALUES ('source_public_enabled', '{"enabled":true}', CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    ]);

    const pages = await startPagesDev(assetsPath, persistPath);
    pagesProcess = pages.child;
    const origin = new URL(pages.response.url).origin;
    const firstTools = pages.response;
    const secondTools = await waitForCacheHit(`${origin}/api/tools`);
    const etag = secondTools.headers.get("ETag");
    assert.ok(etag);
    const conditionalTools = await fetch(`${origin}/api/tools`, {
      headers: { "If-None-Match": etag }
    });

    assert.equal(firstTools.headers.get("X-HTools-Cache"), "MISS");
    assert.equal(secondTools.headers.get("X-HTools-Cache"), "HIT");
    assert.equal(conditionalTools.status, 304);
    assert.equal(await conditionalTools.text(), "");

    const loginResponse = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" })
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    const authorization = { Authorization: `Bearer ${login.token}` };

    const identityResponse = await fetch(`${origin}/api/admin/site-settings`, {
      method: "PATCH",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        section: "identity",
        name: "Sectioned HTools",
        subtitle: "Identity only",
        iconUrl: ""
      })
    });
    const identityBody = await identityResponse.json();
    assert.equal(identityResponse.status, 200);
    assert.equal(identityBody.settings.name, "Sectioned HTools");
    assert.ok(identityBody.settings.aboutContent);

    const aboutContent = {
      zh: "# Independent about draft",
      en: "# Independent English about draft"
    };
    const aboutResponse = await fetch(`${origin}/api/admin/site-settings`, {
      method: "PATCH",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        section: "about",
        aboutContent
      })
    });
    const aboutBody = await aboutResponse.json();
    assert.equal(aboutResponse.status, 200);
    assert.equal(aboutBody.settings.name, "Sectioned HTools");
    assert.deepEqual(aboutBody.settings.aboutContent, aboutContent);

    const homeHero = {
      zh: {
        titleTop: "中文首行",
        titleBottom: "中文次行",
        description: "中文简介"
      },
      en: {
        titleTop: "English first",
        titleBottom: "English second",
        description: "English description"
      }
    };
    const homeResponse = await fetch(`${origin}/api/admin/site-settings`, {
      method: "PATCH",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ section: "home", homeHero })
    });
    const homeBody = await homeResponse.json();
    assert.equal(homeResponse.status, 200);
    assert.deepEqual(homeBody.settings.homeHero, homeHero);

    const basicSettingsResponse = await fetch(`${origin}/api/site-settings?scope=basic`);
    const basicSettingsBody = await basicSettingsResponse.json();
    assert.equal(basicSettingsResponse.status, 200);
    assert.deepEqual(basicSettingsBody.settings.homeHero, homeHero);

    const footer = {
      description: "Independent footer",
      authorName: "HTools",
      authorUrl: "https://github.com/shaoyouvip/htools",
      copyright: "© 2026 HTools",
      sponsorLabel: "Support",
      sponsorUrl: "https://example.com/support",
      socialLinks: [{ label: "GitHub", href: "https://github.com/shaoyouvip/htools" }],
      groups: [{ title: "Product", links: [{ label: "Tools", href: "/tools" }] }]
    };
    const footerResponse = await fetch(`${origin}/api/admin/site-settings`, {
      method: "PATCH",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ section: "footer", footer })
    });
    const footerBody = await footerResponse.json();
    assert.equal(footerResponse.status, 200);
    assert.equal(footerBody.settings.name, "Sectioned HTools");
    assert.deepEqual(footerBody.settings.aboutContent, aboutContent);
    assert.equal(footerBody.settings.footer.description, "Independent footer");
    assert.deepEqual(footerBody.settings.homeHero, homeHero);

    const createResponse = await fetch(`${origin}/api/admin/tools`, {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "New Cached Tool",
        description: "Invalidates the public list cache",
        url: "https://example.com/new-cached-tool",
        demoUrl: "",
        image: "",
        category: "test",
        tags: ["Cache"],
        featured: false
      })
    });
    assert.equal(createResponse.status, 201);

    const refreshedTools = await fetch(`${origin}/api/tools`);
    const refreshedBody = await refreshedTools.json();
    assert.equal(refreshedTools.headers.get("X-HTools-Cache"), "MISS");
    assert.equal(refreshedBody.tools.length, 2);
    assert.notEqual(refreshedTools.headers.get("ETag"), etag);

    const firstSource = await fetch(`${origin}/api/htools.json`);
    const secondSource = await waitForCacheHit(`${origin}/api/htools.json`);
    assert.equal(firstSource.status, 200);
    assert.equal(firstSource.headers.get("X-HTools-Cache"), "MISS");
    assert.equal(secondSource.headers.get("X-HTools-Cache"), "HIT");
    assert.equal(
      secondSource.headers.get("Cache-Control"),
      "public, no-cache, max-age=0"
    );

    const disableResponse = await fetch(`${origin}/api/admin/source-settings`, {
      method: "PUT",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(disableResponse.status, 200);
    const disabledSource = await fetch(`${origin}/api/htools.json`);
    const disabledAgain = await fetch(`${origin}/api/htools.json`);
    assert.equal(disabledSource.status, 404);
    assert.equal(disabledAgain.status, 404);
    assert.notEqual(disabledAgain.headers.get("X-HTools-Cache"), "HIT");
    assert.equal(disabledAgain.headers.get("Cache-Control"), "no-store");
  } finally {
    if (pagesProcess) await stopPagesDev(pagesProcess);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("full backup round-trips all current data without exporting secrets", {
  timeout: 180_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "htools-backup-roundtrip-"));
  const assetsPath = join(root, "assets");
  const configPath = join(root, "wrangler.json");
  const persistPath = join(root, "persist");
  let pagesProcess = null;

  try {
    await mkdir(assetsPath, { recursive: true });
    await writeFile(join(assetsPath, "index.html"), "<!doctype html><title>test</title>");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "htools-backup-roundtrip",
        compatibility_date: "2026-06-30",
        d1_databases: [
          { binding: "DB", database_name: "DB", database_id: "DB" }
        ]
      }),
      "utf8"
    );
    await runWrangler(root, configPath, persistPath, ["--file", schemaPath]);
    await runWrangler(root, configPath, persistPath, [
      "--command",
      `INSERT INTO tools
         (id, name, description, url, demo_url, image, category, tags,
          github_language, github_license, featured, created_at, updated_at)
       VALUES
         ('backup-tool', 'Backup Tool', 'Tool description',
          'https://example.com/tool', 'https://example.com/demo', '',
          'Developer', '["D1"]', 'TypeScript', 'MIT', 1,
          '2026-01-01', '2026-01-02');
       INSERT INTO content_sources
         (id, title, url, site_url, description, category, tags, enabled,
          created_at, updated_at, last_synced_at)
       VALUES
         ('backup-source', 'Backup Source', 'https://example.com/feed.xml',
          'https://example.com', 'Source description', 'News', '["RSS"]', 1,
          '2026-01-01', '2026-01-02', '2026-01-03');
       INSERT INTO content_items
         (id, source_id, external_id, title, summary, content, url, author,
          cover_image, category, tags, published_at, synced_at, created_at,
          updated_at, article_id)
       VALUES
         ('backup-item', 'backup-source', 'external-1', 'Backup Item',
          'Item summary', 'Item body', 'https://example.com/item', 'Author',
          '', 'News', '["RSS"]', '2026-01-04', '2026-01-04',
          '2026-01-01', '2026-01-04', 'backup-article');
       INSERT INTO articles
         (id, slug, title, summary, content, cover_image, category, tags,
          published, created_at, updated_at, published_at, content_item_id)
       VALUES
         ('backup-article', 'backup-article', 'Backup Article',
          'Article summary', 'Article body', '', 'News', '["D1"]', 1,
          '2026-01-01', '2026-01-04', '2026-01-04', 'backup-item');
       INSERT INTO telegram_messages
         (id, resource_type, resource_id, custom_title, resource_data, category, chat_id, target_ref,
          message_id, message_markdown, media_enabled, media_url,
          last_pushed_hash, sent_at, updated_at)
       VALUES
         ('backup-message', 'tool', 'backup-tool', '', '', 'News', '-1001234567890',
          '-1001234567890', '42', '**Backup Tool**', 0, '', 'hash',
          '2026-01-05', '2026-01-05');
       INSERT INTO telegram_push_locks
         (resource_type, resource_id, operation, lock_token, state, expires_at)
       VALUES
         ('tool', 'backup-tool', 'send', 'backup-lock-token', 'uncertain',
          '2099-01-01T00:00:00.000Z');
       INSERT INTO app_settings (key, value, updated_at) VALUES
         ('github_settings', '{"enabled":true,"owner":"owner","repo":"repo","labels":["tool"]}', CURRENT_TIMESTAMP),
         ('telegram_settings', '{"enabled":true,"target":"-1001234567890","footerMarkdown":"footer"}', CURRENT_TIMESTAMP),
         ('admin_turnstile_enabled', '{"enabled":true}', CURRENT_TIMESTAMP)`
    ]);

    const pages = await startPagesDev(assetsPath, persistPath);
    pagesProcess = pages.child;
    const origin = new URL(pages.response.url).origin;
    const loginResponse = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" })
    });
    const login = await loginResponse.json();
    const authorization = { Authorization: `Bearer ${login.token}` };

    const exportResponse = await fetch(`${origin}/api/admin/backup`, {
      headers: authorization
    });
    const backup = await exportResponse.json();
    assert.equal(exportResponse.status, 200, JSON.stringify(backup));
    assert.equal(backup.source, "htools-backup");
    assert.equal(backup.version, "4");
    assert.deepEqual(backup.counts, {
      tools: 1,
      articles: 1,
      contentSources: 1,
      contentItems: 1,
      telegramMessages: 1,
      settings: 3
    });
    const serializedBackup = JSON.stringify(backup);
    for (const secret of [
      "ADMIN_PASSWORD",
      "GITHUB_TOKEN",
      "TURNSTILE_SECRET_KEY",
      "TGTOKEN",
      "backup-lock-token",
      "test-password"
    ]) {
      assert.doesNotMatch(serializedBackup, new RegExp(secret));
    }

    // 会话签名密钥是随机值,只能先从库里读出来再确认它没被导出。
    const [sessionSecretQuery] = await runWrangler(root, configPath, persistPath, [
      "--command",
      "SELECT value FROM app_settings WHERE key = 'session_secret'"
    ]);
    const sessionSecret = sessionSecretQuery.results[0]?.value ?? "";
    assert.equal(
      sessionSecret.length,
      43,
      "登录后应该已经自动生成 32 字节(base64url 43 字符)的会话签名密钥"
    );
    assert.equal(
      serializedBackup.includes(sessionSecret),
      false,
      "会话签名密钥不得出现在备份里"
    );


    await runWrangler(root, configPath, persistPath, [
      "--command",
      `DELETE FROM telegram_messages;
       DELETE FROM content_items;
       DELETE FROM content_sources;
       DELETE FROM articles;
       DELETE FROM tools;
       DELETE FROM app_settings WHERE key IN
         ('github_settings', 'telegram_settings', 'admin_turnstile_enabled')`
    ]);

    const restoreResponse = await fetch(`${origin}/api/admin/backup`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify(backup)
    });
    const restored = await restoreResponse.json();
    assert.equal(restoreResponse.status, 200);
    assert.equal(restored.restored, true);
    assert.deepEqual(restored.counts, backup.counts);

    const checks = await runWrangler(root, configPath, persistPath, [
      "--command",
      `SELECT COUNT(*) AS total FROM tools WHERE id = 'backup-tool';
       SELECT COUNT(*) AS total FROM articles
       WHERE id = 'backup-article' AND content_item_id = 'backup-item';
       SELECT COUNT(*) AS total FROM content_sources WHERE id = 'backup-source';
       SELECT COUNT(*) AS total FROM content_items
       WHERE id = 'backup-item' AND article_id = 'backup-article';
       SELECT COUNT(*) AS total FROM telegram_messages
       WHERE id = 'backup-message' AND message_id = '42';
       SELECT COUNT(*) AS total FROM telegram_push_locks;
       SELECT COUNT(*) AS total FROM app_settings WHERE key IN
         ('github_settings', 'telegram_settings', 'admin_turnstile_enabled')`
    ]);
    assert.deepEqual(
      checks.map((entry) => entry.results[0].total),
      [1, 1, 1, 1, 1, 0, 3]
    );
  } finally {
    if (pagesProcess) await stopPagesDev(pagesProcess);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function waitForCacheHit(url, timeout = 3_000) {
  const startedAt = Date.now();
  let response = null;

  while (Date.now() - startedAt < timeout) {
    response = await fetch(url);
    if (response.headers.get("X-HTools-Cache") === "HIT") return response;
    await response.arrayBuffer();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(
    `Timed out waiting for cache HIT at ${url}; last status was ${response?.status}`
  );
}

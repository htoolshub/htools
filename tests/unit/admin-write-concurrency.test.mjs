import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
const compiled = [];
async function compile(path, importReplacements = {}, transformSource) {
  const result = await compileTypescriptModule(new URL(path, import.meta.url), {
    importReplacements, transformSource
  });
  compiled.push(result);
  return result;
}
const sharedBuild = await compile("../../functions/_shared.ts");
const shared = await import(sharedBuild.url.href);
const tagsBuild = await compile("../../shared/effective-tags.ts");
const telegramBuild = await compile("../../functions/_telegram.ts", {
  "./_shared": sharedBuild.url.href,
  "../shared/effective-tags": tagsBuild.url.href
});
async function route(path, depth, transformSource) {
  const result = await compile(path, {
    [`${"../".repeat(depth)}_shared`]: sharedBuild.url.href,
    [`${"../".repeat(depth)}_telegram`]: telegramBuild.url.href
  }, transformSource);
  return import(result.url.href);
}
const login = await route("../../functions/api/auth/login.ts", 2);
const sourceRoute = await route("../../functions/api/admin/content-sources/[id].ts", 3);
const categories = await route("../../functions/api/admin/categories.ts", 2);
const factoryReset = await route("../../functions/api/admin/factory-reset.ts", 2);
const backup = await route("../../functions/api/admin/backup.ts", 2,
  (source) => `${source}\nexport { restoreBackupData, validateBackupIntegrity };`);
after(async () => {
  for (const result of compiled.reverse()) await result.cleanup();
});

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  const state = { passwordReads: 0, failSql: null, batchSizes: [] };
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          assert.ok(next.length <= 100, "每条查询不能超过 D1 的 100 个绑定参数");
          values = next;
          return this;
        },
        async first() {
          if (values[0] === "admin_password") state.passwordReads += 1;
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() {
          if (state.failSql?.test(sql)) throw new Error("模拟关联写入失败");
          if (/^\s*SELECT\b/i.test(sql)) return { results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } };
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        }
      };
    },
    async batch(statements) {
      state.batchSizes.push(statements.length);
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { sqlite, db, state, env: { DB: db, ADMIN_PASSWORD: "test-initial-password" } };
}

function loginRequest(env, password = "incorrect-password", extra = {}) {
  return login.onRequestPost({ env, request: new Request("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.12" },
    body: JSON.stringify({ password, ...extra })
  }) });
}

async function adminContext(env, body, method = "POST") {
  const token = await shared.createToken(env);
  return {
    env, params: { id: "source-1" },
    request: new Request("https://example.com/api/admin/test", {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  };
}

function seedSource(sqlite, withItem = false) {
  sqlite.prepare("INSERT INTO content_sources (id, title, url, category, site_url, description) VALUES (?, ?, ?, ?, ?, ?)")
    .run("source-1", "Source", "https://example.com/feed.xml", "Original", "https://example.com/", "Original description");
  if (withItem) {
    sqlite.prepare("INSERT INTO content_items (id, source_id, external_id, title, url, category) VALUES (?, ?, ?, ?, ?, ?)")
      .run("item-existing", "source-1", "existing", "Existing", "https://example.com/existing", "Original");
  }
}

function feedResponse(prefix = "incoming", count = 1) {
  const items = Array.from({ length: count }, (_, index) =>
    `<item><guid>${prefix}-${index}</guid><title>${prefix} ${index}</title><link>https://example.com/${prefix}/${index}</link><description>Feed content</description></item>`).join("");
  return new Response(`<rss version="2.0"><channel><title>Feed</title><link>https://example.com/</link><description>Feed description</description>${items}</channel></rss>`,
    { headers: { "Content-Type": "application/rss+xml" } });
}

async function startPausedSync(t, db) {
  let finish;
  let fetched;
  const started = new Promise((resolve) => { fetched = resolve; });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url) === "https://example.com/new.xml") return feedResponse("new");
    assert.equal(String(url), "https://example.com/feed.xml");
    fetched();
    return new Promise((resolve) => { finish = resolve; });
  });
  const result = shared.syncContentSource(db, "source-1");
  await started;
  return { result, finish: (response = feedResponse()) => finish(response) };
}

async function rejectStaleSync(pending) {
  const rejected = assert.rejects(pending.result, (error) => {
    assert.ok(error instanceof shared.ConflictError);
    const response = shared.writeErrorResponse(error, "Synchronization failed.");
    assert.equal(response.status, 409);
    return true;
  });
  pending.finish();
  await rejected;
}

test("同一 IP 的 20 次并发登录只允许 5 次真实 PBKDF2 校验", async (t) => {
  const { env, sqlite, state } = fixture(t);
  await shared.saveAdminPassword(env, "test-new-password");
  const responses = await Promise.all(Array.from({ length: 20 }, () => loginRequest(env)));
  assert.equal(responses.filter((response) => response.status === 401).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 15);
  assert.equal(state.passwordReads, 5);
  assert.equal(sqlite.prepare("SELECT failed_count FROM admin_login_attempts").get().failed_count, 5);
  const blocked = await loginRequest(env, "test-new-password");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.equal(state.passwordReads, 5);
});

test("封禁和统计窗口在到期边界恢复，成功登录清空尝试记录", async (t) => {
  const now = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ["Date"], now });
  const { env, sqlite } = fixture(t);
  for (let index = 0; index < 5; index += 1) assert.equal((await loginRequest(env)).status, 401);
  t.mock.timers.setTime(now + 5 * 60_000 - 1);
  assert.equal((await loginRequest(env)).status, 429);
  t.mock.timers.setTime(now + 5 * 60_000);
  const success = await loginRequest(env, "test-initial-password");
  assert.equal(success.status, 200);
  const { token } = await success.json();
  assert.equal(await shared.requireAdmin(new Request("https://example.com/admin", {
    headers: { Authorization: `Bearer ${token}` }
  }), env), null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM admin_login_attempts").get().total, 0);

  for (let index = 0; index < 4; index += 1) await loginRequest(env);
  t.mock.timers.setTime(now + 15 * 60_000);
  assert.equal((await loginRequest(env)).status, 401);
  assert.equal(sqlite.prepare("SELECT failed_count FROM admin_login_attempts").get().failed_count, 1);
});

test("Turnstile 失败不占密码额度，封禁请求不访问 Turnstile", async (t) => {
  const { env, sqlite, state } = fixture(t);
  env.TURNSTILE_SITE_KEY = "test-site-key";
  env.TURNSTILE_SECRET_KEY = "test-secret-key";
  await shared.saveAdminTurnstileEnabled(env, true);
  let pass = false;
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ success: pass }));
  assert.equal((await loginRequest(env)).status, 400);
  assert.equal((await loginRequest(env, "incorrect-password", { turnstileToken: "test-token" })).status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM admin_login_attempts").get().total, 0);
  assert.equal(state.passwordReads, 0);
  pass = true;
  for (let index = 0; index < 5; index += 1) await loginRequest(env, "incorrect-password", { turnstileToken: "test-token" });
  const calls = fetch.mock.callCount();
  assert.equal((await loginRequest(env, "incorrect-password", { turnstileToken: "test-token" })).status, 429);
  assert.equal(fetch.mock.callCount(), calls);
});

test("正常同步跨多个 SQL 批次写入并更新已有内容", async (t) => {
  const { db, sqlite } = fixture(t);
  seedSource(sqlite);
  t.mock.method(globalThis, "fetch", async () => feedResponse("incoming", 8));
  const first = await shared.syncContentSource(db, "source-1");
  assert.equal(first.imported, 8);
  assert.equal(first.updated, 0);
  const second = await shared.syncContentSource(db, "source-1");
  assert.equal(second.imported, 0);
  assert.equal(second.updated, 8);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_items").get().total, 8);
});

for (const operation of ["source", "category", "all", "factory"]) {
  test(`同步等待期间通过 ${operation} 删除后不会写回孤儿内容`, async (t) => {
    const { db, env, sqlite } = fixture(t);
    seedSource(sqlite, true);
    const pending = await startPausedSync(t, db);
    let response;
    if (operation === "source") response = await sourceRoute.onRequestDelete(await adminContext(env, undefined, "DELETE"));
    else if (operation === "factory") response = await factoryReset.onRequestPost(await adminContext(env));
    else response = await categories.onRequestPost(await adminContext(env, {
      action: "delete", scope: "content", category: operation === "all" ? "All" : "Original"
    }));
    assert.equal(response.status, 200);
    await rejectStaleSync(pending);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_sources").get().total, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_items").get().total, 0);
  });
}

test("源配置变更后旧同步不覆盖分类、标签和启用状态", async (t) => {
  const { db, env, sqlite } = fixture(t);
  seedSource(sqlite, true);
  const pending = await startPausedSync(t, db);
  const response = await sourceRoute.onRequestPut(await adminContext(env, {
    title: "Changed", url: "https://example.com/feed.xml", category: "Changed", tags: ["new"], enabled: false
  }, "PUT"));
  assert.equal(response.status, 200);
  await rejectStaleSync(pending);
  const source = sqlite.prepare("SELECT * FROM content_sources").get();
  assert.equal(source.category, "Changed");
  assert.equal(source.tags, '["new"]');
  assert.equal(source.enabled, 0);
  assert.equal(sqlite.prepare("SELECT category FROM content_items").get().category, "Changed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_items").get().total, 1);
});

test("更换源地址后旧抓取被拒绝，新地址仍可正常同步", async (t) => {
  const { db, env, sqlite } = fixture(t);
  seedSource(sqlite, true);
  const pending = await startPausedSync(t, db);
  const response = await sourceRoute.onRequestPut(await adminContext(env, {
    title: "New", url: "https://example.com/new.xml", category: "New", tags: [], enabled: true
  }, "PUT"));
  assert.equal(response.status, 200);
  await rejectStaleSync(pending);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_items").get().total, 0);
  const next = await shared.syncContentSource(db, "source-1");
  assert.equal(next.imported, 1);
  assert.equal(sqlite.prepare("SELECT external_id FROM content_items").get().external_id, "new-0");
});

test("恢复相同源 ID 和时间的备份也会使恢复前的同步失效", async (t) => {
  const { db, sqlite } = fixture(t);
  seedSource(sqlite, true);
  const sources = sqlite.prepare("SELECT * FROM content_sources").all();
  const items = sqlite.prepare("SELECT * FROM content_items").all();
  const data = { tools: [], articles: [], contentSources: sources, contentItems: items, telegramMessages: [], settings: [] };
  const pending = await startPausedSync(t, db);
  await backup.restoreBackupData(db, data);
  await rejectStaleSync(pending);
  assert.deepEqual(sqlite.prepare("SELECT * FROM content_sources").all(), sources);
  assert.deepEqual(sqlite.prepare("SELECT * FROM content_items").all(), items);
  assert.ok(sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(shared.CONTENT_SOURCE_SYNC_EPOCH_KEY).value);
  assert.doesNotThrow(() => backup.validateBackupIntegrity(data));
});

test("删除后返回空 feed 也不会写回源状态或内容", async (t) => {
  const { db, env, sqlite } = fixture(t);
  seedSource(sqlite);
  const pending = await startPausedSync(t, db);
  await sourceRoute.onRequestDelete(await adminContext(env, undefined, "DELETE"));
  const rejected = assert.rejects(pending.result, /No feed items found/);
  pending.finish(feedResponse("empty", 0));
  await rejected;
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_sources").get().total, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM content_items").get().total, 0);
});

test("删除与配置迁移的关联 SQL 失败时整批回滚", async (t) => {
  for (const operation of ["delete", "url", "category", "migrate"]) {
    const { env, sqlite, state } = fixture(t);
    seedSource(sqlite, true);
    t.mock.method(globalThis, "fetch", async () => feedResponse());
    if (operation === "delete") {
      state.failSql = /DELETE FROM content_sources/;
      await assert.rejects(sourceRoute.onRequestDelete(await adminContext(env, undefined, "DELETE")), /模拟关联写入失败/);
    } else if (operation === "url") {
      state.failSql = /DELETE FROM content_items/;
      const response = await sourceRoute.onRequestPut(await adminContext(env, {
        title: "New", url: "https://example.com/new.xml", category: "New", tags: [], enabled: true
      }, "PUT"));
      assert.equal(response.status, 500);
    } else {
      state.failSql = operation === "category" ? /DELETE FROM content_sources/ : /UPDATE content_items/;
      const response = await categories.onRequestPost(await adminContext(env, {
        action: operation === "category" ? "delete" : "migrate", scope: "content", category: "Original", targetCategory: "New"
      }));
      assert.equal(response.status, 500);
    }
    assert.equal(sqlite.prepare("SELECT url FROM content_sources").get().url, "https://example.com/feed.xml");
    assert.equal(sqlite.prepare("SELECT category FROM content_sources").get().category, "Original");
    assert.equal(sqlite.prepare("SELECT category FROM content_items").get().category, "Original");
    assert.ok(state.batchSizes.includes(2));
  }
});

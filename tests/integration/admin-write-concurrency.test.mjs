import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

test("真实 workerd D1 执行同步守卫和登录并发限流", { timeout: 60_000 }, async (t) => {
  const compiled = [];
  const runtime = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    cf: false,
    telemetry: { enabled: false },
    workers: [{
      config: {
        name: "htools-admin-concurrency-test",
        compatibilityDate: "2026-06-30",
        manifest: {
          mainModule: "worker.mjs",
          modules: {
            "worker.mjs": { type: "esm", contents: "export default { fetch() { return new Response('integration'); } };" }
          }
        },
        env: { DB: { type: "d1", id: "admin-concurrency-db" } }
      },
      dev: { unsafeRegisterWorker: false }
    }]
  });
  try {
    const sharedBuild = await compileTypescriptModule(new URL("../../functions/_shared.ts", import.meta.url));
    compiled.push(sharedBuild);
    const shared = await import(sharedBuild.url.href);
    const replacements = { "../../_shared": sharedBuild.url.href };
    const loginBuild = await compileTypescriptModule(new URL("../../functions/api/auth/login.ts", import.meta.url), {
      importReplacements: replacements
    });
    compiled.push(loginBuild);
    const login = await import(loginBuild.url.href);
    const backupBuild = await compileTypescriptModule(new URL("../../functions/api/admin/backup.ts", import.meta.url), {
      importReplacements: replacements,
      transformSource: (source) => `${source}\nexport { restoreBackupData };`
    });
    compiled.push(backupBuild);
    const backup = await import(backupBuild.url.href);
    const db = await runtime.getD1Database("DB");
    await shared.ensureDatabaseSchema(db);
    const env = { DB: db, ADMIN_PASSWORD: "integration-initial-password" };

    await t.test("8 条内容跨两批 CTE 写入，100 个绑定参数可执行", async (subtest) => {
      await db.prepare("INSERT INTO content_sources (id, title, url, category) VALUES (?, ?, ?, ?)")
        .bind("source-1", "Integration", "https://example.com/feed.xml", "Integration").run();
      subtest.mock.method(globalThis, "fetch", async (url) => {
        assert.equal(String(url), "https://example.com/feed.xml");
        return feedResponse(8);
      });
      const first = await shared.syncContentSource(db, "source-1");
      assert.equal(first.imported, 8);
      assert.equal(first.items.length, 8);
      const second = await shared.syncContentSource(db, "source-1");
      assert.equal(second.imported, 0);
      assert.equal(second.updated, 8);
      assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM content_items").first()).total, 8);
    });

    await t.test("同 ID 原配置恢复后，在途同步不能重新写入", async (subtest) => {
      const sources = (await db.prepare("SELECT * FROM content_sources").all()).results;
      let finish;
      let fetched;
      const started = new Promise((resolve) => { fetched = resolve; });
      subtest.mock.method(globalThis, "fetch", async (url) => {
        assert.equal(String(url), "https://example.com/feed.xml");
        fetched();
        return new Promise((resolve) => { finish = resolve; });
      });
      const pending = shared.syncContentSource(db, "source-1").then(
        () => null,
        (error) => error
      );
      await started;
      try {
        await backup.restoreBackupData(db, {
          tools: [], articles: [], contentSources: sources, contentItems: [], telegramMessages: [], settings: []
        });
      } finally {
        finish(feedResponse(8));
      }
      assert.ok((await pending) instanceof shared.ConflictError);
      assert.deepEqual((await db.prepare("SELECT * FROM content_sources").all()).results, sources);
      assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM content_items").first()).total, 0);
    });

    await t.test("真实 PBKDF2 的 20 并发只通过 5 次，成功登录清理 RETURNING 预占记录", async () => {
      await shared.saveAdminPassword(env, "integration-new-password");
      const responses = await Promise.all(Array.from({ length: 20 }, () => loginRequest(login, env, "wrong")));
      assert.equal(responses.filter((response) => response.status === 401).length, 5);
      assert.equal(responses.filter((response) => response.status === 429).length, 15);
      assert.equal((await db.prepare("SELECT failed_count FROM admin_login_attempts").first()).failed_count, 5);
      await db.prepare("UPDATE admin_login_attempts SET blocked_until = ?")
        .bind(new Date(Date.now() - 1_000).toISOString()).run();
      const response = await loginRequest(login, env, "integration-new-password");
      assert.equal(response.status, 200);
      const { token } = await response.json();
      assert.equal(await shared.requireAdmin(new Request("https://example.com/admin", {
        headers: { Authorization: `Bearer ${token}` }
      }), env), null);
      assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM admin_login_attempts").first()).total, 0);
    });
  } finally {
    try {
      await runtime.dispose();
    } finally {
      for (const build of compiled.reverse()) await build.cleanup();
    }
  }
});

function feedResponse(count) {
  const items = Array.from({ length: count }, (_, index) =>
    `<item><guid>item-${index}</guid><title>Item ${index}</title><link>https://example.com/item/${index}</link><description>Integration content</description></item>`).join("");
  return new Response(`<rss version="2.0"><channel><title>Integration feed</title><link>https://example.com/</link><description>Integration feed</description>${items}</channel></rss>`,
    { headers: { "Content-Type": "application/rss+xml" } });
}

function loginRequest(login, env, password) {
  return login.onRequestPost({ env, request: new Request("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.16" },
    body: JSON.stringify({ password })
  }) });
}

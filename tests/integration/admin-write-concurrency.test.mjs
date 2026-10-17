import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

test("真实 workerd D1 执行同步守卫、Telegram 草稿与登录并发限流", { timeout: 60_000 }, async (t) => {
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

    const tagsBuild = await compileTypescriptModule(new URL("../../shared/effective-tags.ts", import.meta.url));
    compiled.push(tagsBuild);
    const telegramBuild = await compileTypescriptModule(new URL("../../functions/_telegram.ts", import.meta.url), {
      importReplacements: { "./_shared": sharedBuild.url.href, "../shared/effective-tags": tagsBuild.url.href }
    });
    compiled.push(telegramBuild);
    const telegram = await import(telegramBuild.url.href);
    const telegramEnv = { DB: db, TGTOKEN: "123456789:integration-telegram-token-only" };
    const origin = "https://example.com";
    const draft = { title: "隔离草稿", bodyMarkdown: "**隔离草稿**", mediaEnabled: false, mediaUrl: "" };
    await db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_settings', ?)")
      .bind(JSON.stringify({ enabled: true, target: "@integration_test", footerMarkdown: "" })).run();
    const readLock = (id) => db.prepare("SELECT * FROM telegram_push_locks WHERE resource_type = 'custom' AND resource_id = ?").bind(id).first();
    const seedLock = (id) => db.prepare(`INSERT INTO telegram_push_locks
      (resource_type, resource_id, operation, lock_token, state, expires_at)
      VALUES ('custom', ?, 'send', 'unchanged-token', 'uncertain', '2000-01-01')`).bind(id).run();

    await t.test("未知发送后首次并发存草稿只建一条，原锁及 GET/列表未知标记保留", async (subtest) => {
      subtest.mock.method(globalThis, "fetch", () => { throw new Error("草稿检查禁止外部请求"); });
      const id = "unknown-new-draft";
      await seedLock(id);
      const lock = await readLock(id);
      assert.equal((await telegram.getTelegramMessageState(telegramEnv, "custom", id, origin)).deliveryUncertain, true);
      let writesReady = 0;
      let releaseWrites;
      const bothReady = new Promise((resolve) => { releaseWrites = resolve; });
      const guardedDb = interceptTelegramDraftWrite(db, async () => {
        writesReady += 1;
        if (writesReady === 2) releaseWrites();
        await bothReady;
      });
      const results = await Promise.allSettled([
        telegram.saveTelegramMessage({ ...telegramEnv, DB: guardedDb }, "custom", id, origin, draft),
        telegram.saveTelegramMessage({ ...telegramEnv, DB: guardedDb }, "custom", id, origin,
          { ...draft, bodyMarkdown: "**另一份草稿**" })
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.match(results.find((result) => result.status === "rejected").reason.message, /already in progress/);
      assert.equal(results.find((result) => result.status === "fulfilled").value.deliveryUncertain, true);
      assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM telegram_messages WHERE resource_id = ?").bind(id).first()).total, 1);
      assert.deepEqual(await readLock(id), lock);
      assert.equal((await telegram.getTelegramMessageState(telegramEnv, "custom", id, origin)).deliveryUncertain, true);
      const listed = (await telegram.listTelegramPushRecords(telegramEnv, origin)).records.find((record) => record.resourceId === id);
      assert.equal(listed.deliveryUncertain, true);
      await assert.rejects(telegram.sendTelegramMessage(telegramEnv, "custom", id, origin, draft), /result is uncertain/);
    });

    await t.test("未知或过期发送的既有草稿并发更新拒绝旧请求，真实 D1 保留新内容和原锁", async (subtest) => {
      subtest.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-17T00:00:00.000Z") });
      const remote = subtest.mock.method(globalThis, "fetch", () => { throw new Error("草稿检查禁止外部请求"); });
      for (const state of ["uncertain", "active"]) {
        const id = `concurrent-existing-${state}`;
        await telegram.saveTelegramMessage(telegramEnv, "custom", id, origin, draft);
        await seedLock(id);
        await db.prepare("UPDATE telegram_push_locks SET state = ? WHERE resource_id = ?").bind(state, id).run();
        const lock = await readLock(id);
        const readRecord = () => db.prepare("SELECT * FROM telegram_messages WHERE resource_id = ?").bind(id).first();
        const before = await readRecord();
        let ready;
        let resume;
        const paused = new Promise((resolve) => { ready = resolve; });
        const resumed = new Promise((resolve) => { resume = resolve; });
        const guardedDb = interceptTelegramDraftWrite(db, async () => { ready(); await resumed; });
        const older = telegram.saveTelegramMessage({ ...telegramEnv, DB: guardedDb }, "custom", id, origin,
          { ...draft, bodyMarkdown: "**较早发起的旧正文**" }).then(
          (message) => ({ message }), (error) => ({ error })
        );
        let newerRecord;
        try {
          await Promise.race([paused, older.then(() => { throw new Error("旧请求未到达预期写入点"); })]);
          const newer = await telegram.saveTelegramMessage(telegramEnv, "custom", id, origin,
            { ...draft, category: "新分类", mediaEnabled: true, mediaUrl: `${origin}/new-photo.png` });
          assert.equal(newer.deliveryUncertain, true);
          newerRecord = await readRecord();
          assert.equal(newerRecord.category, "新分类");
          assert.equal(newerRecord.media_enabled, 1);
          assert.equal(newerRecord.media_url, `${origin}/new-photo.png`);
          assert.equal(newerRecord.message_markdown, before.message_markdown);
          assert.equal(newerRecord.updated_at, before.updated_at);
        } finally {
          resume();
          await older;
        }
        const result = await older;
        assert.ok(result.error instanceof shared.InvalidRequestError);
        const response = telegram.writeTelegramErrorResponse(result.error, "保存失败");
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, "TELEGRAM_PUSH_IN_PROGRESS");
        assert.deepEqual(await readRecord(), newerRecord);
        assert.deepEqual(await readLock(id), lock);
        await assert.rejects(telegram.sendTelegramMessage(telegramEnv, "custom", id, origin, draft), /result is uncertain/);
      }
      assert.equal(remote.mock.callCount(), 0);
    });

    await t.test("未知草稿写入前重推或删除已接管时，真实 D1 零变更必须返回失败", async (subtest) => {
      subtest.mock.method(globalThis, "fetch", () => { throw new Error("草稿检查禁止外部请求"); });
      for (const action of ["retry", "delete"]) {
        const id = `guard-${action}`;
        await telegram.saveTelegramMessage(telegramEnv, "custom", id, origin, draft);
        await seedLock(id);
        const guardedDb = interceptTelegramDraftWrite(db, async () => {
          if (action === "retry") {
            await db.prepare("UPDATE telegram_push_locks SET lock_token = 'retry-token', state = 'active', expires_at = '2099-01-01' WHERE resource_id = ?")
              .bind(id).run();
          } else {
            await telegram.deleteTelegramPush(telegramEnv, "custom", id);
          }
        });
        await assert.rejects(telegram.saveTelegramMessage({ ...telegramEnv, DB: guardedDb }, "custom", id, origin,
          { ...draft, bodyMarkdown: "**不应覆盖**" }), /already in progress/);
        const record = await db.prepare("SELECT message_markdown FROM telegram_messages WHERE resource_id = ?").bind(id).first();
        if (action === "retry") {
          assert.equal(record.message_markdown, draft.bodyMarkdown);
          assert.equal((await readLock(id)).lock_token, "retry-token");
        } else {
          assert.equal(record, null);
          assert.equal(await readLock(id), null);
        }
      }
    });

    await t.test("未知草稿 SQL 失败不清原锁，活动发送期间仍拒绝保存", async (subtest) => {
      subtest.mock.method(globalThis, "fetch", () => { throw new Error("草稿检查禁止外部请求"); });
      const id = "failed-draft-write";
      await telegram.saveTelegramMessage(telegramEnv, "custom", id, origin, draft);
      await seedLock(id);
      const lock = await readLock(id);
      await db.prepare(`CREATE TRIGGER reject_telegram_draft BEFORE UPDATE ON telegram_messages
        WHEN NEW.resource_id = 'failed-draft-write'
        BEGIN SELECT RAISE(ABORT, 'integration draft rejected'); END`).run();
      await assert.rejects(telegram.saveTelegramMessage(telegramEnv, "custom", id, origin,
        { ...draft, bodyMarkdown: "**未保存**" }), /integration draft rejected/);
      assert.deepEqual(await readLock(id), lock);
      assert.equal((await db.prepare("SELECT message_markdown FROM telegram_messages WHERE resource_id = ?").bind(id).first()).message_markdown, draft.bodyMarkdown);
      await db.prepare("DROP TRIGGER reject_telegram_draft").run();
      await db.prepare("UPDATE telegram_push_locks SET state = 'active', expires_at = '2099-01-01' WHERE resource_id = ?").bind(id).run();
      await assert.rejects(telegram.saveTelegramMessage(telegramEnv, "custom", id, origin, draft), /already in progress/);
      assert.equal((await readLock(id)).state, "active");
    });
  } finally {
    try {
      await runtime.dispose();
    } finally {
      for (const build of compiled.reverse()) await build.cleanup();
    }
  }
});

function interceptTelegramDraftWrite(db, beforeWrite) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!/^\s*(?:UPDATE|INSERT INTO) telegram_messages\b/.test(sql)) return statement;
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return { async run() { await beforeWrite(); return bound.run(); } };
        }
      };
    },
    batch(statements) { return db.batch(statements); }
  };
}

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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(new URL("../../functions/_shared.ts", import.meta.url));
const compiledTags = await compileTypescriptModule(new URL("../../shared/effective-tags.ts", import.meta.url));
const compiledTelegram = await compileTypescriptModule(new URL("../../functions/_telegram.ts", import.meta.url), {
  importReplacements: { "./_shared": compiledShared.url.href, "../shared/effective-tags": compiledTags.url.href }
});
const compiledBackup = await compileTypescriptModule(new URL("../../functions/api/admin/backup.ts", import.meta.url), {
  importReplacements: { "../../_shared": compiledShared.url.href },
  transformSource: (source) => `${source}\nexport { readBackupData, restoreBackupData, normalizeBackupPayload };`
});
const compiledApiClient = await compileTypescriptModule(new URL("../../src/api-client.ts", import.meta.url));
const compiledAdminApi = await compileTypescriptModule(new URL("../../src/admin-api.ts", import.meta.url), {
  importReplacements: { "./api-client": compiledApiClient.url.href },
  transformSource: (source) => `import { readJson } from "./api-client";\n${source.slice(
    source.indexOf("export async function updateTelegramMessage("),
    source.indexOf("export async function saveTelegramMessage(")
  )}`
});
const shared = await import(compiledShared.url.href);
const telegram = await import(compiledTelegram.url.href);
const backup = await import(compiledBackup.url.href);
const adminApi = await import(compiledAdminApi.url.href);
const schema = (await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
const origin = "https://example.com";
const resourceId = "delivery-check";
const payload = { bodyMarkdown: "**Delivery check**", mediaEnabled: false, mediaUrl: `${origin}/photo.png` };

after(async () => {
  await Promise.all([compiledBackup.cleanup(), compiledTelegram.cleanup(), compiledTags.cleanup(), compiledShared.cleanup(),
    compiledAdminApi.cleanup(), compiledApiClient.cleanup()]);
});

function createDatabase(initialSchema = schema) {
  const sqlite = new DatabaseSync(":memory:");
  if (initialSchema) sqlite.exec(initialSchema);
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() {
          if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } };
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
  return { sqlite, db, env: { DB: db, TGTOKEN: "123456789:delivery-test-token-0000000000" } };
}

function seed(database, { draftMedia = 1, pushedMedia = 1 } = {}) {
  const { sqlite } = database;
  sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("telegram_settings", JSON.stringify({ enabled: true, target: "@delivery_test", footerMarkdown: "" }));
  const resource = { type: "custom", id: resourceId, title: "Delivery check", description: "", url: "", demoUrl: "", image: "", category: "News", tags: [] };
  sqlite.prepare(`INSERT INTO telegram_messages
    (id, resource_type, resource_id, custom_title, resource_data, category, chat_id, target_ref,
     message_id, message_markdown, media_enabled, media_url, sent_at, last_pushed_media_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("delivery-record", "custom", resourceId, resource.title, JSON.stringify(resource), "News", "-100123", "@delivery_test", "42", payload.bodyMarkdown, draftMedia, payload.mediaUrl, new Date().toISOString(), pushedMedia);
}

function record(database) {
  return database.sqlite.prepare("SELECT * FROM telegram_messages WHERE id = 'delivery-record'").get();
}

function deliveryLock(database) {
  return database.sqlite.prepare("SELECT * FROM telegram_push_locks WHERE resource_type = 'custom' AND resource_id = ?").get(resourceId);
}

function seedUncertainLock(database, { operation = "send", state = "uncertain", expiresAt = "2099-01-01" } = {}) {
  database.sqlite.prepare(`INSERT INTO telegram_push_locks
    (resource_type, resource_id, operation, lock_token, state, expires_at)
    VALUES ('custom', ?, ?, 'preserved-lock', ?, ?)`).run(resourceId, operation, state, expiresAt);
}

function interceptMessageWrite(database, beforeWrite) {
  const prepare = database.db.prepare.bind(database.db);
  database.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (/^\s*(?:UPDATE|INSERT INTO) telegram_messages\b/.test(sql)) {
      const run = statement.run;
      statement.run = async () => {
        await beforeWrite();
        return run.call(statement);
      };
    }
    return statement;
  };
}

function mockRemote(t, { dropFirstSend = false, delayedSend = null } = {}) {
  const methods = [];
  const messages = new Map([[42, "photo"]]);
  let nextId = 43;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const method = String(url).split("/").at(-1);
    const body = JSON.parse(options.body);
    methods.push(method);
    if (method === "sendMessage" || method === "sendPhoto") {
      const id = nextId++;
      messages.set(id, method === "sendPhoto" ? "photo" : "text");
      if (dropFirstSend && id === 43) throw new TypeError("模拟发送成功后的响应丢失");
      if (delayedSend) await delayedSend();
      return Response.json({ ok: true, result: { chat: { id: -100123 }, message_id: id } });
    }
    if (method === "deleteMessage") {
      messages.delete(body.message_id);
      return Response.json({ ok: true, result: true });
    }
    if (method === "editMessageText" && messages.get(body.message_id) === "photo") {
      return Response.json({ ok: false, description: "Bad Request: there is no text in the message to edit" }, { status: 400 });
    }
    if (method === "editMessageText" || method === "editMessageMedia") {
      messages.set(body.message_id, method === "editMessageMedia" ? "photo" : "text");
      return Response.json({ ok: true, result: { chat: { id: -100123 }, message_id: body.message_id } });
    }
    throw new Error(`未经预期的远端方法：${method}`);
  });
  return { methods, messages };
}

test("保存草稿不会覆盖远端类型，照片和文字都能在保存后正确切换", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    const remote = mockRemote(t);
    await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, payload);
    assert.equal(record(database).media_enabled, 0);
    assert.equal(record(database).last_pushed_media_enabled, 1);
    assert.deepEqual(remote.methods, []);
    await telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, payload);
    assert.deepEqual(remote.methods, ["sendMessage", "deleteMessage"]);
    assert.equal(record(database).last_pushed_media_enabled, 0);

    const photoPayload = { ...payload, mediaEnabled: true };
    await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, photoPayload);
    assert.equal(record(database).last_pushed_media_enabled, 0);
    await telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, photoPayload);
    assert.deepEqual(remote.methods, ["sendMessage", "deleteMessage", "sendPhoto", "deleteMessage"]);
    assert.equal(record(database).last_pushed_media_enabled, 1);
    assert.equal(remote.messages.size, 1);
  } finally { database.sqlite.close(); }
});

test("前端更新请求仅在显式确认时传递不确定发送的重试标记", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json({ message: {} });
  });
  await adminApi.updateTelegramMessage("custom", resourceId, payload.bodyMarkdown, false, payload.mediaUrl, "zh", "test-token");
  await adminApi.updateTelegramMessage("custom", resourceId, payload.bodyMarkdown, false, payload.mediaUrl, "zh", "test-token", { confirmUncertainRetry: true });
  assert.deepEqual(requests.map((request) => [request.method, request.body.confirmUncertainRetry]), [["PUT", false], ["PUT", true]]);
});

test("旧数据中已被草稿覆盖的照片类型可在明确的 Telegram 拒绝后修复", async (t) => {
  const database = createDatabase();
  try {
    seed(database, { draftMedia: 0, pushedMedia: null });
    const remote = mockRemote(t);
    await telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, payload);
    assert.deepEqual(remote.methods, ["editMessageText", "sendMessage", "deleteMessage"]);
    assert.equal(record(database).last_pushed_media_enabled, 0);
    assert.equal(remote.messages.size, 1);
  } finally { database.sqlite.close(); }
});

test("旧未知类型的文字消息可通过 editMessageMedia 转成照片", async (t) => {
  const database = createDatabase();
  try {
    seed(database, { draftMedia: 1, pushedMedia: null });
    const remote = mockRemote(t);
    remote.messages.set(42, "text");
    await telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, { ...payload, mediaEnabled: true });
    assert.deepEqual(remote.methods, ["editMessageMedia"]);
    assert.equal(record(database).last_pushed_media_enabled, 1);
    assert.equal(remote.messages.get(42), "photo");
  } finally { database.sqlite.close(); }
});

test("替换发送结果未知时可以保存草稿，锁过期后仍须确认才能再次发送", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    const remote = mockRemote(t, { dropFirstSend: true });
    await assert.rejects(telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, payload), /result is uncertain/);
    assert.equal(database.sqlite.prepare("SELECT operation FROM telegram_push_locks").get().operation, "send");
    await assert.rejects(telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, payload), /result is uncertain/);
    database.sqlite.exec("UPDATE telegram_push_locks SET expires_at = '2000-01-01T00:00:00.000Z'");
    await assert.rejects(telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, payload), /result is uncertain/);
    const lock = deliveryLock(database);
    const saved = await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, payload);
    assert.equal(saved.deliveryUncertain, true);
    assert.deepEqual(deliveryLock(database), lock);
    assert.deepEqual(remote.methods, ["sendMessage"]);
    assert.equal(record(database).message_id, "42");
    assert.equal(record(database).last_pushed_media_enabled, 1);

    // 管理员核实并清理未知消息后，已有确认流程才可继续发送。
    remote.messages.delete(43);
    await telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, { ...payload, confirmUncertainRetry: true });
    assert.deepEqual(remote.methods, ["sendMessage", "sendMessage", "deleteMessage"]);
    assert.deepEqual([...remote.messages.keys()], [44]);
    assert.equal(record(database).message_id, "44");
  } finally { database.sqlite.close(); }
});

test("确认标记不能抢占仍在发送的替换请求", async (t) => {
  const database = createDatabase();
  let release;
  try {
    seed(database);
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const waiting = new Promise((resolve) => { release = resolve; });
    const remote = mockRemote(t, { delayedSend: () => { entered(); return waiting; } });
    const first = telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, payload);
    await started;
    await assert.rejects(telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, { ...payload, confirmUncertainRetry: true }), /already in progress/);
    await assert.rejects(telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, payload), /already in progress/);
    assert.deepEqual(remote.methods, ["sendMessage"]);
    release();
    await first;
    assert.equal(remote.messages.size, 1);
  } finally { release?.(); database.sqlite.close(); }
});

test("原地编辑的不确定锁仍可安全接管，不转为重新发送", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    database.sqlite.prepare(`INSERT INTO telegram_push_locks
      (resource_type, resource_id, operation, lock_token, state, expires_at)
      VALUES ('custom', ?, 'update', 'old-edit', 'uncertain', '2099-01-01')`).run(resourceId);
    const remote = mockRemote(t);
    const saved = await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, payload);
    assert.equal(saved.deliveryUncertain, false);
    assert.equal(deliveryLock(database).operation, "update");
    await telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, { ...payload, mediaEnabled: true });
    assert.deepEqual(remote.methods, ["editMessageMedia"]);
  } finally { database.sqlite.close(); }
});

test("首次发送结果未知后可新建草稿，读取和列表保留未知状态，重推仍须确认", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    database.sqlite.exec("DELETE FROM telegram_messages");
    const remote = mockRemote(t, { dropFirstSend: true });
    const draft = { ...payload, title: "Delivery check" };
    await assert.rejects(telegram.sendTelegramMessage(database.env, "custom", resourceId, origin, draft), /result is uncertain/);
    const lock = deliveryLock(database);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS total FROM telegram_messages").get().total, 0);
    assert.equal((await telegram.getTelegramMessageState(database.env, "custom", resourceId, origin)).deliveryUncertain, true);
    const saved = await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, draft);
    assert.equal(saved.deliveryUncertain, true);
    assert.equal(saved.exists, false);
    assert.equal(saved.bodyMarkdown, draft.bodyMarkdown);
    assert.deepEqual(deliveryLock(database), lock);
    assert.equal((await telegram.listTelegramPushRecords(database.env, origin)).records[0].deliveryUncertain, true);
    await assert.rejects(telegram.sendTelegramMessage(database.env, "custom", resourceId, origin, draft), /result is uncertain/);
    assert.deepEqual(remote.methods, ["sendMessage"]);
    remote.messages.delete(43);
    const sent = await telegram.sendTelegramMessage(database.env, "custom", resourceId, origin, { ...draft, confirmUncertainRetry: true });
    assert.equal(sent.deliveryUncertain, false);
    assert.equal((await telegram.getTelegramMessageState(database.env, "custom", resourceId, origin)).deliveryUncertain, false);
    assert.equal((await telegram.listTelegramPushRecords(database.env, origin)).records[0].deliveryUncertain, false);
    assert.deepEqual(remote.methods, ["sendMessage", "sendMessage"]);
  } finally { database.sqlite.close(); }
});

test("未知与已过期发送允许更新既有草稿，但不改远端记录和原锁", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    const remote = mockRemote(t);
    for (const state of ["uncertain", "active"]) {
      database.sqlite.exec("DELETE FROM telegram_push_locks");
      seedUncertainLock(database, { state, expiresAt: "2000-01-01" });
      const before = record(database);
      const lock = deliveryLock(database);
      const draft = { ...payload, bodyMarkdown: `**Saved ${state}**` };
      const saved = await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, draft);
      assert.equal(saved.deliveryUncertain, true);
      assert.equal(record(database).message_markdown, draft.bodyMarkdown);
      for (const field of ["chat_id", "target_ref", "message_id", "sent_at", "last_pushed_hash", "last_pushed_media_enabled"]) {
        assert.equal(record(database)[field], before[field]);
      }
      assert.deepEqual(deliveryLock(database), lock);
      await assert.rejects(telegram.updateTelegramMessage(database.env, "custom", resourceId, origin, draft), /result is uncertain/);
    }
    assert.deepEqual(remote.methods, []);
  } finally { database.sqlite.close(); }
});

test("未知草稿并发保存拒绝旧快照，同一毫秒内的单项编辑也不会丢失", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-17T00:00:00.000Z") });
  const remote = t.mock.method(globalThis, "fetch", () => { throw new Error("保存不应请求 Telegram"); });
  const edits = [
    ["正文", { bodyMarkdown: "**后发起且先保存成功的新正文**" }, "message_markdown"],
    ["标题", { title: "新标题" }, "custom_title"],
    ["资源信息", { resource: { description: "新简介" } }, "resource_data"],
    ["分类", { category: "新分类" }, "category"],
    ["图片开关", { mediaEnabled: true }, "media_enabled"],
    ["图片地址", { mediaUrl: `${origin}/new-photo.png` }, "media_url"]
  ];
  for (const [name, edit, field] of edits) {
    await t.test(name, async () => {
      const database = createDatabase();
      try {
        seed(database);
        seedUncertainLock(database);
        await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin, payload);
        const before = record(database);
        const lock = deliveryLock(database);
        let newerRecord;
        let intercepted = false;
        interceptMessageWrite(database, async () => {
          if (intercepted) return;
          intercepted = true;
          const newer = await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin,
            { ...payload, ...edit });
          assert.equal(newer.deliveryUncertain, true);
          newerRecord = record(database);
          assert.notEqual(newerRecord[field], before[field]);
          assert.equal(newerRecord.updated_at, before.updated_at);
        });
        await assert.rejects(telegram.saveTelegramMessage(database.env, "custom", resourceId, origin,
          { ...payload, bodyMarkdown: "**较早发起的旧正文**" }), /already in progress/);
        assert.deepEqual(record(database), newerRecord);
        assert.deepEqual(deliveryLock(database), lock);
        for (const key of ["chat_id", "target_ref", "message_id", "sent_at", "last_pushed_hash", "last_pushed_media_enabled"]) {
          assert.equal(newerRecord[key], before[key]);
        }
        const savedAgain = await telegram.saveTelegramMessage(database.env, "custom", resourceId, origin,
          { ...payload, ...edit });
        assert.equal(savedAgain.deliveryUncertain, true);
        assert.equal(savedAgain.bodyMarkdown, newerRecord.message_markdown);
        assert.equal(record(database)[field], newerRecord[field]);
        assert.deepEqual(deliveryLock(database), lock);
      } finally { database.sqlite.close(); }
    });
  }
  assert.equal(remote.mock.callCount(), 0);
});

test("未知草稿条件写入遇到重推或删除接管时拒绝保存，不误报成功", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("保存不应请求 Telegram"); });
  for (const change of ["retry", "delete", "created"]) {
    const database = createDatabase();
    try {
      seed(database);
      seedUncertainLock(database);
      if (change === "created") database.sqlite.exec("DELETE FROM telegram_messages");
      const previous = record(database);
      interceptMessageWrite(database, () => {
        if (change === "retry") {
          database.sqlite.exec("UPDATE telegram_push_locks SET state = 'active', lock_token = 'retry-lock'");
        } else if (change === "delete") {
          database.sqlite.exec("DELETE FROM telegram_messages; DELETE FROM telegram_push_locks");
        } else {
          database.sqlite.prepare(`INSERT INTO telegram_messages
            (id, resource_type, resource_id, chat_id, message_id, message_markdown)
            VALUES ('concurrent-draft', 'custom', ?, '', '', '并发保存的内容')`).run(resourceId);
        }
      });
      await assert.rejects(telegram.saveTelegramMessage(database.env, "custom", resourceId, origin,
        { ...payload, title: "Delivery check", bodyMarkdown: "**不应写入**" }), /already in progress/);
      if (change === "retry") assert.deepEqual(record(database), previous);
      if (change === "delete") assert.equal(record(database), undefined);
      if (change === "created") {
        assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS total FROM telegram_messages").get().total, 1);
        assert.equal(database.sqlite.prepare("SELECT message_markdown FROM telegram_messages").get().message_markdown, "并发保存的内容");
      }
    } finally { database.sqlite.close(); }
  }
});

test("未知草稿写库失败时保留旧内容和原不确定锁", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    seedUncertainLock(database);
    const remote = mockRemote(t);
    const before = record(database);
    const lock = deliveryLock(database);
    database.sqlite.exec(`CREATE TRIGGER reject_draft BEFORE UPDATE ON telegram_messages
      BEGIN SELECT RAISE(ABORT, '模拟草稿写库失败'); END`);
    await assert.rejects(telegram.saveTelegramMessage(database.env, "custom", resourceId, origin,
      { ...payload, bodyMarkdown: "**未保存的新内容**" }), /模拟草稿写库失败/);
    assert.deepEqual(record(database), before);
    assert.deepEqual(deliveryLock(database), lock);
    assert.deepEqual(remote.methods, []);
  } finally { database.sqlite.close(); }
});

test("删除本地记录可以放弃未知发送，但不能抢占仍在执行的发送", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    const remote = mockRemote(t);
    database.sqlite.prepare(`INSERT INTO telegram_push_locks
      (resource_type, resource_id, operation, lock_token, state, expires_at)
      VALUES ('custom', ?, 'send', 'old-send', 'active', '2099-01-01')`).run(resourceId);
    await assert.rejects(telegram.deleteTelegramPush(database.env, "custom", resourceId, "delivery-record"), /already in progress/);
    assert.ok(record(database));
    database.sqlite.exec("UPDATE telegram_push_locks SET state = 'uncertain'");
    await telegram.deleteTelegramPush(database.env, "custom", resourceId, "delivery-record");
    assert.equal(record(database), undefined);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS total FROM telegram_push_locks").get().total, 0);
    assert.deepEqual(remote.methods, []);
  } finally { database.sqlite.close(); }
});

test("批量删除按分类和类型过滤，活动推送令整批保留，未知或过期发送可仅清本地", async (t) => {
  const database = createDatabase();
  try {
    seed(database);
    const remote = mockRemote(t);
    database.sqlite.exec(`INSERT INTO telegram_messages (id, resource_type, resource_id, category, chat_id, message_id)
      VALUES ('busy-record', 'tool', 'busy-tool', 'News', '-100123', '8'),
             ('retained-record', 'article', 'retained', 'Other', '-100123', '9');
      INSERT INTO telegram_push_locks (resource_type, resource_id, operation, lock_token, state, expires_at)
      VALUES ('custom', 'delivery-check', 'send', 'unknown-send', 'uncertain', '2099-01-01'),
             ('tool', 'busy-tool', 'send', 'busy-send', 'active', '2099-01-01');`);
    await assert.rejects(telegram.deleteTelegramPushCategory(database.db, { category: "News" }), /already in progress/);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS total FROM telegram_messages").get().total, 3);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS total FROM telegram_push_locks").get().total, 2);
    database.sqlite.exec("UPDATE telegram_push_locks SET expires_at = '2000-01-01' WHERE resource_type = 'tool'");
    assert.equal(await telegram.deleteTelegramPushCategory(database.db, { category: "News" }), 2);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS total FROM telegram_push_locks").get().total, 0);
    assert.equal(await telegram.deleteTelegramPushCategory(database.db, { resourceType: "tool" }), 0);
    assert.equal(await telegram.deleteTelegramPushCategory(database.db, { resourceType: "article" }), 1);
    assert.deepEqual(remote.methods, []);
  } finally { database.sqlite.close(); }
});

test("空库与版本17升级提供独立远端类型并保留历史数据", async () => {
  const empty = createDatabase("");
  const legacy = createDatabase(schema.replace("  last_pushed_media_enabled INTEGER,\n", "").replace("'18', CURRENT_TIMESTAMP", "'17', CURRENT_TIMESTAMP"));
  try {
    legacy.sqlite.exec(`INSERT INTO telegram_messages
      (id, resource_type, resource_id, chat_id, message_id, message_markdown, media_enabled)
      VALUES ('legacy-photo', 'custom', 'legacy', '-100123', '7', '历史内容', 1);
      INSERT INTO telegram_push_locks (resource_type, resource_id, operation, lock_token, state, expires_at)
      VALUES ('custom', 'legacy', 'update', 'legacy-lock', 'uncertain', '2000-01-01')`);
    await shared.ensureDatabaseSchema(empty.db);
    await shared.ensureDatabaseSchema(legacy.db);
    for (const database of [empty, legacy]) {
      assert.equal(database.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'database_schema_version'").get().value, "18");
      assert.ok(database.sqlite.prepare("PRAGMA table_info(telegram_messages)").all().some((column) => column.name === "last_pushed_media_enabled"));
    }
    const row = legacy.sqlite.prepare("SELECT * FROM telegram_messages WHERE id = 'legacy-photo'").get();
    assert.equal(row.last_pushed_media_enabled, null);
    assert.equal(row.message_markdown, "历史内容");
    assert.equal(row.media_enabled, 1);
    assert.equal(legacy.sqlite.prepare("SELECT operation FROM telegram_push_locks").get().operation, "send");
  } finally { empty.sqlite.close(); legacy.sqlite.close(); }
});

test("备份恢复保留独立远端类型，旧版本4备份缺字段按未知类型兼容", async () => {
  const source = createDatabase();
  const target = createDatabase();
  try {
    seed(source, { draftMedia: 0, pushedMedia: 1 });
    const data = await backup.readBackupData(source.db);
    const normalized = backup.normalizeBackupPayload({ source: "htools-backup", version: "4", data });
    await backup.restoreBackupData(target.db, normalized);
    assert.equal(record(target).last_pushed_media_enabled, 1);
    assert.equal(record(target).media_enabled, 0);
    delete data.telegramMessages[0].last_pushed_media_enabled;
    await backup.restoreBackupData(target.db, backup.normalizeBackupPayload({ source: "htools-backup", version: "4", data }));
    assert.equal(record(target).last_pushed_media_enabled, null);
    assert.equal(record(target).message_id, "42");
  } finally { source.sqlite.close(); target.sqlite.close(); }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
const compiledShared = await compileTypescriptModule(new URL("../../functions/_shared.ts", import.meta.url));
const shared = await import(compiledShared.url.href);
const compiledBackup = await compileTypescriptModule(new URL("../../functions/api/admin/backup.ts", import.meta.url), {
  importReplacements: { "../../_shared": compiledShared.url.href },
  transformSource: (source) => `${source}\nexport { validateBackupIntegrity };`
});
const { validateBackupIntegrity } = await import(compiledBackup.url.href);
after(async () => {
  await compiledBackup.cleanup();
  await compiledShared.cleanup();
});

function d1(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }; }
      };
    },
    async batch(statements) {
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
}

function seed(sqlite, suffix) {
  sqlite.prepare("INSERT INTO content_sources (id, title, url, category) VALUES (?, ?, ?, ?)")
    .run(`source-${suffix}`, suffix, `https://example.com/${suffix}`, suffix);
  sqlite.prepare("INSERT INTO content_items (id, source_id, external_id, title, url, category, article_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(`item-${suffix}`, `source-${suffix}`, suffix, suffix, `https://example.com/item/${suffix}`, suffix, `article-${suffix}`);
  sqlite.prepare("INSERT INTO articles (id, slug, title, summary, content, content_item_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`article-${suffix}`, suffix, suffix, "summary", "preserved article body", `item-${suffix}`);
}

function backupData(sqlite) {
  return {
    tools: [], telegramMessages: [], settings: [],
    articles: sqlite.prepare("SELECT * FROM articles").all(),
    contentSources: sqlite.prepare("SELECT * FROM content_sources").all(),
    contentItems: sqlite.prepare("SELECT * FROM content_items").all()
  };
}

test("version 16 upgrades clear only missing source links and preserve article content", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(schema);
    sqlite.exec("DROP TRIGGER content_items_article_unlink_ad; UPDATE app_settings SET value = '16' WHERE key = 'database_schema_version'");
    seed(sqlite, "removed");
    seed(sqlite, "retained");
    sqlite.exec("DELETE FROM content_items WHERE source_id = 'source-removed'");
    assert.throws(() => validateBackupIntegrity(backupData(sqlite)), /missing content item/);

    await shared.ensureDatabaseSchema(d1(sqlite));
    assert.equal(sqlite.prepare("SELECT content_item_id FROM articles WHERE id = 'article-removed'").get().content_item_id, null);
    assert.equal(sqlite.prepare("SELECT content_item_id FROM articles WHERE id = 'article-retained'").get().content_item_id, "item-retained");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM articles WHERE content = 'preserved article body'").get().total, 2);
    assert.doesNotThrow(() => validateBackupIntegrity(backupData(sqlite)));
    sqlite.exec("DELETE FROM content_items WHERE id = 'item-retained'");
    assert.doesNotThrow(() => validateBackupIntegrity(backupData(sqlite)));
  } finally { sqlite.close(); }
});

test("every content deletion keeps articles exportable, including transaction rollback", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(schema);
    seed(sqlite, "removed");
    seed(sqlite, "retained");
    for (const deletion of [
      "DELETE FROM content_items WHERE source_id = 'source-removed'",
      "DELETE FROM content_items WHERE category = 'removed' OR source_id IN (SELECT id FROM content_sources WHERE category = 'removed')",
      "DELETE FROM content_items"
    ]) {
      sqlite.exec("BEGIN");
      sqlite.exec(deletion);
      assert.equal(sqlite.prepare("SELECT content_item_id FROM articles WHERE id = 'article-removed'").get().content_item_id, null);
      assert.doesNotThrow(() => validateBackupIntegrity(backupData(sqlite)));
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM articles").get().total, 2);
      sqlite.exec("ROLLBACK");
      assert.equal(sqlite.prepare("SELECT content_item_id FROM articles WHERE id = 'article-removed'").get().content_item_id, "item-removed");
    }
  } finally { sqlite.close(); }
});

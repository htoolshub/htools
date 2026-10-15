import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?schema=1`);
const schemaSql = await readFile(
  new URL("../../db/schema.sql", import.meta.url),
  "utf8"
);

after(() => compiledShared.cleanup());

function createDatabase(initialVersion, missingSettings = false, legacySourceColumns = false) {
  const metrics = {
    batch: 0,
    versionReads: 0,
    pragmaReads: 0,
    versionWrites: 0
  };
  const state = { version: initialVersion, missingSettings, legacySourceColumns };
  const db = {
    prepare(sql) {
      return {
        sql,
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("SELECT value FROM app_settings")) {
            metrics.versionReads += 1;
            if (state.missingSettings) throw new Error("no such table: app_settings");
            return state.version === null ? null : { value: String(state.version) };
          }
          return null;
        },
        async all() {
          if (sql.includes("PRAGMA table_info(tools)")) {
            metrics.pragmaReads += 1;
            return {
              results: [{ name: "github_language" }, { name: "github_license" }]
            };
          }
          if (sql.includes("PRAGMA table_info(articles)")) {
            metrics.pragmaReads += 1;
            return {
              results: [
                { name: "content_item_id" },
                ...(state.legacySourceColumns ? [{ name: "source_content_version" }] : [])
              ]
            };
          }
          if (sql.includes("PRAGMA table_info(content_items)")) {
            metrics.pragmaReads += 1;
            return {
              results: state.legacySourceColumns ? [{ name: "content_version" }] : []
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO app_settings")) {
            metrics.versionWrites += 1;
            state.version = 18;
            state.missingSettings = false;
          }
          return { meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      metrics.batch += 1;
      if (statements.some((statement) => statement.sql.includes("DROP COLUMN"))) {
        state.legacySourceColumns = false;
      }
      if (
        statements.some((statement) =>
          statement.sql.includes("CREATE TABLE IF NOT EXISTS app_settings")
        )
      ) {
        state.missingSettings = false;
      }
      return statements.map(() => ({ results: [], meta: { changes: 0 } }));
    }
  };
  return { db, metrics, state };
}

test("current schema version is read once for concurrent and repeated calls", async () => {
  const current = createDatabase(18);
  await Promise.all([
    shared.ensureDatabaseSchema(current.db),
    shared.ensureDatabaseSchema(current.db)
  ]);
  await shared.ensureDatabaseSchema(current.db);

  assert.deepEqual(current.metrics, {
    batch: 0,
    versionReads: 1,
    pragmaReads: 0,
    versionWrites: 0
  });
});

test("legacy schema is upgraded and persists its version once", async () => {
  const legacy = createDatabase(null);
  await shared.ensureDatabaseSchema(legacy.db);
  await shared.ensureDatabaseSchema(legacy.db);

  assert.equal(legacy.metrics.batch, 2);
  assert.equal(legacy.metrics.versionReads, 1);
  assert.equal(legacy.metrics.pragmaReads, 4);
  assert.equal(legacy.metrics.versionWrites, 1);
  assert.equal(legacy.state.version, 18);
});

test("version 9 removes legacy source-update columns before persisting version 18", async () => {
  const legacy = createDatabase(9, false, true);
  await shared.ensureDatabaseSchema(legacy.db);

  assert.equal(legacy.metrics.batch, 3);
  assert.equal(legacy.metrics.pragmaReads, 4);
  assert.equal(legacy.state.legacySourceColumns, false);
  assert.equal(legacy.state.version, 18);
});

test("an empty database initializes once and a new isolate reuses the stored version", async () => {
  const empty = createDatabase(null, true);
  await shared.ensureDatabaseSchema(empty.db);

  const secondCompiledShared = await compileTypescriptModule(
    new URL("../../functions/_shared.ts", import.meta.url)
  );
  try {
    const secondShared = await import(`${secondCompiledShared.url.href}?schema=5`);
    await secondShared.ensureDatabaseSchema(empty.db);
  } finally {
    await secondCompiledShared.cleanup();
  }

  assert.equal(empty.metrics.batch, 2);
  assert.equal(empty.metrics.versionReads, 2);
  assert.equal(empty.metrics.versionWrites, 1);
  assert.equal(empty.state.version, 18);
});

test("a database newer than the application is rejected", async () => {
  const newer = createDatabase(19);
  await assert.rejects(
    shared.ensureDatabaseSchema(newer.db),
    /newer than supported version 18/
  );
});

test("fresh deployment schema matches runtime schema version 18", () => {
  assert.match(
    schemaSql,
    /resource_type TEXT NOT NULL CHECK \(resource_type IN \('tool', 'article', 'content', 'custom'\)\)/
  );
  assert.match(schemaSql, /custom_title TEXT NOT NULL DEFAULT ''/);
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS telegram_push_locks/);
  assert.match(
    schemaSql,
    /VALUES \('database_schema_version', '18', CURRENT_TIMESTAMP\)/
  );
});

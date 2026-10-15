import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?session-secret=1`);

after(async () => {
  await compiledShared.cleanup();
});

// app_settings 的最小内存实现:够 getDatabase 的版本检查、
// INSERT ... ON CONFLICT DO NOTHING 和两种读法(单键 first / key IN all)用。
function createSettingsDatabase(initial = {}) {
  const rows = new Map(
    // 让 getDatabase 的版本检查直接通过,不去跑真实建表
    Object.entries({ database_schema_version: "17", ...initial })
  );
  const inserts = [];
  const db = {
    prepare(sql) {
      const statement = {
        binds: [],
        bind(...binds) {
          statement.binds = binds;
          return statement;
        },
        async run() {
          if (sql.includes("INSERT INTO app_settings")) {
            const [key, value] = statement.binds;
            inserts.push({ key, value, sql });
            // DO NOTHING:已经有值就不许覆盖
            if (!rows.has(key)) rows.set(key, value);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes("SELECT value FROM app_settings")) {
            const key = statement.binds[0];
            const value = rows.get(key);
            return value === undefined ? null : { value };
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM app_settings") && sql.includes("key IN")) {
            return {
              results: statement.binds
                .filter((key) => rows.has(key))
                .map((key) => ({ key, value: rows.get(key) }))
            };
          }
          return { results: [] };
        }
      };
      return statement;
    }
  };
  return { db, rows, inserts };
}

test("令牌签名密钥由 D1 自动生成，不再拿登录密码当印章", async () => {
  const store = createSettingsDatabase();
  const env = { ADMIN_PASSWORD: "login-password", DB: store.db };

  const token = await shared.createToken(env);

  const secret = store.rows.get("session_secret");
  assert.ok(secret, "首次签发令牌时必须把会话密钥写进 app_settings");
  assert.notEqual(secret, "login-password");
  // 32 字节按 base64url 编码是 43 个字符（去掉了补位的 =）
  assert.equal(secret.length, 43);
  assert.match(secret, /^[A-Za-z0-9_-]+$/);
  assert.equal(token.split(".").length, 2);

  // 并发安全:写入必须是 DO NOTHING，绝不能 INSERT OR REPLACE
  const insert = store.inserts.find((entry) => entry.key === "session_secret");
  assert.ok(insert, "应该有一次写入 session_secret 的动作");
  assert.match(insert.sql, /ON CONFLICT\(key\) DO NOTHING/);
  assert.doesNotMatch(insert.sql, /INSERT OR REPLACE/);
});

test("已有密钥时不重新生成，签发第二个令牌只读不写", async () => {
  const store = createSettingsDatabase({ session_secret: "existing-secret" });
  const env = { ADMIN_PASSWORD: "login-password", DB: store.db };

  await shared.createToken(env);

  assert.equal(store.rows.get("session_secret"), "existing-secret");
  assert.equal(
    store.inserts.filter((entry) => entry.key === "session_secret").length,
    0
  );
});

test("同一个库签发的令牌能通过，换一个还没有密钥的库必须验不过", async () => {
  const issuing = createSettingsDatabase();
  const issuingEnv = { ADMIN_PASSWORD: "login-password", DB: issuing.db };
  const token = await shared.createToken(issuingEnv);
  const request = new Request("https://example.com/api/admin/tools", {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(await shared.requireAdmin(request, issuingEnv), null);

  // 空库:校验路径只读不建，没有密钥就不可能存在合法令牌
  const empty = createSettingsDatabase();
  const emptyEnv = { ADMIN_PASSWORD: "login-password", DB: empty.db };
  const rejected = await shared.requireAdmin(request, emptyEnv);
  assert.equal(rejected?.status, 401);
  assert.equal(
    empty.rows.has("session_secret"),
    false,
    "校验令牌时绝不允许创建密钥"
  );

  // 换一枚不同的密钥也必须验不过（证明签名真的绑在这枚密钥上）
  const other = createSettingsDatabase({ session_secret: "another-secret" });
  const otherEnv = { ADMIN_PASSWORD: "login-password", DB: other.db };
  assert.equal(
    (await shared.requireAdmin(request, otherEnv))?.status,
    401
  );
});

test("签发与校验令牌的实现里不得再出现 ADMIN_PASSWORD", async () => {
  const source = await readFile(
    new URL("../../functions/_shared.ts", import.meta.url),
    "utf8"
  );
  const slice = (name) => {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `找不到 ${name} 的实现`);
    const end = source.indexOf("\n}", start);
    assert.notEqual(end, -1, `${name} 的实现没有结束括号`);
    return source.slice(start, end);
  };

  assert.doesNotMatch(slice("createToken"), /ADMIN_PASSWORD|getSecret\(/);
  assert.doesNotMatch(slice("verifyToken"), /ADMIN_PASSWORD|getSecret\(/);
  // 新部署首次登录仍要靠 env 明文兜底，这一处必须保留
  assert.match(slice("verifyPassword"), /getSecret\(env\)/);
});

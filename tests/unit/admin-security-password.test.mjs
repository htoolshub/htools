import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("password changes rotate the current session and invalidate older tokens", async () => {
  const [endpoint, shared, api, app, securityCard] = await Promise.all([
    read("../../functions/api/admin/security.ts"),
    read("../../functions/_shared.ts"),
    read("../../src/admin-api.ts"),
    read("../../src/AdminApp.tsx"),
    read("../../src/components/admin-settings/SecuritySettingsCard.tsx")
  ]);

  assert.match(endpoint, /createToken/);
  assert.match(endpoint, /settings: await getAdminSecuritySettings\(env\),\s*token: await createToken\(env\)/);
  assert.match(
    shared,
    /const \{ sessionSecret, passwordSettings \} = await getAuthSettings\(env\);[\s\S]*timestamp >= passwordUpdatedAt/
  );
  assert.match(api, /Updated admin session token is missing\./);
  assert.match(app, /localStorage\.setItem\("htools_token", nextToken\)/);
  assert.match(securityCard, /onTokenChange\(result\.token\)/);
  assert.match(app, /onTokenChange=\{onTokenChange\}/);
});

test("password updates reject unchanged and incorrect passwords without logging out a valid session", async () => {
  const [endpoint, securityCard, text] = await Promise.all([
    read("../../functions/api/admin/security.ts"),
    read("../../src/components/admin-settings/SecuritySettingsCard.tsx"),
    read("../../src/admin-text.ts")
  ]);

  assert.match(
    endpoint,
    /"INVALID_PASSWORD",\s*\{ status: 400 \}/
  );
  assert.match(endpoint, /if \(newPassword === currentPassword\)/);
  assert.match(endpoint, /"PASSWORD_UNCHANGED"/);
  assert.match(securityCard, /if \(newPassword === currentPassword\)/);
  assert.match(securityCard, /errorCode === "PASSWORD_UNCHANGED"/);
  assert.match(
    securityCard,
    /const nextInvalidField: SecurityField \| null =\s*errorCode === "INVALID_PASSWORD"/
  );
  assert.match(securityCard, /: null;\s*setInvalidField\(nextInvalidField\)/);
  assert.match(text, /securityUnchanged:/);
});

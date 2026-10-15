import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("administrator login uses optional server-verified Turnstile", async () => {
  const [config, login, settings, shared, api, app, widget] = await Promise.all([
    read("../../functions/api/auth/config.ts"),
    read("../../functions/api/auth/login.ts"),
    read("../../functions/api/admin/turnstile-settings.ts"),
    read("../../functions/_shared.ts"),
    read("../../src/admin-api.ts"),
    read("../../src/AdminApp.tsx"),
    read("../../src/components/TurnstileWidget.tsx")
  ]);

  assert.match(config, /getAdminTurnstileSettings/);
  assert.match(settings, /saveAdminTurnstileEnabled/);
  assert.match(shared, /ADMIN_TURNSTILE_ENABLED_KEY/);
  assert.match(shared, /if \(enabled && !\(siteKey && secretKey\)\)/);
  assert.match(login, /verifyTurnstileRequest/);
  assert.match(shared, /turnstile\/v0\/siteverify/);
  assert.match(shared, /CF-Connecting-IP/);
  assert.match(shared, /"TURNSTILE_FAILED"/);
  assert.match(shared, /"TURNSTILE_REQUIRED"/);
  assert.match(shared, /"TURNSTILE_UNAVAILABLE"/);
  assert.match(api, /password: password\.trim\(\), turnstileToken/);
  assert.match(app, /authConfig\.turnstileEnabled && !turnstileToken/);
  assert.match(
    app,
    /authConfig\.turnstileEnabled && !turnstileToken\) \{\s*return;\s*\}/
  );
  assert.match(
    app,
    /"TURNSTILE_UNAVAILABLE"[\s\S]{0,120}\.includes\(errorCode\)\) \{\s*setStatus\(""\);/
  );
  assert.doesNotMatch(app, /setTurnstileStatus/);
  assert.match(app, /disabled=\{isLoggingIn \|\| !authConfig\}/);
  assert.match(widget, /render=explicit/);
  assert.match(widget, /"expired-callback"/);
  assert.match(widget, /onExpire\(\)/);
  assert.match(widget, /onLoadError\(\)/);
  assert.match(widget, /aria-busy=\{isLoading\}/);
});

test("all service features stay disabled until explicitly enabled in admin", async () => {
  const [shared, sourceSettings, publicSource] = await Promise.all([
    read("../../functions/_shared.ts"),
    read("../../functions/api/admin/source-settings.ts"),
    read("../../functions/api/htools.json.ts")
  ]);

  assert.match(
    shared,
    /getGitHubSettings[\s\S]*?if \(!row\) \{[\s\S]*?enabled: false/
  );
  assert.match(
    shared,
    /getProxySettings[\s\S]*?if \(!row\) \{[\s\S]*?enabled: false/
  );
  assert.match(
    shared,
    /getUmamiSettings[\s\S]*?if \(!row\) \{[\s\S]*?enabled: false/
  );
  assert.match(
    shared,
    /getAdminTurnstileSettings[\s\S]*?let enabled = false;[\s\S]*?\.enabled === true/
  );
  assert.doesNotMatch(
    shared,
    /getAdminTurnstileSettings[\s\S]*?let enabled = true;/
  );
  assert.match(sourceSettings, /if \(!value\) \{\s*return false;/);
  assert.match(publicSource, /if \(!row\) \{\s*return false;/);
});

test("public tool submission does not load or verify Turnstile", async () => {
  const [submissionClient, submissionPage, adminClient, widget, zh, en] = await Promise.all([
    read("../../src/submit-api.ts"),
    read("../../src/SubmitPage.tsx"),
    read("../../src/admin-api.ts"),
    read("../../src/components/TurnstileWidget.tsx"),
    read("../../src/i18n/zh.ts"),
    read("../../src/i18n/en.ts")
  ]);

  assert.doesNotMatch(submissionPage, /Turnstile|turnstileToken|authState/);
  assert.doesNotMatch(submissionClient, /Turnstile|turnstileToken|auth\/config/);
  assert.match(adminClient, /requestJsonWithTimeout<AdminAuthConfig>/);
  assert.match(widget, /if \(active\) onTokenChange\(token\)/);
  assert.match(widget, /containerRef\.current\.replaceChildren\(\)/);
  for (const messages of [zh, en]) {
    assert.match(messages, /turnstileServerFailed:/);
    assert.doesNotMatch(messages, /turnstileExpired:/);
    assert.doesNotMatch(messages, /turnstileLoadFailed:/);
  }
});

test("administrator password updates save normalized values without a length rule", async () => {
  const security = await read("../../functions/api/admin/security.ts");

  assert.match(security, /return value\.trim\(\);/);
  assert.doesNotMatch(security, /min(?:imum)?Length|length\s*[<>]=?\s*8/i);
});

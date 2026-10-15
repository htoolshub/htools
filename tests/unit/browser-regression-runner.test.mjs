import assert from "node:assert/strict";
import test from "node:test";
import {
  REGRESSION_VIEWPORTS,
  isSafeChildPath,
  parseCliArgs
} from "../../scripts/browser-regression.mjs";
import { readFile } from "node:fs/promises";

test("browser regression keeps the four project viewport contracts", () => {
  assert.deepEqual(
    REGRESSION_VIEWPORTS.map(({ width, height }) => `${width}x${height}`),
    ["2560x1440", "1920x1080", "1366x768", "419x790"]
  );
});

test("browser regression defaults to the full local preview scope", () => {
  const options = parseCliArgs([]);
  assert.equal(options.command, "run");
  assert.equal(options.scope, "full");
  assert.equal(options.origin, "http://127.0.0.1:8788");
  assert.ok(options.routes.some((route) => route.path === "/admin/settings/services"));
});

test("browser regression accepts explicit smoke routes without weakening path safety", () => {
  const options = parseCliArgs([
    "run",
    "--scope=smoke",
    "--routes=/,/admin/tools",
    "--no-screenshots"
  ]);
  assert.deepEqual(
    options.routes.map((route) => [route.path, route.admin]),
    [["/", false], ["/admin/tools", true]]
  );
  assert.equal(options.screenshots, false);
  assert.equal(isSafeChildPath("C:/repo/tmp", "C:/repo/tmp/run/profile"), true);
  assert.equal(isSafeChildPath("C:/repo/tmp", "C:/repo/README.md"), false);
  assert.equal(isSafeChildPath("C:/repo/tmp", "C:/repo/tmp"), false);
});

test("browser regression exposes isolated critical interaction flows", async () => {
  const options = parseCliArgs(["flows", "--no-screenshots"]);
  assert.equal(options.command, "flows");
  assert.equal(options.screenshots, false);

  const source = await readFile(
    new URL("../../scripts/browser-regression.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /startIsolatedPagesDev\(persistPath\)/);
  assert.match(source, /"AI=browser-regression-ai"/);
  assert.doesNotMatch(source, /"--ai"/);
  assert.match(source, /seedCriticalFlowData\(server\.origin\)/);
  assert.match(source, /inspectMobileEnglishFieldAssistants/);
  assert.match(source, /inspectAdminIdentityCard/);
  assert.match(source, /inspectMobileAdminCard/);
  assert.match(source, /后台管理员卡片点击边界与侧栏状态/);
  assert.match(source, /前台手机管理员卡片点击边界/);
  assert.match(source, /订阅内容保存推送草稿/);
  assert.match(source, /推送结果不确定确认重试/);
  assert.match(source, /await safeRemove\(runtimeRoot, runPath\)/);
});

test("browser regression rejects unsafe or ambiguous command options", () => {
  assert.throws(() => parseCliArgs(["--scope=other"]), /不支持的回归范围/);
  assert.throws(() => parseCliArgs(["--max-tmp-mb=20"]), /不小于 100/);
  assert.throws(() => parseCliArgs(["--unknown"]), /不支持的参数/);
});

test("browser regression distinguishes the login shell from password settings", async () => {
  const source = await readFile(
    new URL("../../scripts/browser-regression.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /\.auth-shell \.auth-form, \.auth-shell \.auth-card/);
  assert.doesNotMatch(source, /querySelectorAll\('input\[type="password"\]'\)/);
});

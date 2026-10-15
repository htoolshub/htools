import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const [app, admin, styles] = await Promise.all([
  readFile(new URL("../../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/styles.css", import.meta.url), "utf8")
]);

function declaration(source, name, kind = "variable") {
  const ast = ts.createSourceFile("Notifications.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    const matches = kind === "function"
      ? ts.isFunctionDeclaration(node) && node.name?.text === name
      : ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(ast) === name);
    if (matches) result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `缺少通知声明：${name}`);
  return result;
}

function execute(source, scope, result) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${result};`)(...Object.values(scope));
}

function createNotificationQueue() {
  let toasts = [];
  const timers = [];
  const notify = execute(`${declaration(app, "dismissToast")}\n${declaration(app, "notify")}`, {
    useCallback: (callback) => callback,
    setToasts: (update) => { toasts = update(toasts); },
    toastIdRef: { current: 0 },
    activeToastKeysRef: { current: new Set() },
    window: { setTimeout: (callback, delay) => timers.push({ callback, delay }) }
  }, "notify");
  return { notify, timers, get toasts() { return toasts; } };
}

test("公共通知去重、保留最近三条，并在4200毫秒后独立移除", () => {
  const queue = createNotificationQueue();
  queue.notify({ tone: "success", message: "保存成功" });
  queue.notify({ tone: "success", message: "保存成功" });
  assert.equal(queue.toasts.length, 1);
  assert.equal(queue.timers.length, 1);

  queue.notify({ tone: "error", message: "刷新失败" });
  queue.notify({ tone: "info", message: "第三条" });
  queue.notify({ tone: "info", message: "第四条" });
  assert.deepEqual(queue.toasts.map((toast) => toast.message), ["刷新失败", "第三条", "第四条"]);
  assert.deepEqual(queue.timers.map((timer) => timer.delay), [4200, 4200, 4200, 4200]);
  queue.timers[0].callback();
  assert.equal(queue.toasts.length, 3, "旧通知到期不得移除后来的通知");
  queue.timers[1].callback();
  assert.deepEqual(queue.toasts.map((toast) => toast.message), ["第三条", "第四条"]);
  queue.notify({ tone: "error", message: "刷新失败" });
  assert.deepEqual(queue.toasts.map((toast) => toast.message), ["第三条", "第四条", "刷新失败"]);
});

test("后台通过公共入口发通知，空状态不会清掉先前的操作结果", () => {
  const queue = createNotificationQueue();
  let authStatus = "旧登录错误";
  const setStatus = execute(declaration(admin, "setStatus"), {
    useCallback: (callback) => callback,
    token: "local-test-token",
    onNotify: queue.notify,
    setAuthStatus: (message) => { authStatus = message; }
  }, "setStatus");
  setStatus("保存成功");
  setStatus("");
  setStatus("刷新失败，请重新加载列表");
  assert.equal(authStatus, "");
  assert.deepEqual(queue.toasts.map((toast) => toast.message), ["保存成功", "刷新失败，请重新加载列表"]);
  assert.equal(queue.timers.length, 2);
  assert.match(app, /<AdminApp[\s\S]*?onNotify=\{notify\}/);
  assert.doesNotMatch(admin, /adminStatusTimer|adminStatusCurrentRef|setStatusEvent|className="admin-status"/);
});

test("登录错误持续留在表单中，不随公共通知到期消失", () => {
  const queue = createNotificationQueue();
  let authStatus = "";
  const setStatus = execute(declaration(admin, "setStatus"), {
    useCallback: (callback) => callback,
    token: "",
    onNotify: queue.notify,
    setAuthStatus: (message) => { authStatus = message; }
  }, "setStatus");
  queue.notify({ tone: "info", message: "先前的通知" });
  setStatus("密码错误，请重试。");
  queue.timers[0].callback();
  assert.equal(authStatus, "密码错误，请重试。");
  assert.equal(queue.toasts.length, 0);
  assert.equal(queue.timers.length, 1, "登录错误不得启动自动消失计时器");
  setStatus("");
  assert.equal(authStatus, "");
  assert.match(admin, /className="auth-inline-status" role="alert">\{authStatus\}/);
  assert.match(admin, /setAuthStatus\(t\.status\.sessionExpired\)/);
});

test("前后台通知共用可换行的样式和手机安全区", () => {
  const start = styles.indexOf(".global-toast {");
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /width: fit-content;/);
  assert.match(rule, /white-space: normal;/);
  assert.match(rule, /overflow-wrap: anywhere;/);
  assert.match(rule, /line-height: 1\.4;/);
  assert.match(styles, /\.global-toast-region \{\s*top: max\(12px, env\(safe-area-inset-top\)\)/);
  assert.doesNotMatch(styles, /\.admin-status\b/);
});

test("公共通知区域同时渲染所有消息并提供统一的无障碍关联", async () => {
  const source = declaration(app, "GlobalToasts", "function");
  let compiled = ts.transpileModule(`export ${source}`, {
    fileName: "GlobalToasts.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  compiled = compiled.replaceAll('from "react/jsx-runtime"', `from "${import.meta.resolve("react/jsx-runtime")}"`);
  compiled = `const createPortal = (children) => children; const document = { body: {} };\n${compiled}`;
  const { GlobalToasts } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const html = renderToStaticMarkup(createElement(GlobalToasts, {
    toasts: [
      { id: 1, tone: "info", message: "保存成功" },
      { id: 2, tone: "error", message: "刷新列表失败" }
    ]
  }));
  assert.ok(html.includes('id="global-operation-status"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('aria-atomic="true"'));
  assert.equal((html.match(/class="global-toast is-/g) ?? []).length, 2);
  assert.ok(html.includes("保存成功") && html.includes("刷新列表失败"));
});

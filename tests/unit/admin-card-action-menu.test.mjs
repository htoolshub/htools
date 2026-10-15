import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

async function importTsx(source, fileName) {
  let compiled = ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  for (const specifier of ["react/jsx-runtime", "lucide-react"]) {
    compiled = compiled.replaceAll(`from "${specifier}"`, `from "${import.meta.resolve(specifier)}"`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const menuSource = await readFile(new URL("../../src/components/AdminCardActionMenu.tsx", import.meta.url), "utf8");
const { AdminCardActionMenu } = await importTsx(menuSource, "AdminCardActionMenu.tsx");
const fieldExamples = await compileTypescriptModule(new URL("../../src/admin-field-examples.ts", import.meta.url));
after(() => fieldExamples.cleanup());
const translations = {};
for (const locale of ["zh", "en"]) {
  const compiled = await compileTypescriptModule(new URL(`../../src/i18n/${locale}.ts`, import.meta.url), {
    importReplacements: { "../admin-field-examples": fieldExamples.url.href }
  });
  after(() => compiled.cleanup());
  translations[locale] = (await import(compiled.url.href))[locale];
}

function createActions(open = false) {
  return {
    open,
    rootRef: { current: null },
    triggerRef: { current: null },
    close() {},
    setOpen() {},
    handleTriggerKeyDown() {},
    handleMenuKeyDown() {}
  };
}

test("后台菜单关闭时只显示具有当前语言标签的触发按钮", () => {
  for (const [locale, expected] of [["zh", "测试卡片操作菜单"], ["en", "测试卡片 actions"]]) {
    const html = renderToStaticMarkup(createElement(AdminCardActionMenu, {
      actions: createActions(),
      items: [],
      label: translations[locale].actions.menu("测试卡片")
    }));
    assert.ok(html.includes(`aria-label="${expected}"`));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes('aria-haspopup="menu"'));
    assert.doesNotMatch(html, /role="menu"|is-active/);
  }
});

test("后台菜单保留各项顺序、长短文案、危险样式和独立禁用状态", () => {
  const html = renderToStaticMarkup(createElement(AdminCardActionMenu, {
    actions: createActions(true),
    label: translations.zh.actions.menu("推送"),
    items: [
      { key: "edit", label: "编辑推送", shortLabel: "编辑", icon: null, disabled: true, onSelect() {} },
      { key: "delete", label: "删除推送", shortLabel: "删除", icon: null, danger: true, onSelect() {} }
    ]
  }));
  const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
  assert.equal(buttons.length, 3);
  assert.doesNotMatch(buttons[0], /disabled/);
  assert.match(buttons[1], /disabled=""[^>]*role="menuitem"/);
  assert.match(buttons[1], /admin-action-label-full">编辑推送/);
  assert.match(buttons[1], /admin-action-label-short">编辑/);
  assert.match(buttons[2], /class="danger"/);
  assert.doesNotMatch(buttons[2], /disabled/);
  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(html.includes('role="menu"'));
});

test("后台菜单沿用 Hook 引用和键盘回调，并在业务动作之前关闭", () => {
  const events = [];
  const actions = createActions(true);
  actions.close = () => events.push("close");
  actions.setOpen = (update) => events.push(update(true));
  const tree = AdminCardActionMenu({
    actions,
    label: "菜单",
    triggerDisabled: true,
    items: [{ key: "original", label: "打开原文", shortLabel: "原文", icon: null, onSelect: () => events.push("original") }]
  });
  const [trigger, menu] = tree.props.children;
  assert.equal(trigger.props.ref, actions.triggerRef);
  assert.equal(trigger.props.onKeyDown, actions.handleTriggerKeyDown);
  assert.equal(menu.props.onKeyDown, actions.handleMenuKeyDown);
  assert.equal(trigger.props.disabled, true);
  trigger.props.onClick();
  menu.props.children[0].props.onClick();
  assert.deepEqual(events, [false, "close", "original"]);
});

const adminSource = await readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8");

test("五类后台菜单共享展示组件并继续使用原公共 Hook", async () => {
  const consumers = [
    adminSource,
    ...await Promise.all([
      "../../src/components/admin-cards/AdminToolCard.tsx",
      "../../src/components/admin-cards/AdminArticleCard.tsx",
      "../../src/components/AdminTelegramPush.tsx"
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")))
  ];
  assert.equal(consumers.reduce((count, source) => count + (source.match(/<AdminCardActionMenu\b/g) ?? []).length, 0), 5);
  assert.equal(consumers.reduce((count, source) => count + (source.match(/useAdminCardActionMenu\(/g) ?? []).length, 0), 5);
  for (const source of consumers) {
    assert.doesNotMatch(source, /className="admin-tool-action-menu"|aria-label=\{`\$\{[^}]+\} actions`\}/);
    assert.doesNotMatch(source, /handleMenuKeyDown\s*\(|handleTriggerKeyDown\s*\(/);
  }
  assert.match(menuSource, /className="admin-tool-action-menu"/);
});

const adminAst = ts.createSourceFile("AdminApp.tsx", adminSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const toggle = adminAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "BooleanSegmentedToggle");
let importModeField;
function findImportMode(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(adminAst) === "BooleanSegmentedToggle" && node.getText(adminAst).includes("maintenanceText.sourceModeSkip")) {
    importModeField = node;
  }
  ts.forEachChild(node, findImportMode);
}
findImportMode(adminAst);
assert.ok(toggle && importModeField, "导入方式应引用现有 BooleanSegmentedToggle");
const { renderImportMode } = await importTsx(
  `${toggle.getText(adminAst)}\nexport function renderImportMode(sourceMode, setSourceMode, maintenanceText) { return (${importModeField.getText(adminAst)}); }`,
  "ImportMode.tsx"
);

test("导入分段保留跳过在前、覆盖在后，并写回原有 mode", () => {
  const modes = [];
  for (const mode of ["skip", "upsert"]) {
    const field = renderImportMode(mode, (next) => modes.push(next), { sourceModeSkip: "跳过重复", sourceModeUpsert: "覆盖更新" });
    const buttons = field.type(field.props).props.children;
    assert.equal(buttons[0].props.children[1].props.children, "跳过重复");
    assert.equal(buttons[1].props.children[1].props.children, "覆盖更新");
    assert.equal(buttons[0].props["aria-pressed"], mode === "skip");
    assert.equal(buttons[1].props["aria-pressed"], mode === "upsert");
    buttons[1].props.onClick();
    buttons[0].props.onClick();
  }
  assert.deepEqual(modes, ["upsert", "skip", "upsert", "skip"]);
});

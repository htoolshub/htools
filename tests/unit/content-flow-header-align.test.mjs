import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [styles, adminSource, skeletonSource, panelStates] = await Promise.all([
  read("../../src/styles.css"),
  read("../../src/AdminApp.tsx"),
  read("../../src/components/admin-skeletons/ContentFlowSkeleton.tsx"),
  read("../../src/components/AdminPanelStates.tsx")
]);

function ruleFor(selector) {
  const start = styles.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `找不到 CSS 规则 ${selector}`);
  const end = styles.indexOf("}", start);
  assert.notEqual(end, -1, `${selector} 的规则没有闭合`);
  return styles.slice(start, end);
}

const declaration = (rule, property) => {
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(rule);
  return match ? match[1].trim() : null;
};

test("左栏标题块和中栏标题条共用同一组几何数值（这是“对齐”的前提）", () => {
  const head = ruleFor(".content-flow-section-head");
  // 中栏那条规则是 .content-source-toolbar, .content-reader-toolbar 合写的
  const toolbarStart = styles.indexOf("\n.content-source-toolbar,");
  assert.notEqual(toolbarStart, -1);
  const toolbar = styles.slice(toolbarStart, styles.indexOf("}", toolbarStart));

  for (const property of ["height", "min-height", "padding", "border-bottom"]) {
    assert.equal(
      declaration(head, property),
      declaration(toolbar, property),
      `${property} 必须和中栏标题条一致,否则两栏内容起始线又会错开`
    );
  }
  assert.equal(declaration(head, "height"), "52px");
  assert.equal(declaration(head, "border-bottom"), "1px solid var(--border)");
});

test("左栏标题字号降到和中栏标题相同", () => {
  const h2 = ruleFor(".content-flow-section-head h2");
  const toolbarTitle = ruleFor(".content-source-toolbar-title strong");

  for (const property of ["font-size", "font-weight", "line-height"]) {
    assert.equal(declaration(h2, property), declaration(toolbarTitle, property));
  }
  assert.equal(declaration(h2, "font-size"), "14px");
  assert.equal(declaration(h2, "font-weight"), "500");
});

test("左栏那两行说明文字已经不在标题块里，样式与遮罩残留也清掉了", () => {
  const head = adminSource.slice(
    adminSource.indexOf('<div className="content-flow-section-head">'),
    adminSource.indexOf('<div className="content-source-list">')
  );
  assert.notEqual(head.length, 0);
  assert.match(head, /<h2>\{contentText\.title\}<\/h2>/);
  assert.doesNotMatch(head, /contentText\.description/);

  // 骨架必须同步,否则加载中还会占着两行的高度
  assert.match(skeletonSource, /<h2>\{contentText\.title\}<\/h2>/);
  assert.doesNotMatch(skeletonSource, /contentText\.description/);

  // 已经没有 <p> 了,这两处 CSS 不许留着
  assert.doesNotMatch(styles, /\.content-flow-section-head p \{/);
  assert.doesNotMatch(styles, /\.content-flow-section-head > p:first-of-type/);
});

test("订阅骨架复用三栏和真实行容器，仅显示通用细线", () => {
  for (const className of [
    "content-flow-rail",
    "content-flow-main",
    "content-flow-reader",
    "content-flow-section-head",
    "content-source-toolbar",
    "content-reader-toolbar",
    "content-source-list",
    "content-source-group",
    "content-item-list",
    "content-item-card has-source-icon",
    "content-item-select",
    "content-item-title-row",
    "content-item-summary"
  ]) {
    assert.ok(skeletonSource.includes(`className="${className}"`), `骨架必须保留 ${className}`);
  }
  assert.match(skeletonSource, /<ArticleDetailContentSkeleton \/>/);
  assert.doesNotMatch(skeletonSource, /skeleton-layout-mask|lucide-react|<button\b|<small\b|<img\b/);
  assert.doesNotMatch(skeletonSource, /content-source-group-wrap|content-source-group-items|content-source-icon/);
  assert.doesNotMatch(skeletonSource, /placeholder|\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(styles, /\.skeleton-layout-mask \.content-(?:source|item)-/);
});

test("订阅条目细线保留标题日期行盒和两行摘要，不固定卡片总高度", () => {
  assert.match(skeletonSource, /<strong><span className="skeleton-shimmer skeleton-line is-long" \/><\/strong>/);
  assert.match(skeletonSource, /<time><span className="skeleton-shimmer skeleton-line is-long" \/><\/time>/);
  assert.match(
    skeletonSource,
    /<span className="content-item-summary">\s*<span className="skeleton-shimmer skeleton-line is-long" \/>\s*<span className="skeleton-shimmer skeleton-line is-medium" \/>\s*<\/span>/
  );
  assert.match(
    styles,
    /\.content-flow-skeleton \.content-item-title-row strong,\s*\.content-flow-skeleton \.content-item-title-row time \{/
  );
  const titleLine = ruleFor(".content-flow-skeleton .content-item-title-row time");
  assert.equal(declaration(titleLine, "min-height"), "1lh");
  assert.equal(declaration(titleLine, "display"), "grid");
  const summary = ruleFor(".content-flow-skeleton .content-item-summary");
  assert.equal(declaration(summary, "display"), "grid");
  assert.equal(declaration(summary, "grid-template-rows"), "repeat(2, 1lh)");
  assert.doesNotMatch(styles, /\.content-flow-skeleton \.content-item-card(?:\s|[.{:#])/);
});

test("说明文字搬进订阅内容空态：两句拼接，且公共空态组件一个字未改", () => {
  assert.match(
    adminSource,
    /`\$\{contentText\.description\} \$\{contentText\.itemEmptyDescription\}`/
  );

  // 公共组件被四个栏目共用:description 必须仍是单个 string,不许为这次改动加属性
  assert.match(panelStates, /description: string;/);
  assert.doesNotMatch(panelStates, /descriptionLines|extraDescription|descriptions\??:/);
  const emptyState = panelStates.slice(
    panelStates.indexOf("export function AdminEmptyState("),
    panelStates.indexOf("export function AdminInitialLoadError(")
  );
  assert.notEqual(emptyState.length, 0);
  assert.match(emptyState, /<p>\{description\}<\/p>/);

  // 另外三个栏目仍然只传各自那一个文案键,没被顺手改成拼接
  const otherCalls = [
    // 工具库
    /tools\.length === 0\s*\?\s*t\.empty\.libraryDescription\s*:\s*t\.admin\.emptyDescription/,
    // 文章管理
    /adminArticlesTotal === 0\s*\?\s*articleText\.emptyDescription\s*:\s*articleText\.noMatchDescription/
  ];
  for (const pattern of otherCalls) {
    assert.match(adminSource, pattern);
  }
  // 公共组件的属性表必须还是原来那四个,没有为这次改动新开口子
  assert.match(emptyState, /\{\s*action,\s*className = "",\s*description,\s*title\s*\}/);
  assert.doesNotMatch(
    adminSource,
    /`\$\{contentText\.description\} \$\{contentText\.sourceEmptyDescription\}`/,
    "“还没有订阅”那条空态本来就自带说明,不该再拼一遍"
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminSource, adminTextSource, articleTextSource, siteIconSource, telegramSource, typeSource, zhSource, enSource, toolCardSource, articleCardSource] =
  await Promise.all([
    readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/admin-text.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/article-helpers.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/AdminSiteIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/telegram.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/type.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/zh.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/en.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/admin-cards/AdminToolCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/admin-cards/AdminArticleCard.tsx", import.meta.url), "utf8")
  ]);

test("article covers and Telegram media share one URL example", () => {
  assert.equal(
    (articleTextSource.match(/coverImagePlaceholder: "https:\/\/example\.com\/preview\.png"/g) ?? []).length,
    2
  );
  assert.equal(
    (telegramSource.match(/mediaUrlPlaceholder: "[^"]*https:\/\/example\.com\/preview\.png"/g) ?? []).length,
    2
  );
});

test("admin category labels identify the category set used by each workspace", () => {
  for (const field of ["toolLabel", "articleLabel", "contentLabel", "pushLabel"]) {
    assert.match(adminTextSource, new RegExp(`\\b${field}:`));
    assert.match(adminSource, new RegExp(`categoryText\\.${field}\\b`));
  }

  assert.match(zhSource, /category: "工具分类"/);
  assert.match(enSource, /category: "Tool category"/);
  assert.match(articleTextSource, /categoryLabel: "文章分类"/);
  assert.match(articleTextSource, /categoryLabel: "Article category"/);
  assert.match(adminTextSource, /categoryLabel: "订阅分类"/);
  assert.match(adminTextSource, /categoryLabel: "Subscription category"/);
  assert.equal((adminSource.match(/telegramText\.categoryLabel/g) ?? []).length, 2);
  assert.match(telegramSource, /categoryLabel: "推送分类"/);
  assert.match(telegramSource, /categoryLabel: "Push category"/);
});

function readAdminTextValues(key) {
  const values = Array.from(
    adminTextSource.matchAll(new RegExp(`\\b${key}: ("(?:[^"\\\\]|\\\\.)*")`, "g")),
    (match) => JSON.parse(match[1])
  );
  assert.equal(values.length, 2, `${key} 应该只有中文和英文两处定义`);
  return values;
}

test("分类组件与订阅源表单使用同一个订阅分类术语", () => {
  // 订阅源表单的字段标签走 contentText.categoryLabel，控件空态与必填提示走
  // categoryText.contentLabel。两处说的是同一件事，值必须一致，否则同一个
  // 表单里会同时出现两种术语。JSON.parse 让 \uXXXX 转义和中文字面量等价比较。
  const [categorySetZh, categorySetEn] = readAdminTextValues("contentLabel");
  const [formFieldZh, formFieldEn] = readAdminTextValues("categoryLabel");
  assert.equal(categorySetZh, formFieldZh);
  assert.equal(categorySetEn, formFieldEn);
  assert.equal(categorySetZh, "订阅分类");
  assert.equal(categorySetEn, "Subscription category");
});

test("英文分类空态与订阅源表单说明文字逐字相同", () => {
  // 中文两边天然一致（"选择或新建" + 标签）。英文这边 selectOrCreateLabel 生成的是
  // "Select or create a subscription category"，必须和订阅源表单紧挨着的说明文字
  // contentText.categoryPlaceholder 完全一样，否则同一个表单上下两行说法不同。
  // 冠词由 withEnglishArticle 按首字母元音决定 —— "article category" 要 "an"，
  // 直接写死 "a" 会产出 "a article category"。
  assert.match(
    adminTextSource,
    /function withEnglishArticle\(noun: string\) \{\s*return `\$\{\/\^\[aeiou\]\/i\.test\(noun\) \? "an" : "a"\} \$\{noun\}`;/
  );
  assert.match(
    adminTextSource,
    /selectOrCreateLabel: \(label: string\) =>\s*`Select or create \$\{withEnglishArticle\(label\.toLowerCase\(\)\)\}`/
  );

  const [, placeholderEn] = readAdminTextValues("categoryPlaceholder");
  const [, categorySetEn] = readAdminTextValues("contentLabel");
  const article = /^[aeiou]/i.test(categorySetEn) ? "an" : "a";
  assert.equal(
    placeholderEn,
    `Select or create ${article} ${categorySetEn.toLowerCase()}`
  );
});

test("admin category dialogs and status messages use the workspace locale text", () => {
  for (const field of [
    "migrationTargetRequired",
    "clearTitle",
    "manageTitle",
    "clearAllAction",
    "deleteWithContentAction",
    "migrateAction",
    "clearDescription",
    "occupiedDescription",
    "migrateToLabel",
    "migrateHelp",
    "selectOrCreateLabel",
    "requiredLabel",
    "cleared",
    "featuredCleared",
    "removed",
    "migrated"
  ]) {
    assert.match(adminTextSource, new RegExp(`\\b${field}:`));
    assert.match(adminSource, new RegExp(`categoryText\\.${field}\\b`));
  }

  assert.doesNotMatch(adminSource, /t\.categories\.All/);
  assert.doesNotMatch(adminSource, /getAdminCategoryScopeLabel/);
  assert.doesNotMatch(adminSource, /isChineseLocaleText\(t\)[\s\S]{0,120}(?:清空|迁移|分类)/);
});

test("content source preview uses localized workspace text", () => {
  assert.match(adminSource, /contentText\.previewLoaded\(preview\.items\.length\)/);
  assert.match(adminTextSource, /previewLoaded: \(count: number\)/);
});

test("article draft actions use one concise label", () => {
  assert.match(articleTextSource, /draftLabel: "存为草稿"/);
  assert.match(articleTextSource, /draftLabel: "Save draft"/);
  assert.match(adminTextSource, /convertAsDraft: "存为草稿"/);
  assert.match(adminTextSource, /convertAsDraft: "Save draft"/);
  assert.doesNotMatch(articleTextSource, /保存为草稿|Save as draft/);
});

test("content flow UI consistently describes RSS sources without the old Atom label", () => {
  assert.match(adminTextSource, /sourceUrlLabel: "RSS 源地址"/);
  assert.match(adminTextSource, /sourceUrlLabel: "RSS URL"/);
  assert.doesNotMatch(adminTextSource, /RSS \/ Atom/);
});

test("subscription content is the shared user-facing workspace name", () => {
  assert.match(adminTextSource, /nav: "订阅内容"/);
  assert.match(adminTextSource, /title: "订阅内容"/);
  assert.match(adminTextSource, /nav: "Subscription Content"/);
  assert.match(telegramSource, /typeContent: "订阅内容"/);
  assert.match(telegramSource, /typeContent: "Subscription Content"/);
  assert.doesNotMatch(adminTextSource, /nav: "内容流"|title: "内容流"|nav: "Content Flow"|title: "Content Flow"/);
});

test("subscription content actions do not expose the retired source terminology", () => {
  for (const pattern of [
    /addSource: "添加订阅"/,
    /addContent: "添加订阅"/,
    /editSource: "编辑订阅"/,
    /deleteSource: "删除订阅"/,
    /categoryLabel: "订阅分类"/,
    /categoryPlaceholder: "选择或新建订阅分类"/,
    /saved: "订阅已保存。"/,
    /deleted: "订阅已删除。"/
  ]) {
    assert.match(adminTextSource, pattern);
  }
  assert.doesNotMatch(adminTextSource, /添加内容源|编辑内容源|删除内容源|内容源分类|订阅源标题/);
  assert.doesNotMatch(adminSource, /<strong>Content source<\/strong>|>Content source<\/span>/);
});

test("subscription entries reuse site avatars while actions stay in the selected source toolbar", () => {
  const contentPanel = adminSource.slice(
    adminSource.indexOf("function AdminContentFlowPanel"),
    adminSource.indexOf("function ContentSourceButton")
  );
  const sourceButton = adminSource.slice(
    adminSource.indexOf("function ContentSourceButton"),
    adminSource.indexOf("function ContentItemCard")
  );

  assert.match(sourceButton, /<AdminSiteIcon[\s\S]*?url=\{source\.siteUrl \|\| source\.url\}/);
  assert.match(sourceButton, /className="content-source-icon"/);
  assert.doesNotMatch(sourceButton, /getToolInitials/);
  assert.doesNotMatch(sourceButton, /admin-tool-avatar/);
  assert.doesNotMatch(sourceButton, /<Rss/);
  assert.doesNotMatch(contentPanel, /content-source-all-icon/);
  assert.match(contentPanel, /useAdminCardActionMenu\([\s\S]*content-source-header:/);
  assert.match(contentPanel, /<RefreshCw[\s\S]*?admin-tool-menu-trigger/);
  assert.match(contentPanel, /className="admin-tool-action-menu"[\s\S]*?onEditSource\(selectedSource\)[\s\S]*?onDeleteSource\(selectedSource\)/);
  assert.match(contentPanel, /showSourceIcon=\{!selectedSource\}/);
  assert.match(contentPanel, /source=\{contentSources\.find\(\(source\) => source\.id === item\.sourceId\)/);
  assert.doesNotMatch(
    contentPanel,
    /selectedSource \? contentSourceCounts\[selectedSource\.id\][\s\S]*contentSources\.length/
  );
});

test("admin site icons show a shared globe placeholder instead of name initials", () => {
  assert.match(siteIconSource, /import \{ Globe \} from "lucide-react"/);
  assert.match(siteIconSource, /createAdminIconFromUrl\(url\)/);
  assert.match(siteIconSource, /<Globe aria-hidden="true" size=\{iconSize\} \/>/);
  assert.match(siteIconSource, /className=\{loaded \? "is-loaded" : ""\}/);
  assert.doesNotMatch(siteIconSource, /getToolInitials|style\.display/);
  for (const source of [adminSource, toolCardSource]) {
    assert.doesNotMatch(source, /event\.currentTarget\.style\.display = "none"/);
    assert.doesNotMatch(source, /<span>HT<\/span>/);
  }
  assert.match(
    toolCardSource,
    /<AdminSiteIcon\s+className="admin-tool-avatar"[\s\S]*?url=\{tool\.url\}/
  );
});

test("compact card actions have explicit localized labels", () => {
  for (const field of ["editAction", "deleteAction"]) {
    const definition = new RegExp(`\\b${field}:`);
    assert.match(typeSource, definition);
    assert.match(zhSource, definition);
    assert.match(enSource, definition);
    assert.match(articleTextSource, definition);
  }

  assert.match(toolCardSource, /t\.admin\.editAction/);
  assert.match(toolCardSource, /t\.admin\.deleteAction/);
  assert.match(articleCardSource, /articleText\.editAction/);
  assert.match(articleCardSource, /articleText\.deleteAction/);
  for (const source of [adminSource, toolCardSource, articleCardSource]) {
    assert.doesNotMatch(source, /getCompactAdminActionLabel/);
    assert.doesNotMatch(source, /\(工具\|文章\)/);
  }
});

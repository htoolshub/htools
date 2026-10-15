import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminSource, helperSource] = await Promise.all([
  readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/article-helpers.ts", import.meta.url), "utf8")
]);

test("article editor keeps content fields in the shared information order", () => {
  const editor = adminSource.slice(
    adminSource.indexOf('id="admin-article-editor-form"'),
    adminSource.indexOf("{contentSourceFormOpen ?", adminSource.indexOf('id="admin-article-editor-form"'))
  );
  const labels = [
    "articleText.titleLabel",
    "articleText.summaryLabel",
    "articleText.slugLabel",
    "articleText.tagsLabel",
    "articleText.coverImageLabel",
    "articleText.categoryLabel",
    "articleText.publishTimeLabel",
    "articleText.contentLabel"
  ].map((label) => editor.indexOf(label));

  assert.ok(labels.every((index) => index >= 0));
  assert.deepEqual([...labels].sort((left, right) => left - right), labels);
  assert.match(helperSource, /slugLabel: "文章路径"/);
  assert.match(helperSource, /slugLabel: "Article path"/);
  assert.match(helperSource, /titlePlaceholder: "文章标题"/);
  assert.match(helperSource, /titlePlaceholder: "Article title"/);
  assert.match(helperSource, /slugPlaceholder: "用于文章访问地址，留空会自动生成"/);
  assert.match(helperSource, /slugPlaceholder: "Used in the article URL\. Leave empty to generate automatically"/);
  assert.doesNotMatch(helperSource, /(?:slug|summary|content)Placeholder: "[^"]*[。.]"/);
  assert.doesNotMatch(helperSource, /slugHelp/);
  assert.match(adminSource, /description=\{\s*editingArticle \? articleText\.editArticleDescription : articleText\.addArticleDescription\s*\}/);
});

test("article helpers sit beside their fields and explanatory text precedes inputs", () => {
  const editor = adminSource.slice(
    adminSource.indexOf('id="admin-article-editor-form"'),
    adminSource.indexOf("{contentSourceFormOpen ?", adminSource.indexOf('id="admin-article-editor-form"'))
  );

  assert.match(editor, /task="article_title"/);
  assert.match(editor, /label=\{maintenanceText\.aiGenerateTitle\}/);
  assert.match(
    editor,
    /articleText\.categoryLabel[\s\S]*?articleText\.categoryPlaceholder[\s\S]*?<AdminCategoryFilter/
  );
  assert.match(
    editor,
    /articleText\.publishTimeLabel[\s\S]*?articleText\.publishTimeHelp[\s\S]*?id="admin-article-published-at"[\s\S]*?articleText\.publishTimeAction/
  );
  assert.match(editor, /\.showPicker\(\)/);
});

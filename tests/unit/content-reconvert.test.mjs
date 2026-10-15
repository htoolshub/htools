import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const endpoint = await readFile(
  new URL(
    "../../functions/api/admin/content-items/[id]/to-article.ts",
    import.meta.url
  ),
  "utf8"
);
const adminApp = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);

test("reconverting updates only article category and publish settings", () => {
  const helper = endpoint.match(
    /async function updateExistingArticleSettings[\s\S]*?\n}\n/
  )?.[0];

  assert.ok(helper);
  assert.match(helper, /SET category = \?/);
  assert.match(helper, /published = \?/);
  assert.match(helper, /published_at = CASE/);
  assert.doesNotMatch(helper, /SET[\s\S]*?content = \?/);
  assert.doesNotMatch(helper, /SET[\s\S]*?title = \?/);
});

test("converted content cards remain available for article-setting updates", () => {
  assert.doesNotMatch(
    adminApp,
    /disabled=\{Boolean\(item\.articleId\) \|\| isConvertLocked\}/
  );
  assert.match(adminApp, /item\.articleId \? contentText\.updateArticle/);
  assert.match(adminApp, /item\.articleCategory/);
  assert.match(adminApp, /item\.articlePublished === false \? "draft"/);
});

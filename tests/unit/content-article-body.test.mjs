import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiled = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const { buildContentItemArticleContent, createContentItemMarker } = await import(
  `${compiled.url.href}?content-article-body=1`
);

after(() => compiled.cleanup());

test("preview and converted article bodies share the same original-link section", () => {
  const preview = buildContentItemArticleContent({
    body: "Article body",
    originalUrl: "https://example.com/post"
  });
  const converted = buildContentItemArticleContent({
    body: "Article body",
    contentItemId: "item-1",
    originalUrl: "https://example.com/post"
  });

  assert.equal(converted.replace(`${createContentItemMarker("item-1")}\n\n`, ""), preview);
});

test("original links are validated, encoded and not duplicated", () => {
  const encoded = buildContentItemArticleContent({
    body: "Body",
    originalUrl: "https://example.com/a path/(entry)"
  });
  const duplicate = buildContentItemArticleContent({
    body: "Already linked: https://example.com/post",
    originalUrl: "https://example.com/post"
  });
  const unsafe = buildContentItemArticleContent({
    body: "Body",
    originalUrl: "javascript:alert(1)"
  });

  assert.match(encoded, /https:\/\/example\.com\/a%20path\/%28entry%29/);
  assert.doesNotMatch(duplicate, /## \u539f\u6587\u94fe\u63a5/);
  assert.equal(unsafe, "Body");
});

test("long converted bodies reserve complete marker and original-link suffix", () => {
  const marker = createContentItemMarker("item-long");
  const content = buildContentItemArticleContent({
    body: `Start\n\n\`\`\`js\n${"const value = 1;\n".repeat(5000)}`,
    contentItemId: "item-long",
    originalUrl: "https://example.com/post",
    maxLength: 60000
  });

  assert.ok(content.length <= 60000);
  assert.ok(content.includes(marker));
  assert.ok(content.endsWith("[\u9605\u8bfb\u539f\u6587](https://example.com/post)"));
  assert.equal((content.match(/^```/gm) ?? []).length % 2, 0);
});

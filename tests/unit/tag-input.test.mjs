import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const adminHelpersStub = `data:text/javascript,${encodeURIComponent(`
  export const ADMIN_FEATURED_CATEGORY = "Featured";
`)}`;
const compiledToolHelpers = await compileTypescriptModule(
  new URL("../../src/tool-helpers.ts", import.meta.url),
  { importReplacements: { "./admin-helpers": adminHelpersStub } }
);
const toolHelpers = await import(`${compiledToolHelpers.url.href}?tag-input=1`);

after(async () => {
  await compiledToolHelpers.cleanup();
});

test("tag input accepts separated hashtags without breaking legacy delimiters", () => {
  assert.deepEqual(
    toolHelpers.parseArticleTagsInput("#Cloudflare #Worker #Pages"),
    ["Cloudflare", "Worker", "Pages"]
  );
  assert.deepEqual(
    toolHelpers.parseArticleTagsInput("Cloudflare, Worker；Pages"),
    ["Cloudflare", "Worker", "Pages"]
  );
  assert.deepEqual(
    toolHelpers.parseArticleTagsInput("#Cloudflare, Worker #Pages"),
    ["Cloudflare", "Worker", "Pages"]
  );
  assert.equal(
    toolHelpers.formatTagInputText(["#Cloudflare", "Worker", "#Pages"]),
    "Cloudflare, Worker, Pages"
  );
  assert.equal(
    toolHelpers.normalizeTagInputText("#测试, #测试2"),
    "测试, 测试2"
  );
});

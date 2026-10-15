import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const stub = (body) => `data:text/javascript,${encodeURIComponent(body)}`;
const compiledAdminDisplay = await compileTypescriptModule(
  new URL("../../src/admin-display.ts", import.meta.url),
  {
    importReplacements: {
      "./article-helpers": stub(
        `export function normalizeMarkdownImageUrl(value) {` +
          ` return String(value ?? "").trim().replace(/^<|>$/g, "").replace(/^['"]|['"]$/g, ""); }`
      ),
      "./tool-helpers": stub(
        `export function isValidHttpUrl(value) {` +
          ` try { const url = new URL(value);` +
          ` return url.protocol === "http:" || url.protocol === "https:"; }` +
          ` catch { return false; } }`
      )
    }
  }
);
const adminDisplay = await import(`${compiledAdminDisplay.url.href}?admin-display=1`);

const METADATA = {
  name: "元数据名",
  description: "元数据简介",
  demoUrl: "https://demo.example.com",
  image: "https://img.example.com/a.png",
  language: "TypeScript",
  license: "MIT"
};

function fields(overrides = {}) {
  return {
    name: "",
    description: "",
    url: "",
    demoUrl: "",
    image: "",
    tags: [],
    ...overrides
  };
}

after(async () => {
  await compiledAdminDisplay.cleanup();
});

test("metadata fills only blank fields and always replaces the repository URL", () => {
  const filled = adminDisplay.applyGitHubMetadataToFields(
    fields(),
    METADATA,
    "https://github.com/a/b"
  );

  assert.deepEqual(filled, {
    name: "元数据名",
    description: "元数据简介",
    url: "https://github.com/a/b",
    demoUrl: "https://demo.example.com",
    image: "https://img.example.com/a.png",
    tags: []
  });

  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "我填的名字" }),
      METADATA,
      "https://github.com/a/b"
    ).name,
    "我填的名字"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "   " }),
      METADATA,
      "https://github.com/a/b"
    ).name,
    "元数据名"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ url: "https://old.example.com" }),
      METADATA,
      "https://github.com/new"
    ).url,
    "https://github.com/new"
  );
});

test("tags are never touched by metadata merges in either mode", () => {
  assert.deepEqual(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ tags: ["保留"] }),
      METADATA,
      "https://github.com/a/b"
    ).tags,
    ["保留"]
  );
  assert.deepEqual(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ tags: ["保留"] }),
      METADATA,
      "https://github.com/a/b",
      null,
      true
    ).tags,
    ["保留"]
  );
});

test("values left over from a previous metadata read are refreshed, edits are not", () => {
  const previous = { ...METADATA, name: "上次读到的名字" };

  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "上次读到的名字" }),
      METADATA,
      "https://github.com/a/b",
      previous
    ).name,
    "元数据名"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "  上次读到的名字  " }),
      METADATA,
      "https://github.com/a/b",
      previous
    ).name,
    "元数据名"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "我手动改过" }),
      METADATA,
      "https://github.com/a/b",
      previous
    ).name,
    "我手动改过"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "我填的名字" }),
      METADATA,
      "https://github.com/a/b",
      { ...previous, name: "" }
    ).name,
    "我填的名字"
  );
});

test("overwrite mode replaces fields, unless they changed while the request was in flight", () => {
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "我填的名字" }),
      METADATA,
      "https://github.com/a/b",
      null,
      true
    ).name,
    "元数据名"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "我填的名字" }),
      METADATA,
      "https://github.com/a/b",
      null,
      true,
      fields({ name: "我填的名字" })
    ).name,
    "元数据名"
  );
  assert.equal(
    adminDisplay.applyGitHubMetadataToFields(
      fields({ name: "请求途中又改了" }),
      METADATA,
      "https://github.com/a/b",
      null,
      true,
      fields({ name: "我填的名字" })
    ).name,
    "请求途中又改了"
  );
});

test("the form-level merge adds language and license and keeps unrelated fields", () => {
  const merged = adminDisplay.applyGitHubMetadataToForm(
    { ...fields(), category: "开发工具", featured: true },
    METADATA,
    "https://github.com/a/b"
  );

  assert.equal(merged.githubLanguage, "TypeScript");
  assert.equal(merged.githubLicense, "MIT");
  assert.equal(merged.category, "开发工具");
  assert.equal(merged.featured, true);
  assert.equal(merged.name, "元数据名");
});

test("only github.com itself counts as a GitHub URL", () => {
  for (const url of [
    "https://github.com/a/b",
    "https://www.github.com/a",
    "HTTPS://GITHUB.COM/a",
    "http://github.com/a"
  ]) {
    assert.equal(adminDisplay.isGitHubUrl(url), true);
  }

  for (const url of [
    "https://gist.github.com/a",
    "https://github.com.evil.example.com/a",
    "https://notgithub.com",
    "不是网址",
    ""
  ]) {
    assert.equal(adminDisplay.isGitHubUrl(url), false);
  }
});

test("admin site icons are keyed by the lowercased hostname", () => {
  assert.equal(
    adminDisplay.createAdminIconFromUrl("https://GitHub.com/a/b"),
    "/icons/github.com/icon.png?fallback=empty"
  );
  assert.equal(
    adminDisplay.createAdminIconFromUrl("https://example.com:8443/p"),
    "/icons/example.com/icon.png?fallback=empty"
  );
  assert.equal(
    adminDisplay.createAdminIconFromUrl("https://中文.example.com"),
    "/icons/xn--fiq228c.example.com/icon.png?fallback=empty"
  );
  assert.equal(adminDisplay.createAdminIconFromUrl("不是网址"), "");
  assert.equal(adminDisplay.createAdminIconFromUrl(""), "");
});

test("unpublished articles are browsed through a preview query", () => {
  assert.equal(adminDisplay.createArticleBrowseHref("my-slug", true), "/articles/my-slug");
  assert.equal(
    adminDisplay.createArticleBrowseHref("my-slug", false),
    "/articles/my-slug?preview=1"
  );
  for (const published of [undefined, null]) {
    assert.equal(
      adminDisplay.createArticleBrowseHref("my-slug", published),
      "/articles/my-slug?preview=1"
    );
  }
  assert.equal(adminDisplay.createArticleBrowseHref("a/b", true), "/articles/a%2Fb");
  assert.equal(adminDisplay.createArticleBrowseHref("a b", true), "/articles/a%20b");
});

test("GitHub counts are abbreviated at one decimal and never go negative", () => {
  for (const [value, expected] of [
    [0, "0"],
    [1, "1"],
    [999, "999"],
    [1000, "1k"],
    [1049, "1k"],
    [1050, "1.1k"],
    [1100, "1.1k"],
    [9999, "10k"],
    [10000, "10k"],
    [999999, "1000k"],
    [1000000, "1m"],
    [1049999, "1m"],
    [1500000, "1.5m"],
    [-1, "0"],
    [-5, "0"]
  ]) {
    assert.equal(adminDisplay.formatGitHubCount(value), expected);
  }
});

test("unparsable update timestamps render as an empty string", () => {
  assert.equal(adminDisplay.formatGitHubUpdatedAt(""), "");
  assert.equal(adminDisplay.formatGitHubUpdatedAt("not a date"), "");
  assert.equal(adminDisplay.formatGitHubUpdatedAt("2026-13-45"), "");
  assert.notEqual(adminDisplay.formatGitHubUpdatedAt("2026-08-14T00:00:00Z"), "");
});

test("content previews only accept absolute HTTP image URLs", () => {
  for (const coverImage of [
    "https://a.example.com/i.png",
    "<https://a.example.com/i.png>",
    "'https://a.example.com/i.png'"
  ]) {
    assert.equal(
      adminDisplay.getContentItemPreviewImage({ coverImage }),
      "https://a.example.com/i.png"
    );
  }

  assert.equal(
    adminDisplay.getContentItemPreviewImage({ coverImage: "http://a.example.com/i.png" }),
    "http://a.example.com/i.png"
  );
  for (const coverImage of ["/local.png", "", "not a url", "javascript:alert(1)"]) {
    assert.equal(adminDisplay.getContentItemPreviewImage({ coverImage }), "");
  }
});

test("GitHub detail labels are localized except the shared metric names", () => {
  const zh = adminDisplay.getGitHubMetadataDetailText("zh");
  const en = adminDisplay.getGitHubMetadataDetailText("en");

  assert.equal(zh.title, "GitHub 详情");
  assert.equal(en.title, "GitHub details");
  assert.equal(zh.forks, en.forks);
  assert.equal(zh.stars, en.stars);
  assert.notEqual(zh.language, en.language);
  assert.equal(adminDisplay.getGitHubMetadataDetailText("fr").title, en.title);
});

test("slugs are lowercased, ASCII-folded, and joined with single hyphens", () => {
  for (const [value, expected] of [
    ["Hello World", "hello-world"],
    ["  Hello  World  ", "hello-world"],
    ["Hello___World", "hello-world"],
    ["Hello---World", "hello-world"],
    ["Hello_World-Test", "hello-world-test"],
    ["MiXeD CaSe", "mixed-case"],
    ["tab\there", "tab-here"],
    ["-lead-trail-", "lead-trail"],
    ["a!@#$%b", "ab"],
    ["café", "cafe"],
    ["Ünïcödé", "unicode"]
  ]) {
    assert.equal(adminDisplay.normalizeSlugInput(value), expected);
  }
});

test("slugs are capped at 72 characters", () => {
  assert.equal(adminDisplay.normalizeSlugInput("H".repeat(100)), "h".repeat(72));
});

test("slugs with no ASCII content become empty, leaving the server to generate one", () => {
  for (const value of ["中文标题", "___", "!!!", "   "]) {
    assert.equal(adminDisplay.normalizeSlugInput(value), "");
  }
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const adminDisplayStub = `data:text/javascript,${encodeURIComponent(`
  export function createArticleBrowseHref(slug, published) {
    return published ? "/articles/" + slug : "/articles/" + slug + "?preview=1";
  }
  export function getContentItemPreviewImage(item) {
    return item.coverImage || "";
  }
`)}`;
const articleHelpersStub = `data:text/javascript,${encodeURIComponent(`
  export function getArticleDisplayTitle(item) { return item.title || item.summary || "Untitled"; }
`)}`;
const toolHelpersStub = `data:text/javascript,${encodeURIComponent(`
  export function createToolPreviewSource(tool) { return tool.image || ""; }
`)}`;
const adminFieldExamplesStub = `data:text/javascript,${encodeURIComponent(`
  export const ADMIN_RESOURCE_FIELD_EXAMPLES = {
    zh: {
      name: "例如：项目名称",
      description: "例如：用一两句话说明项目的主要功能和用途",
      url: "https://example.com",
      demoUrl: "https://example.com",
      tags: "数据库, 认证, AI",
      image: "留空则根据项目地址自动生成"
    },
    en: {
      name: "Example: Project name",
      description: "Example: Describe the project's main features and purpose in one or two sentences",
      url: "https://example.com",
      demoUrl: "https://example.com",
      tags: "Database, Auth, AI",
      image: "Leave empty to generate from project URL"
    }
  };
`)}`;
const compiledEffectiveTags = await compileTypescriptModule(
  new URL("../../shared/effective-tags.ts", import.meta.url)
);
const effectiveTags = await import(
  `${compiledEffectiveTags.url.href}?effective-tags=1`
);
const compiledTelegram = await compileTypescriptModule(
  new URL("../../src/telegram.ts", import.meta.url),
  {
    importReplacements: {
      "./admin-display": adminDisplayStub,
      "./admin-field-examples": adminFieldExamplesStub,
      "./article-helpers": articleHelpersStub,
      "./tool-helpers": toolHelpersStub,
      "../shared/effective-tags": compiledEffectiveTags.url.href
    }
  }
);
const telegram = await import(`${compiledTelegram.url.href}?telegram=1`);
const compiledMarkdownEditor = await compileTypescriptModule(
  new URL("../../src/markdown-editor.ts", import.meta.url)
);
const markdownEditor = await import(
  `${compiledMarkdownEditor.url.href}?markdown-editor=1`
);
const sharedStub = `data:text/javascript,${encodeURIComponent(`
  export class InvalidRequestError extends Error {}
  export class UpstreamServiceError extends Error {}
  export function createSearchTerms(value) {
    const plain = String(value ?? "");
    return {
      plain,
      likePattern: "%" + plain.replace(/[\\%_]/g, "\\$&") + "%",
      ftsPhrase: '"' + plain.replace(/"/g, '""') + '"',
      useFts: Array.from(plain).length >= 3
    };
  }
  export function getDatabase(env) { return env.DB; }
  export function jsonError(message, code, options = {}) {
    return { message, code, status: options.status };
  }
`)}`;
const compiledTelegramBackend = await compileTypescriptModule(
  new URL("../../functions/_telegram.ts", import.meta.url),
  {
    importReplacements: {
      "./_shared": sharedStub,
      "../shared/effective-tags": compiledEffectiveTags.url.href
    },
    transformSource: (source) =>
      source.replace(
        "const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;",
        "const TELEGRAM_REQUEST_TIMEOUT_MS = 20;"
      ).replace(
        "const TELEGRAM_RETRY_DELAY_MS = 200;",
        "const TELEGRAM_RETRY_DELAY_MS = 1;"
      )
  }
);
const telegramBackend = await import(
  `${compiledTelegramBackend.url.href}?telegram-backend=1`
);

const backendSource = (await readFile(
  new URL("../../functions/_telegram.ts", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const adminSource = (await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const telegramPushSource = (await readFile(
  new URL("../../src/components/AdminTelegramPush.tsx", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const telegramPushButtonSource = (await readFile(
  new URL("../../src/components/AdminTelegramPushButton.tsx", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const adminCardSources = await Promise.all([
  "../../src/components/admin-cards/AdminToolCard.tsx",
  "../../src/components/admin-cards/AdminArticleCard.tsx"
].map(async (path) => (
  await readFile(new URL(path, import.meta.url), "utf8")
).replace(/\r\n?/g, "\n")));
const telegramCardSource = (await readFile(
  new URL("../../src/components/admin-settings/TelegramSettingsCard.tsx", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const markdownEditorComponentSource = await readFile(
  new URL("../../src/components/AdminMarkdownEditor.tsx", import.meta.url),
  "utf8"
);
const resourceFieldsComponentSource = await readFile(
  new URL("../../src/components/AdminResourceFields.tsx", import.meta.url),
  "utf8"
);
const githubMetadataComponentSource = await readFile(
  new URL("../../src/components/AdminGitHubMetadata.tsx", import.meta.url),
  "utf8"
);
const githubMetadataHookSource = await readFile(
  new URL("../../src/useAdminGitHubMetadata.ts", import.meta.url),
  "utf8"
);
const backupSource = (await readFile(
  new URL("../../functions/api/admin/backup.ts", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const adminApiSource = (await readFile(
  new URL("../../src/admin-api.ts", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const clientTelegramSource = (await readFile(
  new URL("../../src/telegram.ts", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const sharedSource = (await readFile(
  new URL("../../functions/_shared.ts", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");
const stylesSource = (await readFile(
  new URL("../../src/styles.css", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");

after(async () => {
  await Promise.all([
    compiledTelegram.cleanup(),
    compiledMarkdownEditor.cleanup(),
    compiledTelegramBackend.cleanup(),
    compiledEffectiveTags.cleanup()
  ]);
});

const tool = {
  id: "tool-1",
  name: "HTools",
  description: "实用工具目录",
  url: "https://github.com/shaoyouvip/htools",
  demoUrl: "https://htools.zrf.me",
  image: "",
  category: "开发工具",
  tags: ["Cloudflare", "开源 工具"],
  featured: false,
  createdAt: "",
  updatedAt: ""
};
const toolResource = telegram.createTelegramToolResource(tool);
const toolWithoutTagsResource = telegram.createTelegramToolResource({
  ...tool,
  id: "tool-no-tags",
  category: "开发工具",
  tags: []
});
const articleResource = telegram.createTelegramArticleResource(
  {
    id: "article-1",
    slug: "htools-guide",
    title: "HTools 部署教程",
    summary: "从部署到使用的完整教程",
    coverImage: "/cover.png",
    category: "教程",
    tags: ["Cloudflare"],
    published: true
  },
  "https://htools.zrf.me"
);
const articleWithoutCoverResource = telegram.createTelegramArticleResource(
  {
    id: "article-2",
    slug: "no-cover",
    title: "无封面文章",
    summary: "没有封面图",
    coverImage: "",
    category: "教程",
    tags: [],
    published: true
  },
  "https://htools.zrf.me"
);
const draftArticleResource = telegram.createTelegramArticleResource(
  {
    id: "article-draft",
    slug: "draft-guide",
    title: "HTools 草稿教程",
    summary: "尚未公开的文章",
    coverImage: "",
    category: "教程",
    tags: [],
    published: false
  },
  "https://htools.zrf.me"
);
const localPublishedArticleResource = telegram.createTelegramArticleResource(
  {
    id: "article-local",
    slug: "local-guide",
    title: "HTools 本地教程",
    summary: "本地预览中的已发布文章",
    coverImage: "",
    category: "教程",
    tags: [],
    published: true
  },
  "http://127.0.0.1:8788"
);
const contentResource = telegram.createTelegramContentResource(
  {
    id: "content-1",
    sourceId: "source-1",
    sourceTitle: "周润发博客",
    sourceUrl: "https://blog.zrf.me/feed.xml",
    external_id: "post-1",
    title: "内容流文章",
    summary: "内容流摘要",
    url: "https://blog.zrf.me/p/post-1/",
    author: "周润发",
    coverImage: "/content-cover.png",
    category: "教程",
    tags: ["Cloudflare"],
    published_at: null,
    articleId: null,
    articleSlug: null,
    articleCategory: null,
    articlePublished: null
  },
  "https://htools.zrf.me"
);
const contentWithoutTagsResource = telegram.createTelegramContentResource(
  {
    id: "content-no-tags",
    sourceId: "source-v2ex",
    sourceTitle: "V2EX - 技术",
    sourceUrl: "https://www.v2ex.com/feed/tab/tech.xml",
    external_id: "post-no-tags",
    title: "没有标签的内容",
    summary: "没有标签的摘要",
    url: "https://www.v2ex.com/t/1",
    author: "",
    coverImage: "",
    category: "资讯",
    tags: [],
    published_at: null,
    articleId: null,
    articleSlug: null,
    articleCategory: null,
    articlePublished: null
  },
  "https://htools.zrf.me"
);

function createTelegramSettingsDatabase(initialSettings = null) {
  let value = initialSettings === null ? null : JSON.stringify(initialSettings);
  const writes = [];

  return {
    DB: {
      prepare(sql) {
        let params = [];
        return {
          bind(...nextParams) {
            params = nextParams;
            return this;
          },
          async first() {
            if (!/SELECT value FROM app_settings/.test(sql)) {
              throw new Error(`Unexpected Telegram settings query: ${sql}`);
            }
            return value === null ? null : { value };
          },
          async run() {
            if (!/INSERT INTO app_settings/.test(sql)) {
              throw new Error(`Unexpected Telegram settings write: ${sql}`);
            }
            value = params[1];
            writes.push(JSON.parse(value));
            return { success: true };
          }
        };
      }
    },
    get value() {
      return value === null ? null : JSON.parse(value);
    },
    writes
  };
}

function createRecoveredTelegramDatabase(resourceExists = true) {
  const target = "-1001234567890";
  const resource = {
    type: "tool",
    id: "recovered-tool",
    title: "Recovered Tool",
    description: "Recovered Telegram image message",
    url: "https://example.com/recovered-tool",
    demoUrl: "",
    image: "",
    category: "Web Framework",
    tags: ["Cloudflare"]
  };
  const record = {
    id: "recovered-record",
    resource_type: "tool",
    resource_id: resource.id,
    custom_title: resource.title,
    resource_data: JSON.stringify(resource),
    category: "__telegram_tool__",
    chat_id: "",
    target_ref: "",
    message_id: "",
    message_markdown: "**Recovered Tool**",
    media_enabled: 1,
    media_url: "https://example.com/recovered-before.png",
    last_pushed_hash: "",
    last_pushed_media_enabled: null,
    sent_at: "",
    updated_at: "2026-08-07T00:00:00.000Z"
  };
  const settings = JSON.stringify({ enabled: true, target, footerMarkdown: "" });
  const writes = [];
  let lock = null;

  return {
    DB: {
      prepare(sql) {
        let params = [];
        return {
          bind(...nextParams) {
            params = nextParams;
            return this;
          },
          async first() {
            if (/SELECT value FROM app_settings/.test(sql)) return { value: settings };
            if (/SELECT 1 AS found FROM tools/.test(sql)) {
              return resourceExists ? { found: 1 } : null;
            }
            if (/SELECT operation, state, expires_at\s+FROM telegram_push_locks/.test(sql)) {
              return lock ? { ...lock } : null;
            }
            if (/SELECT 1 AS found FROM telegram_push_locks/.test(sql)) {
              return lock?.operation === "send" && (lock.state === "uncertain" || lock.expires_at <= params[2])
                ? { found: 1 }
                : null;
            }
            if (/SELECT \* FROM telegram_messages WHERE id = \?/.test(sql)) {
              return params[0] === record.id ? structuredClone(record) : null;
            }
            if (/SELECT \* FROM telegram_messages/.test(sql)) {
              if (params[0] !== record.resource_type || params[1] !== record.resource_id) {
                return null;
              }
              if (/AND chat_id = \?/.test(sql) && params[2] !== record.chat_id) return null;
              if (/message_id <> ''/.test(sql) && !record.message_id) return null;
              return structuredClone(record);
            }
            throw new Error(`Unexpected recovered Telegram query: ${sql}`);
          },
          async run() {
            if (/INSERT INTO telegram_push_locks/.test(sql)) {
              const expired = lock && lock.expires_at <= params[6];
              const takesOverUncertain = ((params[7] === 1 || params[2] === "delete") && (lock?.state === "uncertain" || expired)) ||
                (params[2] === "update" && lock?.operation === "update" && lock.state === "uncertain");
              if (lock && !(expired && lock.operation !== "send") && !takesOverUncertain) {
                return { success: true, meta: { changes: 0 } };
              }
              lock = {
                resource_type: params[0],
                resource_id: params[1],
                operation: params[2],
                lock_token: params[3],
                state: "active",
                expires_at: params[4]
              };
              return { success: true, meta: { changes: 1 } };
            }
            if (/DELETE FROM telegram_push_locks/.test(sql)) {
              if (!lock || lock.lock_token !== params[2]) {
                return { success: true, meta: { changes: 0 } };
              }
              lock = null;
              return { success: true, meta: { changes: 1 } };
            }
            if (/UPDATE telegram_push_locks\s+SET state/.test(sql)) {
              if (lock?.lock_token === params[4]) {
                lock.state = "uncertain";
                lock.expires_at = params[0];
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 0 } };
            }
            if (/UPDATE telegram_push_locks SET operation = 'send'/.test(sql)) {
              if (lock?.lock_token !== params[3]) return { meta: { changes: 0 } };
              lock.operation = "send";
              lock.expires_at = params[0];
              return { meta: { changes: 1 } };
            }
            if (/SET custom_title = \?, resource_data = \?, category = \?, chat_id = \?/.test(sql)) {
              Object.assign(record, {
                custom_title: params[0],
                resource_data: params[1],
                category: params[2],
                chat_id: params[3],
                target_ref: params[4],
                message_id: params[5],
                message_markdown: params[6],
                media_enabled: params[7],
                media_url: params[8],
                last_pushed_hash: params[9],
                last_pushed_media_enabled: params[12],
                ...(sql.includes("sent_at = ?")
                  ? { sent_at: params[10], updated_at: params[11] }
                  : { updated_at: params[11] })
              });
            } else if (/SET custom_title = \?, resource_data = \?, category = \?, target_ref = \?/.test(sql)) {
              Object.assign(record, {
                custom_title: params[0],
                resource_data: params[1],
                category: params[2],
                target_ref: params[3],
                message_markdown: params[4],
                media_enabled: params[5],
                media_url: params[6],
                last_pushed_hash: params[7],
                updated_at: params[8]
              });
            } else {
              throw new Error(`Unexpected recovered Telegram write: ${sql}`);
            }
            writes.push({ sql, params: [...params] });
            return { success: true, meta: { changes: 1 } };
          }
        };
      }
    },
    record,
    resource,
    get lock() {
      return lock ? structuredClone(lock) : null;
    },
    setLock(nextLock) {
      lock = nextLock ? structuredClone(nextLock) : null;
    },
    target,
    writes
  };
}

test("Telegram preview matches the configured body, links, hashtags, and footer", () => {
  assert.equal(
    telegram.createDefaultTelegramBody(toolResource),
    "**HTools**\n\n> 实用工具目录"
  );
  const preview = telegram.buildTelegramPreviewMarkdown(
    toolResource,
    "**HTools** 工具导航",
    "[频道](https://t.me/lsmkc) ｜ [聊天](https://t.me/lsmoo)",
    "zh"
  );

  assert.equal(
    preview,
    "**HTools** 工具导航\n\n项目地址：[https://github.com/shaoyouvip/htools](https://github.com/shaoyouvip/htools)\n\n演示地址：[https://htools.zrf.me](https://htools.zrf.me)\n\n#Cloudflare #开源_工具\n\n[频道](https://t.me/lsmkc) ｜ [聊天](https://t.me/lsmoo)"
  );
  assert.equal(telegram.countTelegramMessageCharacters("工具😀"), 3);
  assert.equal(
    telegram.escapeTelegramPreviewHashtags("正文\n\n#Cloudflare #SSH\n\n项目地址"),
    "正文\n\n\\#Cloudflare #SSH\n\n项目地址"
  );
  assert.equal(
    telegram.escapeTelegramPreviewHashtags("## 标题\n\n> 引用\n\n#Cloudflare"),
    "## 标题\n\n> 引用\n\n\\#Cloudflare"
  );
});

test("tools, articles, and content flow share one Telegram resource and preview contract", () => {
  assert.deepEqual(
    effectiveTags.getEffectiveTags(["Cloudflare", " Cloudflare "], "开发工具"),
    ["Cloudflare"]
  );
  assert.deepEqual(effectiveTags.getEffectiveTags([], "资讯"), ["资讯"]);
  assert.deepEqual(effectiveTags.getEffectiveTags([], "__telegram_content__"), []);
  assert.equal(toolResource.type, "tool");
  assert.equal(articleResource.type, "article");
  assert.equal(contentResource.type, "content");
  assert.deepEqual(toolResource.tags, ["Cloudflare", "开源 工具"]);
  assert.deepEqual(toolWithoutTagsResource.tags, ["开发工具"]);
  assert.deepEqual(articleResource.tags, ["Cloudflare"]);
  assert.deepEqual(articleWithoutCoverResource.tags, ["教程"]);
  assert.deepEqual(contentResource.tags, ["Cloudflare"]);
  assert.deepEqual(contentWithoutTagsResource.tags, ["资讯"]);
  assert.doesNotMatch(contentWithoutTagsResource.tags.join(" "), /V2EX/);
  assert.equal(contentResource.url, "");
  assert.equal(contentResource.demoUrl, "https://blog.zrf.me/p/post-1/");
  assert.equal(contentResource.image, "https://htools.zrf.me/content-cover.png");
  assert.equal(articleResource.image, "https://htools.zrf.me/cover.png");
  assert.equal(draftArticleResource.url, "");
  assert.equal(
    localPublishedArticleResource.url,
    "http://127.0.0.1:8788/articles/local-guide"
  );
  assert.equal(
    telegram.createDefaultTelegramBody(articleResource),
    "**HTools 部署教程**\n\n> 从部署到使用的完整教程"
  );
  assert.equal(
    telegram.buildTelegramPreviewMarkdown(articleResource, "**HTools 部署教程**", "", "zh"),
    "**HTools 部署教程**\n\n文章地址：[https://htools.zrf.me/articles/htools-guide](https://htools.zrf.me/articles/htools-guide)\n\n#Cloudflare"
  );
  assert.doesNotMatch(
    telegram.buildTelegramPreviewMarkdown(
      draftArticleResource,
      "**HTools 草稿教程**",
      "",
      "zh"
    ),
    /文章地址/
  );
  assert.doesNotMatch(
    telegramBackend.buildTelegramMessageMarkdown(
      draftArticleResource,
      "**HTools 草稿教程**",
      "",
      "zh"
    ),
    /文章地址/
  );
  assert.equal(
    telegram.buildTelegramPreviewMarkdown(contentResource, "**内容流文章**", "", "zh"),
    "**内容流文章**\n\n原文地址：[https://blog.zrf.me/p/post-1/](https://blog.zrf.me/p/post-1/)\n\n#Cloudflare"
  );
  const contentWithLocalPreview = {
    ...contentResource,
    url: "http://127.0.0.1:8788/articles/content-preview?contentItem=content-1"
  };
  assert.doesNotMatch(
    telegram.buildTelegramPreviewMarkdown(contentWithLocalPreview, "**内容流文章**", "", "zh"),
    /本站浏览|127\.0\.0\.1|content-preview/
  );
  assert.doesNotMatch(
    telegramBackend.buildTelegramMessageMarkdown(
      contentWithLocalPreview,
      "**内容流文章**",
      "",
      "zh"
    ),
    /本站浏览|127\.0\.0\.1|content-preview/
  );
  assert.doesNotMatch(backendSource, /linked_article_slug|linked_article_published|content-preview\?contentItem/);
  assert.match(sharedSource, /'type', 'content'[\s\S]*?'url', ''/);
});

test("Telegram edits, previews, saves, and pushes one complete Markdown message", () => {
  const footer = "[频道](https://t.me/lsmkc)";
  const body = telegram.createDefaultTelegramBody(toolResource);
  const completeMessage = telegram.buildTelegramPreviewMarkdown(
    toolResource,
    body,
    footer,
    "zh"
  );

  assert.equal((completeMessage.match(/项目地址：/g) ?? []).length, 1);
  assert.equal((completeMessage.match(/#Cloudflare/g) ?? []).length, 1);
  assert.equal((completeMessage.match(/\[频道]/g) ?? []).length, 1);
  const legacyMessage = [
    body,
    "项目地址：https://github.com/shaoyouvip/htools",
    "演示地址：https://htools.zrf.me",
    "#Cloudflare #开源_工具",
    footer
  ].join("\n\n");
  assert.equal(
    telegramBackend.normalizeTelegramEditableMessageMarkdown(legacyMessage),
    completeMessage
  );
  assert.match(adminSource, /const telegramPreviewMarkdown = telegramResource[\s\S]*?telegramBodyMarkdown/);
  assert.match(adminSource, /content=\{telegramQuickMessage\.bodyMarkdown\}/);
  assert.match(adminSource, /content=\{viewingTelegramPush\.messageMarkdown\}/);
  assert.match(adminSource, /rows=\{isCreatingTelegramPush \? 11 : 12\}/);
  assert.doesNotMatch(backendSource, /previewMarkdown|getTelegramEditableBodyMarkdown/);
});

test("quick push opens only after the push state is loaded", () => {
  assert.match(adminSource, /function createOptimisticTelegramMessage\(/);
  assert.match(
    adminSource,
    /setTelegramQuickMessage\(\s*createOptimisticTelegramMessage\(/
  );
  assert.match(adminSource, /telegramQuickResource && !telegramQuickLoading/);
  assert.match(adminSource, /if \(telegramQuickLoading\) return/);
  assert.match(adminSource, /acquireWriteAction\(actionKey\)/);
  assert.match(adminSource, /releaseWriteAction\(actionKey\)/);
  assert.match(
    adminSource,
    /disabled=\{telegramQuickLoading \|\| telegramQuickSaving\}/
  );
  assert.match(
    adminSource,
    /descriptionId="telegram-quick-push-description"[\s\S]*?panelClassName="tool-editor-dialog admin-tool-editor-dialog"/
  );
});

test("Telegram remains manual and tools, articles, and content flow use the same editor", () => {
  assert.match(adminSource, /telegramSettings\.enabled/);
  assert.match(adminSource, /openTelegramMessageDialog/);
  assert.match(adminSource, /sendTelegramMessage/);
  assert.match(adminSource, /updateTelegramMessage/);
  assert.match(adminSource, /createTelegramToolResource\(tool\)/);
  assert.match(adminSource, /createTelegramArticleResource\(article, window\.location\.origin\)/);
  assert.match(adminSource, /createTelegramContentResource\(item, window\.location\.origin\)/);
  assert.match(telegramPushButtonSource, /export function AdminTelegramPushButton\(/);
  assert.equal(
    [adminSource, ...adminCardSources].reduce(
      (total, source) => total + (source.match(/<AdminTelegramPushButton/g) ?? []).length,
      0
    ),
    3
  );
  assert.doesNotMatch(adminSource, /telegramText\.copyLink|copyToolLink|navigator\.clipboard/);
  assert.doesNotMatch(adminSource, /createTool\([\s\S]{0,500}sendTelegramMessage/);
  assert.doesNotMatch(adminSource, /updateArticle\([\s\S]{0,500}sendTelegramMessage/);
});

test("Telegram push cards keep the local preview action separate from resource URLs", () => {
  assert.match(
    telegramPushSource,
    /className="admin-tool-link-row" title=\{text\.viewAction\}[\s\S]*?onClick=\{onView\}/
  );
  for (const source of [adminSource, telegramPushSource]) {
    assert.doesNotMatch(source, /title=\{browseHref \|\| text\.viewAction\}/);
    assert.doesNotMatch(source, /const browseHref = record\.resource\?\.url/);
    assert.doesNotMatch(source, /onMouseUp=\{\(event\) => event\.currentTarget\.blur\(\)\}/);
  }
  assert.match(telegramPushSource, /telegram-push-view-link/);
  assert.match(adminSource, /usePointerFocusRelease\(\)/);
});

test("Telegram token stays server-only while the target is managed in admin settings", () => {
  assert.match(backendSource, /env\.TGTOKEN/);
  assert.match(backendSource, /env\.TGID/);
  assert.doesNotMatch(adminSource, /TGTOKEN\s*:/);
  assert.doesNotMatch(adminSource, /TGID\s*:/);
  assert.doesNotMatch(telegramCardSource, /TGTOKEN\s*:/);
  assert.doesNotMatch(telegramCardSource, /TGID\s*:/);
  assert.match(telegramCardSource, /telegramTargetPlaceholder/);
  assert.match(backendSource, /const settings = \{ enabled, target, footerMarkdown \}/);
  assert.match(backupSource, /"telegram_settings"/);
  assert.match(backupSource, /telegramMessages/);
  assert.match(backupSource, /telegramMessages: data\.telegramMessages\.length/);
  assert.doesNotMatch(backupSource, /TGTOKEN|TGID/);
  const footerFieldStart = telegramCardSource.indexOf(
    'className="source-url-field telegram-footer-field"'
  );
  const footerFieldEnd = telegramCardSource.indexOf("</label>", footerFieldStart);
  const footerFieldSource = telegramCardSource.slice(footerFieldStart, footerFieldEnd);
  assert.match(footerFieldSource, /<input/);
  assert.doesNotMatch(footerFieldSource, /<textarea/);
});

test("Telegram is disabled by default and needs a server token plus saved target", () => {
  assert.match(backendSource, /available: hasTelegramConfiguration\(env, target\)/);
  assert.match(backendSource, /if \(enabled && !hasTelegramConfiguration\(env, target\)\)/);
  assert.match(backendSource, /Boolean\(getTelegramToken\(env\) && target\)/);
  assert.match(backendSource, /Object\.prototype\.hasOwnProperty\.call\(parsed, "target"\)/);
  assert.match(backendSource, /getTelegramEnvironmentTarget\(env\)/);
});

test("Telegram settings migrate the legacy target without exposing or persisting the token", async () => {
  const database = createTelegramSettingsDatabase();
  const env = {
    ...database,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE",
    TGID: "-1001234567890"
  };

  assert.deepEqual(await telegramBackend.getTelegramSettings(env), {
    available: true,
    enabled: false,
    target: "-1001234567890",
    footerMarkdown: ""
  });

  const saved = await telegramBackend.saveTelegramSettings(env, {
    enabled: true,
    target: "-1009876543210",
    footerMarkdown: "[频道](https://t.me/example)"
  });

  assert.deepEqual(database.value, {
    enabled: true,
    target: "-1009876543210",
    footerMarkdown: "[频道](https://t.me/example)"
  });
  assert.deepEqual(saved, {
    available: true,
    enabled: true,
    target: "-1009876543210",
    footerMarkdown: "[频道](https://t.me/example)"
  });
  assert.equal(JSON.stringify(database.writes).includes(env.TGTOKEN), false);
});

test("Telegram settings allow clearing the admin target without falling back to legacy TGID", async () => {
  const database = createTelegramSettingsDatabase({
    enabled: false,
    target: "-1001234567890",
    footerMarkdown: ""
  });
  const env = {
    ...database,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE",
    TGID: "-1005555555555"
  };

  const cleared = await telegramBackend.saveTelegramSettings(env, {
    enabled: false,
    target: "",
    footerMarkdown: ""
  });

  assert.deepEqual(cleared, {
    available: false,
    enabled: false,
    target: "",
    footerMarkdown: ""
  });
  await assert.rejects(
    telegramBackend.saveTelegramSettings(env, {
      enabled: true,
      target: "",
      footerMarkdown: ""
    }),
    /Telegram configuration is incomplete/
  );
});

test("Telegram settings reject invalid admin targets and ignore invalid legacy TGID", async () => {
  const database = createTelegramSettingsDatabase();
  const env = {
    ...database,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE",
    TGID: "not-a-chat"
  };

  assert.deepEqual(await telegramBackend.getTelegramSettings(env), {
    available: false,
    enabled: false,
    target: "",
    footerMarkdown: ""
  });
  await assert.rejects(
    telegramBackend.saveTelegramSettings(env, {
      enabled: false,
      target: "not-a-chat",
      footerMarkdown: ""
    }),
    /Telegram target is invalid/
  );
});

test("opening a Telegram editor reads local state without resolving the Telegram connection", () => {
  const stateStart = backendSource.indexOf("export async function getTelegramMessageState");
  const stateEnd = backendSource.indexOf("export async function sendTelegramMessage", stateStart);
  const stateSource = backendSource.slice(stateStart, stateEnd);
  assert.doesNotMatch(stateSource, /resolveTelegramConnection\(env\)/);
  assert.match(stateSource, /ORDER BY updated_at DESC, id DESC/);
});

test("stored push snapshots remain readable after the linked source is deleted", async () => {
  const database = createRecoveredTelegramDatabase(false);
  const state = await telegramBackend.getTelegramMessageState(
    {
      DB: database.DB,
      TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE"
    },
    "tool",
    database.resource.id,
    "https://htools.example.com",
    "en"
  );

  assert.equal(state.resourceExists, false);
  assert.equal(state.resource?.title, database.resource.title);
  assert.equal(state.resource?.description, database.resource.description);
  assert.equal(state.resource?.url, database.resource.url);
});

test("only connection testing performs full Telegram permission checks", () => {
  const sendStart = backendSource.indexOf("export async function sendTelegramMessage");
  const updateEnd = backendSource.indexOf("export function buildTelegramMessageMarkdown", sendStart);
  const pushSource = backendSource.slice(sendStart, updateEnd);
  assert.match(backendSource, /const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000/);
  assert.doesNotMatch(pushSource, /resolveTelegramConnection\(env\)/);
  assert.match(backendSource, /testTelegramConnection\(env: Env, requestedTarget\?: unknown\)[\s\S]*?normalizeTelegramTarget\(requestedTarget\)[\s\S]*?resolveTelegramConnection\(env, target, controller\.signal\)/);
  assert.match(backendSource, /telegramRequest<TelegramUser>\(env, "getMe", \{\}, \{ signal \}\)/);
  assert.match(backendSource, /telegramRequest<TelegramChat>\(env, "getChat", \{[\s\S]*?\}, \{ signal \}\)/);
  assert.match(backendSource, /telegramRequest<TelegramChatMember>\(env, "getChatMember", \{[\s\S]*?\}, \{ signal \}\)/);
  assert.match(pushSource, /sendTelegramRemoteMessage/);
  assert.match(pushSource, /editTelegramRemoteMessage/);
  assert.match(backendSource, /telegramRequest<TelegramMessage>\(env, "sendMessage"/);
  assert.match(backendSource, /telegramRequest<TelegramMessage>\(env, "sendPhoto"/);
  assert.match(backendSource, /telegramRequest<TelegramMessage>\(env, "editMessageText"/);
  assert.match(backendSource, /"editMessageMedia"/);
  assert.doesNotMatch(pushSource, /controller\.signal/);
});

test("Telegram connection testing uses one timeout budget and returns a dedicated 504 error", async () => {
  const database = createTelegramSettingsDatabase({
    enabled: false,
    target: "-1001234567890",
    footerMarkdown: ""
  });
  const env = {
    ...database,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE"
  };
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = async (_url, options = {}) => {
    requestCount += 1;
    return await new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        },
        { once: true }
      );
    });
  };

  try {
    let timeoutError;
    await assert.rejects(
      telegramBackend.testTelegramConnection(env),
      (error) => {
        timeoutError = error;
        return error.message === "Telegram connection test timed out.";
      }
    );
    assert.equal(requestCount, 1);
    assert.deepEqual(
      telegramBackend.writeTelegramErrorResponse(timeoutError, "fallback"),
      {
        message: "Telegram connection test timed out.",
        code: "TELEGRAM_TEST_TIMEOUT",
        status: 504
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram connection testing retries one transient read failure", async () => {
  const database = createTelegramSettingsDatabase({
    enabled: false,
    target: "6946912345",
    footerMarkdown: ""
  });
  const env = {
    ...database,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE"
  };
  const originalFetch = globalThis.fetch;
  const methods = [];

  globalThis.fetch = async (url) => {
    const method = String(url).split("/").pop();
    methods.push(method);
    if (methods.length === 1) throw new Error("temporary network failure");
    return new Response(
      JSON.stringify({
        ok: true,
        result: method === "getMe"
          ? { id: 123, first_name: "HTools", username: "H_Tools_bot" }
          : { id: 6946912345, type: "private", first_name: "Private target" }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const connection = await telegramBackend.testTelegramConnection(env);
    assert.deepEqual(methods, ["getMe", "getMe", "getChat"]);
    assert.equal(connection.botUsername, "H_Tools_bot");
    assert.equal(connection.chatId, "6946912345");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram connection retries clear stale details without changing saved settings", () => {
  const cardSource = telegramCardSource;

  assert.match(
    cardSource,
    /async function testConnection\(\) \{[\s\S]*?const testedTarget = target\.trim\(\);[\s\S]*?testTelegramSettings\(testedTarget, token\)[\s\S]*?testedTarget !== settings\.target/
  );
  assert.match(
    cardSource,
    /onChange=\{\(event\) => \{\s*testRequestIdRef\.current \+= 1;\s*setTarget\(event\.target\.value\);\s*setConnection\(null\);\s*setTesting\(false\);\s*setStatus\(""\);\s*\}\}/
  );
  assert.doesNotMatch(
    cardSource.slice(
      cardSource.indexOf("async function testConnection"),
      cardSource.indexOf("if (loading)")
    ),
    /saveTelegramSettings|onSettingsChange/
  );
  assert.match(cardSource, /disabled=\{saving \|\| testing \|\| !target\.trim\(\)\}/);
  assert.match(cardSource, /testTelegramSettings\(testedTarget, token\)/);
});

test("Telegram switch preserves unsaved drafts while allowing the saved service to close", () => {
  const cardSource = telegramCardSource;

  assert.match(cardSource, /const preserveDraftRef = useRef<\{ target: string; footerMarkdown: string \} \| null>\(null\)/);
  assert.match(cardSource, /if \(enabled && dirty\) \{\s*setStatus\(maintenanceText\.telegramSaveBeforeEnable\);\s*return;/);
  assert.match(cardSource, /if \(!enabled && dirty\) \{[\s\S]*?preserveDraftRef\.current = \{ target, footerMarkdown \};[\s\S]*?enabled: false,[\s\S]*?target: settings\.target,[\s\S]*?footerMarkdown: settings\.footerMarkdown/);
  assert.match(cardSource, /setTarget\(preservedDraft\?\.target \?\? settings\.target\)/);
  assert.match(cardSource, /setFooterMarkdown\(preservedDraft\?\.footerMarkdown \?\? settings\.footerMarkdown\)/);
});

test("Telegram connection tests a temporary target without saving it", async () => {
  const database = createTelegramSettingsDatabase({
    enabled: true,
    target: "-1001234567890",
    footerMarkdown: ""
  });
  const env = {
    ...database,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE"
  };
  const originalFetch = globalThis.fetch;
  const requestedChatIds = [];

  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(options.body || "{}");
    if (payload.chat_id !== undefined) requestedChatIds.push(String(payload.chat_id));
    const result = method === "getMe"
      ? { id: 123, first_name: "Test Bot", username: "test_bot" }
      : method === "getChat"
        ? { id: -1009999999999, title: "Temporary Channel", type: "channel" }
        : { status: "administrator", can_post_messages: true };
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const before = structuredClone(database.value);
    const connection = await telegramBackend.testTelegramConnection(env, "@temporary_channel");
    assert.equal(connection.chatTitle, "Temporary Channel");
    assert.deepEqual(requestedChatIds, ["@temporary_channel", "-1009999999999"]);
    assert.deepEqual(database.value, before);
    assert.equal(database.writes.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram maps deleted messages, target changes, and permission failures to distinct error codes", () => {
  const missing = telegramBackend.writeTelegramErrorResponse(
    new Error("Telegram API: Bad Request: message to edit not found"),
    "fallback"
  );
  const denied = telegramBackend.writeTelegramErrorResponse(
    new Error("Telegram API: Forbidden: bot was kicked from the supergroup chat"),
    "fallback"
  );
  const unavailable = telegramBackend.writeTelegramErrorResponse(
    new Error("Telegram API: Bad Request: chat not found"),
    "fallback"
  );
  const targetChanged = telegramBackend.writeTelegramErrorResponse(
    new Error("Telegram target has changed."),
    "fallback"
  );

  assert.deepEqual(missing, {
    message: "Telegram API: Bad Request: message to edit not found",
    code: "TELEGRAM_MESSAGE_NOT_FOUND",
    status: 404
  });
  assert.deepEqual(denied, {
    message: "Telegram API: Forbidden: bot was kicked from the supergroup chat",
    code: "TELEGRAM_TARGET_UNAVAILABLE",
    status: 400
  });
  assert.deepEqual(unavailable, {
    message: "Telegram API: Bad Request: chat not found",
    code: "TELEGRAM_TARGET_UNAVAILABLE",
    status: 400
  });
  assert.deepEqual(targetChanged, {
    message: "Telegram target has changed.",
    code: "TELEGRAM_TARGET_CHANGED",
    status: 409
  });
});

test("an unreachable push resets its record instead of silently re-sending", () => {
  const updateStart = backendSource.indexOf(
    "async function updateTelegramMessageUnlocked"
  );
  const updateEnd = backendSource.indexOf("export async function deleteTelegramPush", updateStart);
  const updateSource = backendSource.slice(updateStart, updateEnd);

  // A moved target cannot be edited in place, and a deleted message may have been
  // removed on purpose, so both paths only mark the record and let the admin decide.
  assert.match(
    updateSource,
    /const targetChanged = hasTelegramTargetChanged\(existing, targetRef\)/
  );
  assert.match(updateSource, /if \(targetChanged\) \{[\s\S]{0,400}remoteMessageMissing = "target-changed"/);
  assert.match(updateSource, /isTelegramMessageMissingError\(message\)\) \{[\s\S]{0,400}remoteMessageMissing = "deleted"/);
  assert.doesNotMatch(updateSource, /remoteMessageMissing[\s\S]{0,200}sendTelegramRemoteMessage/);
  assert.doesNotMatch(updateSource, /throw new InvalidRequestError\("Telegram target has changed\."\)/);
  assert.doesNotMatch(updateSource, /throw new InvalidRequestError\("Telegram message no longer exists\."\)/);

  // The record forgets its remote identity so the next push starts clean.
  assert.match(updateSource, /const nextChatId = remoteMessageMissing\s*\?\s*""/);
  assert.match(updateSource, /const nextMessageId = remoteMessageMissing\s*\?\s*""/);
  assert.match(updateSource, /sent_at = CASE WHEN \? = 1 THEN '' ELSE sent_at END/);
  assert.match(updateSource, /remoteMessageMissing \? "" : targetRef/);
  assert.match(updateSource, /remoteMessageMissing \? "" : pushedHash/);
  assert.match(
    updateSource,
    /return remoteMessageMissing \? \{ \.\.\.state, remoteMessageMissing \} : state/
  );
});

test("the editor confirms before pushing a replacement message", () => {
  // Saving keeps the editor open; the shared confirmation dialog decides what happens next.
  assert.match(
    adminSource,
    /if \(message\.remoteMessageMissing\) \{[\s\S]{0,600}setPendingTelegramResend\(message\.remoteMessageMissing\)[\s\S]{0,120}return;/
  );
  assert.match(
    adminSource,
    /\{pendingTelegramResend \? \([\s\S]{0,900}<AdminConfirmDialog/
  );
  // Cancelling sends nothing and reports that the content is not in the target chat.
  assert.match(
    adminSource,
    /onCancel=\{\(\) => \{[\s\S]{0,160}setPendingTelegramResend\(null\);[\s\S]{0,160}telegramText\.resendSkipped/
  );
  // Confirming reuses the normal submit path, which now takes the send branch.
  assert.match(
    adminSource,
    /onConfirm=\{\(\) => \{[\s\S]{0,160}setPendingTelegramResend\(null\);[\s\S]{0,120}void submitTelegramMessage\(\)/
  );
  assert.match(adminSource, /setPendingTelegramResend\(null\)/);
});

test("the retired two-step recovery flow is gone from every layer", () => {
  for (const source of [backendSource, adminSource, adminApiSource]) {
    assert.doesNotMatch(source, /recoverTelegramMessage|recoverTelegramPush/);
  }
  assert.doesNotMatch(backendSource, /TelegramPushOperation = [^;]*"recover"/);
  assert.doesNotMatch(clientTelegramSource, /recoverMessage|messageNotFound|permissionDenied|resentAfterMissing/);
  assert.match(clientTelegramSource, /resendAction: "重新推送"/);
  assert.match(clientTelegramSource, /resendSkipped: "当前内容未推送到当前目标。"/);
});

test("Telegram updates stay bound to the target used for the original push", () => {
  const row = {
    chat_id: "-1001234567890",
    target_ref: "-1001234567890",
    message_id: "42"
  };

  assert.equal(
    telegramBackend.hasTelegramTargetChanged(row, "-1001234567890"),
    false
  );
  assert.equal(
    telegramBackend.hasTelegramTargetChanged(row, "-1009876543210"),
    true
  );
  assert.equal(
    telegramBackend.hasTelegramTargetChanged({ ...row, message_id: "" }, "-1009876543210"),
    false
  );
  assert.match(backendSource, /SET custom_title = \?, resource_data = \?, category = \?, chat_id = \?, target_ref = \?, message_id = \?, message_markdown = \?/);
  assert.match(backupSource, /resource_data, category,\s*chat_id,\s*target_ref,\s*message_id/);
});

test("Telegram dialog uses a stable title and concise push actions", () => {
  const zh = telegram.getTelegramText("zh");
  const en = telegram.getTelegramText("en");

  assert.equal(zh.title, "Telegram 推送");
  assert.equal(zh.send, "消息推送");
  assert.equal(zh.update, "更新推送");
  assert.equal(en.title, "Telegram Push");
  assert.match(adminSource, /title=\{telegramText\.title\}/);
  assert.doesNotMatch(adminSource, /sendTitle|updateTitle/);
});

test("Telegram fields use generic writing examples and custom pushes start with editable Markdown", () => {
  const zh = telegram.getTelegramText("zh");

  assert.equal("filterAll" in zh.management, false);
  assert.equal("projectUrlPlaceholder" in zh, false);
  assert.equal("mediaLabel" in zh, false);
  assert.match(zh.articleUrlPlaceholder, /example\.com/);
  assert.match(zh.mediaUrlPlaceholder, /example\.com/);

  const customBody = telegram.createTelegramCustomBodyExample("zh");
  assert.match(customBody, /^\*\*在这里写推送标题\*\*/);
  assert.match(customBody, /项目地址：\[https:\/\/example\.com\]\(https:\/\/example\.com\)/);
  assert.match(customBody, /演示地址：\[https:\/\/example\.com\]\(https:\/\/example\.com\)/);
  assert.match(customBody, /#数据库 #认证 #AI/);

  const createStart = adminSource.indexOf("function openCreateTelegramPush()");
  const createEnd = adminSource.indexOf("async function openTelegramQuickPush", createStart);
  const createSource = adminSource.slice(createStart, createEnd);
  assert.match(createSource, /createTelegramCustomBodyExample\(locale\)/);
  assert.match(createSource, /setTelegramCustomTitle\(""\)/);

  for (const placeholder of ["mediaUrlPlaceholder", "bodyPlaceholder"]) {
    assert.match(adminSource, new RegExp(`placeholder=\\{telegramText\\.${placeholder}\\}`));
  }
  assert.match(
    adminSource,
    /placeholder=\{ADMIN_RESOURCE_FIELD_EXAMPLES\[locale\]\.adminName\}/
  );
  assert.match(
    adminSource,
    /placeholder=\{ADMIN_RESOURCE_FIELD_EXAMPLES\[locale\]\.adminDescription\}/
  );
  assert.match(adminSource, /const telegramContentOriginalUrlField[\s\S]*telegramText\.contentOriginalUrlPlaceholder/);
  assert.match(adminSource, /telegramResource\.type === "article"[\s\S]*telegramText\.articleUrlPlaceholder/);
  assert.doesNotMatch(adminSource, /telegramText\.contentUrl(?:Label|Placeholder)/);
  assert.match(adminSource, /\{telegramContentOriginalUrlField\}/);
  assert.match(
    adminSource,
    /placeholder=\{ADMIN_RESOURCE_FIELD_EXAMPLES\[locale\]\.adminTags\}/
  );
  assert.match(adminSource, /placeholder=\{t\.form\.imagePlaceholder\}/);
});

test("Telegram structured fields and Markdown stay synchronized in both directions", () => {
  const footer = "[频道](https://t.me/example)";
  const initial = `${telegram.createTelegramCustomBodyExample("zh")}\n\n${footer}`;
  const withTitle = telegram.syncTelegramBodyField(
    initial,
    { title: "测试项目" },
    footer,
    "zh"
  );
  const withDescription = telegram.syncTelegramBodyField(
    withTitle,
    { description: "新的项目简介" },
    footer,
    "zh"
  );
  const withProject = telegram.syncTelegramBodyField(
    `${withDescription.replace("项目地址：", "补充说明保持不变。\n\n项目地址：")}`,
    { url: "https://project.example.com", resourceType: "custom" },
    footer,
    "zh"
  );
  const withDemo = telegram.syncTelegramBodyField(
    withProject,
    { demoUrl: "https://demo.example.com" },
    footer,
    "zh"
  );
  const synchronized = telegram.syncTelegramBodyField(
    withDemo,
    { tags: ["开源", "工具"] },
    footer,
    "zh"
  );

  assert.match(synchronized, /^\*\*测试项目\*\*/);
  assert.match(synchronized, /> 新的项目简介/);
  assert.match(synchronized, /补充说明保持不变。/);
  assert.match(
    synchronized,
    /项目地址：\[https:\/\/project\.example\.com\]\(https:\/\/project\.example\.com\)/
  );
  assert.match(
    synchronized,
    /演示地址：\[https:\/\/demo\.example\.com\]\(https:\/\/demo\.example\.com\)/
  );
  assert.match(synchronized, /#开源 #工具/);
  assert.ok(synchronized.endsWith(footer));
  assert.doesNotMatch(synchronized, /核心功能|使用场景|其他特点/);

  assert.deepEqual(
    telegram.readTelegramBodyFields(synchronized, footer, "zh"),
    {
      title: "测试项目",
      description: "新的项目简介",
      url: "https://project.example.com",
      demoUrl: "https://demo.example.com",
      tags: ["开源", "工具"]
    }
  );
  assert.deepEqual(
    telegram.readTelegramBodyFields(initial, footer, "zh", true),
    { title: "", description: "", url: "", demoUrl: "", tags: [] }
  );
  const contentWithoutSiteView = telegram.syncTelegramBodyField(
    "**内容流文章**\n\n本站浏览：[http://127.0.0.1:8788/articles/content-preview](http://127.0.0.1:8788/articles/content-preview)\n\n原文地址：[https://example.com/post](https://example.com/post)",
    { url: "http://127.0.0.1:8788/articles/content-preview", resourceType: "content" },
    "",
    "zh"
  );
  assert.doesNotMatch(contentWithoutSiteView, /本站浏览|127\.0\.0\.1|content-preview/);
  assert.match(contentWithoutSiteView, /原文地址/);
  assert.match(
    adminSource,
    /onChange=\{\(value\) => \{[\s\S]*?readTelegramBodyFields\([\s\S]*?setTelegramTagText\(formatTagInputText\(fields\.tags\)\)/
  );
});

test("tool, article, and Telegram editors reuse shared text, URL, and tag fields", () => {
  assert.match(resourceFieldsComponentSource, /export function AdminTextField/);
  assert.match(resourceFieldsComponentSource, /export function AdminTextareaField/);
  assert.match(resourceFieldsComponentSource, /export function AdminUrlField/);
  assert.match(resourceFieldsComponentSource, /normalizeHttpUrlInput/);
  assert.match(resourceFieldsComponentSource, /export function AdminTagsField/);
  assert.match(resourceFieldsComponentSource, /normalizeTagInputText/);
  assert.equal((adminSource.match(/<AdminUrlField\b/g) ?? []).length, 8);
  assert.equal((adminSource.match(/<AdminTagsField\b/g) ?? []).length, 3);
  assert.equal((adminSource.match(/<AdminTextField\b/g) ?? []).length, 4);
  assert.equal((adminSource.match(/<AdminTextareaField\b/g) ?? []).length, 3);
  assert.match(adminSource, /<AdminUrlField[\s\S]*?id="admin-tool-url"/);
  assert.match(adminSource, /<AdminTagsField[\s\S]*?label=\{articleText\.tagsLabel\}/);
  assert.match(adminSource, /<AdminUrlField[\s\S]*?id="telegram-media-url"/);
  assert.match(resourceFieldsComponentSource, /titleAside\?: ReactNode/);
  assert.match(adminSource, /label=\{t\.form\.imageUpload\}/);
});

test("tool and custom Telegram editing reuse one GitHub metadata component and request hook", () => {
  assert.match(githubMetadataComponentSource, /export function AdminGitHubMetadataButton/);
  assert.match(githubMetadataComponentSource, /export function AdminGitHubMetadataCard/);
  assert.match(githubMetadataHookSource, /export function useAdminGitHubMetadata/);
  assert.equal(adminSource.split("useAdminGitHubMetadata({").length - 1, 2);
  assert.equal(adminSource.split("<AdminGitHubMetadataButton").length - 1, 2);
  assert.equal(adminSource.split("<AdminGitHubMetadataCard").length - 1, 1);
  const toolFormStart = adminSource.indexOf('<form id="admin-tool-editor-form"');
  const toolUrlIndex = adminSource.indexOf('id="admin-tool-url"', toolFormStart);
  const toolNameIndex = adminSource.indexOf('label={t.form.name}', toolFormStart);
  assert.ok(toolUrlIndex > toolFormStart);
  assert.ok(toolNameIndex > toolUrlIndex);
  assert.match(
    adminSource.slice(toolUrlIndex, toolNameIndex),
    /unavailable=\{!canFillGitHubMetadata\}[\s\S]*?githubMetadataUnavailable/
  );
  const toolCardIndex = adminSource.indexOf("<AdminGitHubMetadataCard", adminSource.indexOf('id="admin-tool-url"'));
  const toolCategoryIndex = adminSource.indexOf("adminCategoryOptions", adminSource.indexOf('id="admin-tool-url"'));
  assert.ok(toolCardIndex > toolCategoryIndex);
  const telegramDialogStart = adminSource.indexOf('id="telegram-rich-markdown-body"');
  const telegramDialogEnd = adminSource.indexOf("{viewingTelegramPush ? (", telegramDialogStart);
  assert.equal(
    adminSource.slice(telegramDialogStart, telegramDialogEnd).includes("<AdminGitHubMetadataCard"),
    false
  );
  assert.match(
    adminSource,
    /active: Boolean\(\s*telegramResource\?\.type === "tool" \|\| telegramResource\?\.type === "custom"\s*\)/
  );
  assert.match(
    adminSource,
    /autoLoad: telegramResource\?\.type === "custom" && isCreatingTelegramPush/
  );
  assert.match(
    adminSource,
    /telegramResource\.type === "tool" \|\| telegramResource\.type === "custom" \? \([\s\S]*?<AdminGitHubMetadataButton/
  );
  assert.match(
    adminSource,
    /async function openTelegramMessageDialog[\s\S]*?telegramGitHub\.reset\(\)/
  );
  const telegramEditorStart = adminSource.indexOf('<div className="telegram-message-editor tool-form">');
  const telegramProjectIndex = adminSource.indexOf(
    'telegramResource.type === "tool" || telegramResource.type === "custom"',
    telegramEditorStart
  );
  const telegramTitleIndex = adminSource.indexOf('id="telegram-custom-title"', telegramEditorStart);
  assert.ok(telegramProjectIndex > telegramEditorStart);
  assert.ok(telegramTitleIndex > telegramProjectIndex);
  assert.match(
    adminSource.slice(telegramProjectIndex, telegramTitleIndex + 100),
    /task="telegram_title"/
  );
  assert.match(
    adminSource,
    /const fields = readTelegramBodyFields\([\s\S]*?fields\.url !== telegramUrl[\s\S]*?telegramGitHub\.reset\(fields\.url\)/
  );
  assert.doesNotMatch(adminSource, /function fillGitHubMetadata/);
  assert.doesNotMatch(adminSource, /loadGitHubToolMetadata/);
});

test("article and content Telegram editing follow their information order", () => {
  const editorStart = adminSource.indexOf('<div className="telegram-message-editor tool-form">');
  const editorEnd = adminSource.indexOf('<AdminMarkdownEditor', editorStart);
  const editor = adminSource.slice(editorStart, editorEnd);
  const articleOrder = [
    'id="telegram-custom-title"',
    'task="telegram_description"',
    'telegramResource.type === "article" ? telegramResourceUrlField',
    '<AdminTagsField',
    'telegramResource.type === "article" || telegramResource.type === "content"',
    'telegramText.categoryLabel'
  ].map((marker) => editor.indexOf(marker));

  assert.ok(articleOrder.every((index) => index >= 0));
  assert.deepEqual([...articleOrder].sort((left, right) => left - right), articleOrder);
  const contentUrlIndex = editor.indexOf("{telegramContentOriginalUrlField}");
  const contentMediaIndex = editor.indexOf(
    'telegramResource.type === "article" || telegramResource.type === "content"'
  );
  const contentOrder = [
    'id="telegram-custom-title"',
    'task="telegram_description"',
    "{telegramContentOriginalUrlField}",
    "<AdminTagsField",
    'telegramResource.type === "article" || telegramResource.type === "content"',
    "telegramText.categoryLabel"
  ].map((marker) => editor.indexOf(marker));
  assert.ok(contentUrlIndex >= 0 && contentMediaIndex >= 0);
  assert.ok(contentOrder.every((index) => index >= 0));
  assert.deepEqual([...contentOrder].sort((left, right) => left - right), contentOrder);
  assert.match(
    editor,
    /telegramResource\.type === "tool" \|\| telegramResource\.type === "custom" \? \([\s\S]*?label=\{t\.form\.demoUrl\}/
  );
});

test("Telegram images start disabled and articles without covers do not invent screenshots", () => {
  assert.equal(telegram.getTelegramText("zh").mediaEnabled, "已开启");
  assert.equal(telegram.getTelegramText("zh").mediaDisabled, "已关闭");
  assert.equal(telegram.getTelegramText("zh").mediaUrlLabel, "预览图");
  assert.equal(telegram.getTelegramText("en").mediaEnabled, "Enabled");
  assert.equal(telegram.getTelegramText("en").mediaDisabled, "Disabled");
  assert.equal(
    telegram.getTelegramText("zh").mediaInvalid,
    "发送图片时请填写有效的图片地址"
  );
  assert.equal(
    telegram.getTelegramText("en").mediaInvalid,
    "Enter a valid image URL when image sending is enabled."
  );
  assert.match(
    adminSource,
    /const \[telegramMediaEnabled, setTelegramMediaEnabled\] = useState\(false\)/
  );
  assert.match(adminSource, /const \[telegramMediaUrl, setTelegramMediaUrl\] = useState\(""\)/);
  assert.match(adminSource, /const mediaUrl = createTelegramResourceMediaUrl\(resource\)/);
  assert.match(adminSource, /mediaEnabled: false/);
  assert.match(adminSource, /setTelegramMediaEnabled\(false\)/);
  assert.match(adminSource, /mediaEnabled=\{telegramMediaEnabled\}/);
  assert.match(adminSource, /mediaUrl=\{normalizedTelegramMediaUrl\}/);
  assert.equal(
    telegram.createTelegramResourceMediaUrl(articleResource),
    "https://htools.zrf.me/cover.png"
  );
  assert.equal(
    telegram.createTelegramResourceMediaUrl(articleWithoutCoverResource),
    ""
  );
  assert.match(backendSource, /const mediaEnabled = row \? row\.media_enabled === 1 : false/);
  assert.match(backendSource, /image: resource\.image/);
  assert.match(backendSource, /typeof parsed\.image === "string"/);
  assert.match(
    backendSource,
    /const sentMediaUrl = getTelegramMediaUrl\(row\?\.media_url \?\? ""\) \|\| defaultMediaUrl/
  );
  assert.match(backendSource, /normalizeTelegramMedia\(payload, defaultMediaUrl, false\)/);
  assert.match(sharedSource, /media_enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(backendSource, /telegramRequest<TelegramMessage>\(env, "sendMessage"/);
  assert.match(backendSource, /parse_mode: "HTML"/);
  assert.match(backendSource, /media_enabled/);
  assert.match(backendSource, /media_url/);
  assert.match(backendSource, /last_pushed_hash/);
  assert.match(backupSource, /media_enabled, media_url, last_pushed_hash/);
});

test("Telegram image URL stays editable while media sending is disabled", () => {
  const mediaInputStart = adminSource.indexOf('id="telegram-media-url"');
  const mediaInputEnd = adminSource.indexOf('placeholder={telegramText.mediaUrlPlaceholder}', mediaInputStart);
  const mediaInputSource = adminSource.slice(mediaInputStart, mediaInputEnd);
  assert.doesNotMatch(mediaInputSource, /!telegramMediaEnabled/);
  assert.match(
    resourceFieldsComponentSource,
    /onBlur=\{\(event\) =>[\s\S]*normalizeHttpUrlInput\(event\.currentTarget\.value\)/
  );
});

test("Telegram rich messages use text messages or native photo captions", () => {
  const markdown = [
    "# HTools",
    "",
    "> 引用 **重点**",
    "",
    "- 列表",
    "",
    "| 项目 | 状态 |",
    "| --- | --- |",
    "| HTools | 正常 |"
  ].join("\n");
  const withoutMedia = telegramBackend.createTelegramSendPayload(markdown);
  const withMedia = telegramBackend.createTelegramPhotoPayload(
    markdown,
    "https://example.com/htools.png"
  );
  assert.equal(withoutMedia.parse_mode, "HTML");
  assert.equal(withoutMedia.link_preview_options.is_disabled, true);
  assert.equal(withMedia.photo, "https://example.com/htools.png");
  assert.equal(withMedia.parse_mode, "HTML");
  assert.match(withMedia.caption, /<b>HTools<\/b>/);
  assert.throws(
    () => telegramBackend.createTelegramPhotoPayload("a".repeat(1025), "https://example.com/a.png"),
    /1024 character limit/
  );
});

test("a recovered image push creates one new Telegram message and updates that same message", async () => {
  const database = createRecoveredTelegramDatabase();
  const env = {
    DB: database.DB,
    TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE"
  };
  const firstImage = "https://example.com/recovered-first.png";
  const updatedImage = "https://example.com/recovered-updated.png";
  const requests = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(options.body || "{}");
    requests.push({ method, payload });
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          message_id: 101,
          chat: { id: Number(database.target), type: "supergroup" }
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const sent = await telegramBackend.sendTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      {
        bodyMarkdown: "**Recovered Tool**\n\nFirst image push",
        mediaEnabled: true,
        mediaUrl: firstImage,
        locale: "en",
        resource: database.resource
      }
    );

    assert.equal(sent.exists, true);
    assert.equal(sent.syncStatus, "synced");
    assert.equal(sent.mediaEnabled, true);
    assert.equal(sent.mediaUrl, firstImage);
    assert.equal(database.record.id, "recovered-record");
    assert.equal(database.record.message_id, "101");
    assert.equal(database.record.chat_id, database.target);
    assert.equal(database.record.media_url, firstImage);
    assert.equal(requests[0].method, "sendPhoto");
    assert.equal(requests[0].payload.photo, firstImage);
    assert.match(requests[0].payload.caption, /First image push/);

    const updated = await telegramBackend.updateTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      {
        bodyMarkdown: "**Recovered Tool**\n\nUpdated image push",
        mediaEnabled: true,
        mediaUrl: updatedImage,
        locale: "en",
        resource: database.resource
      }
    );

    assert.equal(updated.exists, true);
    assert.equal(updated.syncStatus, "synced");
    assert.equal(updated.mediaEnabled, true);
    assert.equal(updated.mediaUrl, updatedImage);
    assert.equal(database.record.id, "recovered-record");
    assert.equal(database.record.message_id, "101");
    assert.equal(database.record.chat_id, database.target);
    assert.equal(database.record.media_url, updatedImage);
    assert.equal(database.writes.length, 2);
    assert.equal(requests[1].method, "editMessageMedia");
    assert.equal(requests[1].payload.message_id, 101);
    assert.equal(requests[1].payload.chat_id, database.target);
    assert.equal(requests[1].payload.media.type, "photo");
    assert.equal(requests[1].payload.media.media, updatedImage);
    assert.match(requests[1].payload.media.caption, /Updated image push/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("switching a pushed photo to text replaces the Telegram message", async () => {
  const database = createRecoveredTelegramDatabase();
  database.record.chat_id = database.target;
  database.record.target_ref = database.target;
  database.record.message_id = "101";
  database.record.media_enabled = 1;
  const env = { DB: database.DB, TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE" };
  const requests = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(options.body || "{}");
    requests.push({ method, payload });
    const result = method === "deleteMessage"
      ? true
      : { message_id: 301, chat: { id: Number(database.target) } };
    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const updated = await telegramBackend.updateTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      {
        bodyMarkdown: "**Recovered Tool**\n\nText-only update",
        mediaEnabled: false,
        mediaUrl: "",
        locale: "en",
        resource: database.resource
      }
    );

    assert.deepEqual(requests.map((request) => request.method), [
      "sendMessage",
      "deleteMessage"
    ]);
    assert.equal(requests[0].payload.link_preview_options.is_disabled, true);
    assert.equal(requests[1].payload.message_id, 101);
    assert.equal(database.record.message_id, "301");
    assert.equal(database.record.media_enabled, 0);
    assert.equal(updated.mediaEnabled, false);
    assert.equal(updated.syncStatus, "synced");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent first pushes acquire one server lock and send only once", async () => {
  const database = createRecoveredTelegramDatabase();
  const env = { DB: database.DB, TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE" };
  const payload = {
    bodyMarkdown: "**Recovered Tool**\n\nConcurrent push",
    mediaEnabled: true,
    mediaUrl: "https://example.com/concurrent.png",
    locale: "en",
    resource: database.resource
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let resolveTelegram;
  let notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });

  globalThis.fetch = async () => {
    fetchCount += 1;
    notifyStarted();
    return await new Promise((resolve) => {
      resolveTelegram = () => resolve(new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 201, chat: { id: Number(database.target) } }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ));
    });
  };

  try {
    const firstPush = telegramBackend.sendTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      payload
    );
    await started;

    await assert.rejects(
      telegramBackend.sendTelegramMessage(
        env,
        "tool",
        database.resource.id,
        "https://htools.example.com",
        { ...payload, confirmUncertainRetry: true }
      ),
      (error) => {
        assert.deepEqual(
          telegramBackend.writeTelegramErrorResponse(error, "fallback"),
          {
            message: "Telegram message operation is already in progress.",
            code: "TELEGRAM_PUSH_IN_PROGRESS",
            status: 409
          }
        );
        return true;
      }
    );

    assert.equal(fetchCount, 1);
    resolveTelegram();
    await firstPush;
    assert.equal(database.record.message_id, "201");
    assert.equal(database.lock, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("known Telegram failures release the lock for an immediate retry", async () => {
  const database = createRecoveredTelegramDatabase();
  const env = { DB: database.DB, TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE" };
  const payload = {
    bodyMarkdown: "**Recovered Tool**\n\nRetry after permission fix",
    mediaEnabled: true,
    mediaUrl: "https://example.com/retry.png",
    locale: "en",
    resource: database.resource
  };
  const originalFetch = globalThis.fetch;
  let allowed = false;

  globalThis.fetch = async () => new Response(
    JSON.stringify(
      allowed
        ? {
            ok: true,
            result: { message_id: 202, chat: { id: Number(database.target) } }
          }
        : { ok: false, description: "Forbidden: bot cannot send messages" }
    ),
    {
      status: allowed ? 200 : 403,
      headers: { "content-type": "application/json" }
    }
  );

  try {
    await assert.rejects(
      telegramBackend.sendTelegramMessage(
        env,
        "tool",
        database.resource.id,
        "https://htools.example.com",
        payload
      ),
      /Forbidden/
    );
    assert.equal(database.lock, null);

    allowed = true;
    const sent = await telegramBackend.sendTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      payload
    );
    assert.equal(sent.exists, true);
    assert.equal(database.record.message_id, "202");
    assert.equal(database.lock, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram message updates safely retry one transient request failure", async () => {
  const database = createRecoveredTelegramDatabase();
  database.record.chat_id = database.target;
  database.record.target_ref = database.target;
  database.record.message_id = "101";
  database.record.media_enabled = 0;
  database.setLock({
    operation: "update",
    state: "uncertain",
    lock_token: "stale-update-lock",
    expires_at: "2099-01-01T00:00:00.000Z"
  });
  const env = { DB: database.DB, TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE" };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) throw new Error("temporary network failure");
    return new Response(
      JSON.stringify({ ok: false, description: "Bad Request: message is not modified" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const updated = await telegramBackend.updateTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      {
        bodyMarkdown: "**Recovered Tool**\n\nSafely retried update",
        mediaEnabled: false,
        mediaUrl: "",
        locale: "en",
        resource: database.resource
      }
    );
    assert.equal(fetchCount, 2);
    assert.equal(updated.syncStatus, "synced");
    assert.equal(database.lock, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uncertain first pushes require explicit confirmation before retrying", async () => {
  const database = createRecoveredTelegramDatabase();
  const env = { DB: database.DB, TGTOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE" };
  const payload = {
    bodyMarkdown: "**Recovered Tool**\n\nUncertain push",
    mediaEnabled: true,
    mediaUrl: "https://example.com/uncertain.png",
    locale: "en",
    resource: database.resource
  };
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let available = false;

  globalThis.fetch = async (_url, options = {}) => {
    fetchCount += 1;
    if (!available) {
      return await new Promise((_resolve, reject) => {
        const fallback = setTimeout(
          () => reject(new Error("Telegram request timeout did not abort fetch.")),
          100
        );
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(fallback);
            reject(options.signal.reason);
          },
          { once: true }
        );
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 203, chat: { id: Number(database.target) } }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    await assert.rejects(
      telegramBackend.sendTelegramMessage(
        env,
        "tool",
        database.resource.id,
        "https://htools.example.com",
        payload
      ),
      (error) => {
        assert.deepEqual(
          telegramBackend.writeTelegramErrorResponse(error, "fallback"),
          {
            message: "Telegram push result is uncertain.",
            code: "TELEGRAM_PUSH_UNCERTAIN",
            status: 409
          }
        );
        return true;
      }
    );
    assert.equal(database.lock?.state, "uncertain");

    await assert.rejects(
      telegramBackend.sendTelegramMessage(
        env,
        "tool",
        database.resource.id,
        "https://htools.example.com",
        payload
      ),
      /Telegram push result is uncertain/
    );
    assert.equal(fetchCount, 1);

    available = true;
    const sent = await telegramBackend.sendTelegramMessage(
      env,
      "tool",
      database.resource.id,
      "https://htools.example.com",
      { ...payload, confirmUncertainRetry: true }
    );
    assert.equal(sent.exists, true);
    assert.equal(database.record.message_id, "203");
    assert.equal(fetchCount, 2);
    assert.equal(database.lock, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram save and push share one generic message record without contacting Telegram on save", () => {
  assert.match(backendSource, /export async function saveTelegramMessage/);
  const saveStart = backendSource.indexOf("export async function saveTelegramMessage");
  const saveEnd = backendSource.indexOf("export async function sendTelegramMessage", saveStart);
  const saveSource = backendSource.slice(saveStart, saveEnd);
  assert.match(saveSource, /UPDATE telegram_messages/);
  assert.match(saveSource, /INSERT INTO telegram_messages/);
  assert.doesNotMatch(saveSource, /telegramRequest/);
  assert.doesNotMatch(backendSource, /telegram_tool_drafts/);
  assert.match(backendSource, /SET custom_title = \?, resource_data = \?, category = \?, chat_id = \?, target_ref = \?, message_id = \?/);
  assert.match(adminSource, /saveTelegramMessageChanges/);
  assert.doesNotMatch(adminSource, /restoreDefaultTelegramMessage|telegram-restore-default/);
  assert.match(adminSource, /refreshTelegramSource/);
  assert.equal(telegram.getTelegramText("zh").syncSource, "同步来源");
  assert.equal(
    telegram.getTelegramText("zh").syncSourceHint,
    "同步关联工具、文章或订阅内容的最新信息，当前编辑内容将被覆盖。"
  );
  assert.equal(telegram.getTelegramText("en").syncSource, "Sync Source");
  assert.match(adminSource, /title=\{telegramText\.syncSourceHint\}/);
  assert.match(
    adminSource,
    /className="ghost-button"[\s\S]*?if \(telegramMessage\?\.resourceExists === false\)[\s\S]*?setStatus\(telegramText\.management\.resourceDeleted\)[\s\S]*?setPendingTelegramSourceSync\(true\)[\s\S]*?telegramText\.syncSource/
  );
  assert.match(adminSource, /const \[pendingTelegramSourceSync, setPendingTelegramSourceSync\] = useState\(false\)/);
  assert.match(
    adminSource,
    /pendingTelegramSourceSync \? \([\s\S]*?<AdminConfirmDialog[\s\S]*?description=\{telegramText\.syncSourceConfirmDescription\}[\s\S]*?void refreshTelegramSource\(\)/
  );
  assert.equal(telegram.getTelegramText("zh").syncSourceConfirmTitle, "同步来源？");
  assert.equal(
    telegram.getTelegramText("zh").syncSourceConfirmDescription,
    "将用关联内容的最新信息覆盖当前推送标题、简介、链接、标签、正文和图片地址。"
  );
});

test("all Telegram record mutations share one expiring server lock", () => {
  for (const [name, operation] of [
    ["saveTelegramMessage", "save"],
    ["sendTelegramMessage", "send"],
    ["updateTelegramMessage", "update"],
    ["deleteTelegramPush", "delete"]
  ]) {
    const start = backendSource.indexOf(`export async function ${name}`);
    const source = backendSource.slice(start, backendSource.indexOf("\n}\n", start) + 3);
    assert.match(source, new RegExp(`withTelegramPushLock\\([^)]*"${operation}"`));
  }
  assert.match(backendSource, /TELEGRAM_PUSH_LOCK_TTL_MS = 30_000/);
  assert.match(backendSource, /TELEGRAM_PUSH_UNCERTAIN_TTL_MS = 60_000/);
  assert.match(backendSource, /TELEGRAM_REQUEST_TIMEOUT_MS = 10_000/);
  assert.match(backendSource, /AbortSignal\.timeout\(TELEGRAM_REQUEST_TIMEOUT_MS\)/);
  assert.match(backendSource, /state = 'uncertain'/);
  assert.match(backendSource, /takeOverUncertain \? 1 : 0/);
  assert.match(sharedSource, /CREATE TABLE IF NOT EXISTS telegram_push_locks/);
  assert.match(backupSource, /DELETE FROM telegram_push_locks/);
});

test("Telegram retries only read-only or idempotent Bot API methods", () => {
  assert.match(
    backendSource,
    /TELEGRAM_SAFE_RETRY_METHODS = new Set\(\[\s*"getMe",\s*"getChat",\s*"getChatMember",\s*"editMessageText",\s*"editMessageMedia",\s*"deleteMessage"\s*\]\)/
  );
  assert.doesNotMatch(
    backendSource.slice(
      backendSource.indexOf("const TELEGRAM_SAFE_RETRY_METHODS"),
      backendSource.indexOf("]);", backendSource.indexOf("const TELEGRAM_SAFE_RETRY_METHODS")) + 3
    ),
    /sendMessage|sendPhoto/
  );
});

test("uncertain first pushes reuse the shared confirmation dialog before takeover", () => {
  const zh = telegram.getTelegramText("zh");
  assert.equal(zh.uncertainRetryTitle, "确认重新推送？");
  assert.equal(zh.uncertainRetryAction, "确认重试");
  assert.match(zh.uncertainRetryDescription, /可能产生重复消息/);
  assert.match(adminSource, /pendingTelegramUncertainRetry/);
  assert.match(adminSource, /<AdminConfirmDialog[\s\S]*?telegramText\.uncertainRetryAction/);
  assert.match(adminSource, /confirmTelegramUncertainRetry/);
  assert.match(adminSource, /confirmUncertainRetry/);
});

test("Telegram draft, first push, and update persist the selected push category", () => {
  const saveStart = backendSource.indexOf("export async function saveTelegramMessage");
  const sendStart = backendSource.indexOf("export async function sendTelegramMessage", saveStart);
  const updateStart = backendSource.indexOf("export async function updateTelegramMessage", sendStart);
  const updateEnd = backendSource.indexOf("export async function deleteTelegramPush", updateStart);
  const saveSource = backendSource.slice(saveStart, sendStart);
  const sendSource = backendSource.slice(sendStart, updateStart);
  const updateSource = backendSource.slice(updateStart, updateEnd);

  for (const source of [saveSource, sendSource, updateSource]) {
    assert.match(source, /const category = typeof payload\.category === "string"/);
    assert.match(source, /category/);
  }

  assert.match(saveSource, /SET custom_title = \?, resource_data = \?, category = \?/);
  assert.match(sendSource, /SET custom_title = \?, resource_data = \?, category = \?/);
  assert.match(sendSource, /custom_title, resource_data, category, chat_id/);
  assert.match(updateSource, /SET custom_title = \?, resource_data = \?, category = \?/);
  assert.match(
    adminSource,
    /telegramMessage\.exists[\s\S]*?updateTelegramMessage[\s\S]*?category: getTelegramStoredCategory\(telegramCategory\)[\s\S]*?sendTelegramMessage[\s\S]*?category: getTelegramStoredCategory\(telegramCategory\)/
  );

  // Push categories behave exactly like tool, article, and subscription categories:
  // the resource type is never mixed into the category field, so an empty category
  // stays empty instead of falling back to a source label. Reading a record goes
  // through getTelegramStoredCategory, which also strips source sentinels, so legacy
  // records saved by the old fallback open with an empty category instead of
  // rendering a raw __telegram_tool__ into the editor's category control.
  assert.equal(
    (adminSource.match(/setTelegramCategory\(getTelegramStoredCategory\(/g) ?? []).length,
    4
  );
  assert.doesNotMatch(adminSource, /setTelegramCategory\(normalizeAdminCategoryValue\(/);
  assert.match(
    adminSource,
    /function getTelegramStoredCategory[\s\S]*?isAllCategoryValue\(normalized\) \|\| isTelegramPushSourceFilter\(normalized\)/
  );
  // The editor's option list must not offer a sentinel either. The list filter still
  // gets them, but explicitly from TELEGRAM_PUSH_FIXED_FILTERS with a labelFor.
  assert.match(
    adminSource,
    /pushExistingCategories[\s\S]*?!isTelegramPushSourceFilter\(normalizeAdminCategoryValue\(category\)\)/
  );
  assert.doesNotMatch(adminSource, /getTelegramDisplayCategory/);
  assert.doesNotMatch(adminSource, /getTelegramPushDefaultFilter/);
});

test("Telegram schema is generic and migrates the unreleased tool-only records", () => {
  assert.match(sharedSource, /TELEGRAM_MESSAGE_TABLE_STATEMENT/);
  assert.match(sharedSource, /resource_type TEXT NOT NULL/);
  assert.match(sharedSource, /resource_id TEXT NOT NULL/);
  assert.match(sharedSource, /SELECT id, 'tool', tool_id/);
  assert.match(sharedSource, /DROP TABLE telegram_tool_messages/);
  assert.match(
    sharedSource,
    /'url', CASE WHEN articles\.published = 1 THEN '\/articles\/' \|\| articles\.slug ELSE '' END/
  );
  assert.doesNotMatch(sharedSource, /articles\.published = 1 THEN '' ELSE '\?preview=1'/);
  assert.doesNotMatch(backendSource, /telegram_tool_messages/);
  assert.match(backupSource, /SELECT id, resource_type, resource_id, custom_title, resource_data, category,\s*chat_id/);
});

test("Telegram push state uses one content fingerprint for saved and sent data", async () => {
  const first = await telegramBackend.createTelegramMessageFingerprint(
    "**HTools**",
    true,
    "https://example.com/preview.png"
  );
  const same = await telegramBackend.createTelegramMessageFingerprint(
    "**HTools**",
    true,
    "https://example.com/preview.png"
  );
  const changed = await telegramBackend.createTelegramMessageFingerprint(
    "**HTools**",
    false,
    "https://example.com/preview.png"
  );

  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.equal(first.length, 64);
  assert.match(backendSource, /syncStatus: !row\?\.message_id/);
  assert.match(backendSource, /"已保存，等待推送"|pending/);
  assert.match(telegramPushSource, /record\.syncStatus !== "not_pushed"/);
});

test("shared Markdown toolbar preserves selections and inserts supported syntax", () => {
  const bold = markdownEditor.formatMarkdownSelection("HTools", 0, 6, "bold", "zh");
  assert.deepEqual(bold, {
    value: "**HTools**",
    selectionStart: 2,
    selectionEnd: 8
  });
  assert.deepEqual(
    markdownEditor.formatMarkdownSelection(
      bold.value,
      bold.selectionStart,
      bold.selectionEnd,
      "bold",
      "zh"
    ),
    { value: "HTools", selectionStart: 0, selectionEnd: 6 }
  );
  assert.deepEqual(
    markdownEditor.formatMarkdownSelection("**HTools**", 2, 8, "italic", "zh"),
    { value: "***HTools***", selectionStart: 3, selectionEnd: 9 }
  );

  const quote = markdownEditor.formatMarkdownSelection(
    "第一行\n\n第二行",
    0,
    8,
    "quote",
    "zh"
  );
  assert.equal(quote.value, "> 第一行\n> \n> 第二行");

  const list = markdownEditor.formatMarkdownSelection(
    "第一行\n\n第二行",
    0,
    8,
    "list",
    "zh"
  );
  assert.equal(list.value, "- 第一行\n\n- 第二行");

  assert.deepEqual(
    markdownEditor.formatMarkdownSelection("", 0, 0, "heading", "zh"),
    { value: "## 标题", selectionStart: 3, selectionEnd: 5 }
  );
  assert.deepEqual(
    markdownEditor.formatMarkdownSelection("代码", 0, 2, "code", "zh"),
    { value: "`代码`", selectionStart: 1, selectionEnd: 3 }
  );
  assert.deepEqual(
    markdownEditor.formatMarkdownSelection("a\nb", 0, 3, "code", "zh"),
    { value: "```\na\nb\n```", selectionStart: 4, selectionEnd: 7 }
  );

  const link = markdownEditor.formatMarkdownSelection("HTools", 0, 6, "link", "zh");
  assert.equal(link.value, "[HTools](https://)");
  assert.equal(link.value.slice(link.selectionStart, link.selectionEnd), "https://");

  const table = markdownEditor.formatMarkdownSelection("HTools", 0, 6, "table", "zh");
  assert.equal(
    table.value,
    "| 项目 | 内容 |\n| --- | --- |\n| HTools | 内容 |"
  );
  assert.equal(table.value.slice(table.selectionStart, table.selectionEnd), "HTools");
});

test("Telegram reuses the shared Markdown editor and its compact toolbar", () => {
  assert.match(adminSource, /<AdminMarkdownEditor[\s\S]*?telegram-message-body-field/);
  assert.match(markdownEditorComponentSource, /role="toolbar"/);
  assert.match(markdownEditorComponentSource, /ghost-button admin-markdown-tool/);
  assert.match(markdownEditorComponentSource, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(
    stylesSource,
    /\.admin-markdown-toolbar\s*\{[\s\S]*?gap:\s*6px;/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 760px\)[\s\S]*?\.admin-markdown-toolbar\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/
  );
  assert.doesNotMatch(stylesSource, /\.admin-markdown-(?:toolbar|tool)[\s\S]{0,300}#229ed9/i);
});

test("Telegram media controls share the preview image field assistance and lead into preview", () => {
  const mediaFieldIndex = adminSource.indexOf('className="telegram-media-url-field"');
  const editorIndex = adminSource.indexOf("<AdminMarkdownEditor", mediaFieldIndex);
  const dialogBody = adminSource.slice(
    adminSource.indexOf("{telegramResource ? ("),
    adminSource.indexOf("{viewingTelegramPush ? (")
  );

  assert.ok(mediaFieldIndex >= 0);
  assert.ok(editorIndex > mediaFieldIndex);
  assert.match(
    adminSource,
    /className="telegram-media-url-field"[\s\S]*?titleAside=\{[\s\S]*?<SettingsStatusBadge[\s\S]*?enabled=\{telegramMediaEnabled\}[\s\S]*?inputAside=\{[\s\S]*?label=\{t\.form\.imageUpload\}[\s\S]*?id="telegram-media-url"/
  );
  assert.doesNotMatch(dialogBody, /<EditorTopActions>/);
  assert.doesNotMatch(adminSource, /TelegramMediaModeField|telegram-restore-default/);
  assert.match(
    adminSource,
    /function handleTelegramMediaEnabledChange\(enabled: boolean\)[\s\S]*?if \(enabled\) setTelegramMarkdownEditorMode\("preview"\)/
  );
  assert.match(adminSource, /mode=\{telegramMarkdownEditorMode\}/);
  assert.match(adminSource, /onModeChange=\{setTelegramMarkdownEditorMode\}/);
  assert.equal(telegram.getTelegramText("zh").bodyLabel, "Markdown 正文");
});

test("Telegram push title generates independently while source sync remains a whole-message action", () => {
  assert.doesNotMatch(adminSource, /className="telegram-message-intro"/);
  assert.doesNotMatch(adminSource, /telegram-message-heading-status/);
  assert.doesNotMatch(adminSource, /telegramText\.statuses\[telegramMessage\.syncStatus\]/);
  assert.doesNotMatch(adminSource, /telegramText\.statusLabel/);
  assert.doesNotMatch(stylesSource, /\.telegram-message-heading-status/);
  assert.match(
    adminSource,
    /footer=\{[\s\S]*?telegramResource\.type !== "custom" \? \([\s\S]*?className="ghost-button"[\s\S]*?if \(telegramMessage\?\.resourceExists === false\)[\s\S]*?setPendingTelegramSourceSync\(true\)[\s\S]*?telegramText\.syncSource/
  );
  assert.match(
    adminSource,
    /<AdminTextField[\s\S]*?inputAside=\{[\s\S]*?<AdminAiAction[\s\S]*?label=\{maintenanceText\.aiGeneratePushTitle\}[\s\S]*?task="telegram_title"[\s\S]*?id="telegram-custom-title"/
  );
  assert.equal(
    telegram.getTelegramText("zh").description,
    "编辑当前内容的 Telegram 推送信息，固定消息尾巴由系统自动附加。"
  );
});

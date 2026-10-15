import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  adminSource,
  helperSource,
  apiSource,
  telegramSource,
  listRouteSource,
  messageRouteSource,
  toolRouteSource,
  articleRouteSource,
  contentSourceRouteSource,
  categoryRouteSource,
  backupSource,
  factoryResetSource,
  styles
] = (await Promise.all([
  readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/admin-helpers.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/admin-api.ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/_telegram.ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/telegram-messages/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/telegram-messages/[resourceType]/[id].ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/tools/[id].ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/articles/[id].ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/content-sources/[id].ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/categories.ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/backup.ts", import.meta.url), "utf8"),
  readFile(new URL("../../functions/api/admin/factory-reset.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/styles.css", import.meta.url), "utf8")
])).map((source) => source.replace(/\r\n?/g, "\n"));
const clientTelegramSource = (
  await readFile(new URL("../../src/telegram.ts", import.meta.url), "utf8")
).replace(/\r\n?/g, "\n");
const resourceCardSkeletonSource = (
  await readFile(new URL("../../src/components/admin-skeletons/ResourceCardSkeleton.tsx", import.meta.url), "utf8")
).replace(/\r\n?/g, "\n");
const telegramPushSource = (
  await readFile(new URL("../../src/components/AdminTelegramPush.tsx", import.meta.url), "utf8")
).replace(/\r\n?/g, "\n");
const dialogComponentSource = (
  await readFile(new URL("../../src/components/AdminDialog.tsx", import.meta.url), "utf8")
).replace(/\r\n?/g, "\n");
const detailPlaceholderSource = (
  await readFile(new URL("../../src/components/AdminDetailPlaceholder.tsx", import.meta.url), "utf8")
).replace(/\r\n?/g, "\n");
const githubMetadataSource = (
  await readFile(new URL("../../src/components/AdminGitHubMetadata.tsx", import.meta.url), "utf8")
).replace(/\r\n?/g, "\n");

test("push management is a top-level admin route after content flow", () => {
  assert.match(helperSource, /\| "push"/);
  assert.match(helperSource, /push: "push"/);
  assert.match(adminSource, /selectAdminView\("content"\)[\s\S]*selectAdminView\("push"\)/);
  assert.match(adminSource, /adminView === "push"/);
  assert.match(adminSource, /telegramText\.management\.nav/);
});

test("push API keeps source and custom category filtering in one shared category control", () => {
  assert.match(
    listRouteSource,
    /typeValue === "tool" \|\|[\s\S]*typeValue === "article" \|\|[\s\S]*typeValue === "content" \|\|[\s\S]*typeValue === "custom"/
  );
  assert.match(listRouteSource, /readTelegramResourceType\(typeValue\)/);
  assert.match(telegramSource, /baseConditions\.push\("m\.resource_type = \?"\)/);
  assert.doesNotMatch(adminSource, /TELEGRAM_PUSH_TYPE_OPTIONS/);
  assert.match(adminSource, /const pushFilterCategories = useMemo/);
  assert.match(adminSource, /TELEGRAM_PUSH_FIXED_FILTERS/);
  assert.match(adminSource, /TELEGRAM_PUSH_TOOL_FILTER/);
  assert.match(adminSource, /TELEGRAM_PUSH_ARTICLE_FILTER/);
  assert.match(adminSource, /TELEGRAM_PUSH_CONTENT_FILTER/);
  assert.match(adminSource, /categories=\{pushFilterCategories\}/);
  assert.match(adminSource, /fixedCategories=\{TELEGRAM_PUSH_FIXED_FILTERS\}/);
  assert.match(adminSource, /deletableFixedCategories=\{TELEGRAM_PUSH_FIXED_FILTERS\}/);
  assert.match(adminSource, /setTelegramPushCategory\(category\)/);
});

test("push fixed filters reuse category batch deletion without removing the filters", () => {
  assert.match(adminSource, /normalizedDeletableFixedCategories/);
  assert.match(
    adminSource,
    /!fixed \|\| normalizedDeletableFixedCategories\.has\(category\)/
  );
  assert.match(adminSource, /const pendingCategoryIsBulkClear/);
  assert.match(adminSource, /telegramText\.management\.deleteDescription/);
  assert.match(categoryRouteSource, /allowPushFilter: scope === "push" && action === "delete"/);
  assert.match(categoryRouteSource, /__telegram_tool__: "tool"/);
  assert.match(categoryRouteSource, /__telegram_article__: "article"/);
  assert.match(categoryRouteSource, /__telegram_content__: "content"/);
  assert.match(
    categoryRouteSource,
    /DELETE FROM telegram_messages WHERE resource_type = \?/
  );
});

test("push categories stay independent from tool, article, and content category lists", () => {
  assert.doesNotMatch(telegramSource, /SELECT DISTINCT category\s+FROM tools/);
  assert.doesNotMatch(telegramSource, /SELECT DISTINCT category\s+FROM articles/);
  assert.doesNotMatch(telegramSource, /SELECT DISTINCT category\s+FROM content_items/);
  assert.match(telegramSource, /SELECT DISTINCT category[\s\S]*?FROM telegram_messages/);
  assert.match(telegramSource, /categoryOptions: categoryOptions\.results/);
  assert.doesNotMatch(adminSource, /pushSourceCategories/);
  assert.match(adminSource, /telegramPushCategoryOptions/);
  assert.match(adminSource, /const pushExistingCategories = useMemo/);
  assert.match(adminSource, /\.\.\.adminCategorySettings\.push/);
  assert.match(adminSource, /\.\.\.telegramPushRecords\.map/);
  assert.match(adminSource, /function uniqueAdminCategories/);
  // Quick push opens with an empty category, exactly like the tool, article and
  // subscription editors. The resource type is not a category and must not preselect one.
  assert.match(adminSource, /setTelegramQuickCategory\(""\)/);
  assert.doesNotMatch(adminSource, /getTelegramPushDefaultFilter/);
});

test("push source categories remain reserved in both client and API validation", () => {
  assert.match(helperSource, /TELEGRAM_PUSH_CONTENT_CATEGORY = "__telegram_content__"/);
  assert.match(
    helperSource,
    /normalized !== TELEGRAM_PUSH_CONTENT_CATEGORY/
  );
  assert.match(categoryRouteSource, /normalized === "__telegram_content__"/);
});

test("push pagination uses limit plus one without an unused total count", () => {
  const listImplementation = telegramSource.slice(
    telegramSource.indexOf("export async function listTelegramPushRecords"),
    telegramSource.indexOf("export async function getTelegramMessageState")
  );
  assert.match(listImplementation, /\.bind\(\.\.\.pageParams, limit \+ 1\)/);
  assert.match(listImplementation, /const hasMore = pageResult\.results\.length > limit/);
  assert.doesNotMatch(listImplementation, /COUNT\(\*\) AS total/);
  assert.doesNotMatch(listImplementation, /countRow/);
  assert.doesNotMatch(adminSource, /telegramPushTotal|setTelegramPushTotal/);
  assert.doesNotMatch(apiSource, /page\.total/);
});

test("push list reads stored push records with pagination and orphan-safe existence checks", () => {
  assert.match(listRouteSource, /listTelegramPushRecords/);
  assert.match(listRouteSource, /limitParam === null \? undefined : Number\(limitParam\)/);
  assert.match(telegramSource, /const baseConditions: string\[\] = \["1 = 1"\]/);
  assert.doesNotMatch(telegramSource, /m\.message_id <> ''/);
  assert.match(telegramSource, /m\.resource_data/);
  assert.match(telegramSource, /EXISTS\(SELECT 1 FROM tools WHERE id = m\.resource_id\)/);
  assert.match(telegramSource, /EXISTS\(SELECT 1 FROM articles WHERE id = m\.resource_id\)/);
  assert.doesNotMatch(telegramSource, /LEFT JOIN tools AS t/);
  assert.doesNotMatch(telegramSource, /LEFT JOIN articles AS a/);
  assert.match(telegramSource, /orderClause = sort === "oldest"[\s\S]*?sort_key DESC, m\.id DESC/);
  assert.match(telegramSource, /nextCursor:/);
  const listImplementation = telegramSource.slice(
    telegramSource.indexOf("export async function listTelegramPushRecords"),
    telegramSource.indexOf("export async function getTelegramMessageState")
  );
  assert.doesNotMatch(listImplementation, /ensureTelegramMessageSchema/);
  assert.doesNotMatch(listImplementation, /telegramRequest\s*</);
  assert.match(apiSource, /export async function loadTelegramPushRecords/);
  assert.match(
    apiSource,
    /loadTelegramPushRecords[\s\S]*?requestJsonWithTimeout<TelegramPushPage>[\s\S]*?timeoutMs: 15_000/
  );
});

test("database initialization owns the Telegram schema check once", () => {
  assert.doesNotMatch(telegramSource, /ensureTelegramMessageSchema/);
  assert.doesNotMatch(backupSource, /ensureTelegramMessageSchema/);
  assert.doesNotMatch(factoryResetSource, /ensureTelegramMessageSchema/);
  assert.match(backupSource, /DELETE FROM telegram_push_locks/);
  assert.match(factoryResetSource, /DELETE FROM telegram_push_locks/);
});

test("management reuses the existing editor and public card interaction", () => {
  assert.match(adminSource, /<AdminTelegramPushPanel/);
  assert.match(adminSource, /openTelegramMessageDialog\(record\.resource\)/);
  assert.match(adminSource, /<TelegramMessagePreview/);
  assert.match(telegramPushSource, /useAdminCardActionMenu\(`telegram-push:/);
  assert.match(telegramPushSource, /disabled=\{!serviceEnabled\}/);
  for (const source of [adminSource, telegramPushSource]) {
    assert.doesNotMatch(source, /function TelegramPushEditor/);
  }
  assert.match(telegramPushSource, /admin-tool-card admin-article-card/);
  assert.doesNotMatch(styles, /\.admin-article-card \.admin-tool-title\s*\{/);
});

test("Telegram previews use one concise title and one shared message border", () => {
  const previewComponent = telegramPushSource.slice(
    telegramPushSource.indexOf("export function TelegramMessagePreview")
  );
  assert.equal(clientTelegramSource.match(/previewTitle: "消息预览"/g)?.length, 1);
  assert.equal(clientTelegramSource.match(/previewTitle: "Message preview"/g)?.length, 1);
  assert.doesNotMatch(previewComponent, /tool-github-detail-repo|<Send\b|<span>Telegram<\/span>/);
  assert.match(
    previewComponent,
    /return \(\s*<div className=\{`telegram-channel-preview-message \$\{mediaEnabled \? "has-photo" : ""\}`\.trim\(\)\}>/
  );
  assert.doesNotMatch(adminSource, /tool-github-detail-card telegram-message-preview/);
  assert.match(adminSource, /<AdminDetailPlaceholder[\s\S]*?telegram-channel-preview-message/);
  assert.match(githubMetadataSource, /<AdminDetailPlaceholder/);
  assert.match(detailPlaceholderSource, /className=\{`admin-detail-placeholder/);
  assert.doesNotMatch(styles, /tool-github-detail-placeholder/);
  assert.match(
    styles,
    /\.telegram-message-preview\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?padding:\s*0;/
  );
});

test("pushed status remains informative without attempting to revert to draft", () => {
  assert.match(adminSource, /onPushedStatus=\{\(\) =>[\s\S]*?pushedNotice/);
  assert.match(telegramPushSource, /aria-pressed=\{pushed\}/);
  assert.match(telegramPushSource, /disabled=\{!pushed && !serviceEnabled\}/);
  assert.match(telegramPushSource, /if \(pushed\) \{[\s\S]*?onPushedStatus\(\)/);
  assert.match(telegramPushSource, /else \{[\s\S]*?onPush\(\)/);
});

test("read-only push preview keeps shared dialog bottom spacing", () => {
  assert.match(
    dialogComponentSource,
    /className=\{`dialog-panel \$\{footer \? "has-dialog-footer" : "is-dialog-body-only"\} \$\{panelClassName\}`\}/
  );
  assert.match(
    styles,
    /@media \(max-width: 920px\)[\s\S]*?\.tool-editor-dialog\.is-dialog-body-only \.dialog-body \{[\s\S]*?padding: 0 16px calc\(20px \+ env\(safe-area-inset-bottom\)\);/
  );
});

test("tool, article, and push loading states reuse one public card skeleton grid", () => {
  const panelSource = telegramPushSource.slice(
    telegramPushSource.indexOf("export function AdminTelegramPushPanel"),
    telegramPushSource.indexOf("function TelegramPushRecordCard")
  );
  const skeletonSource = resourceCardSkeletonSource;
  assert.equal(
    (adminSource.match(/<AdminResourceCardSkeletonGrid/g) ?? []).length +
      (telegramPushSource.match(/<AdminResourceCardSkeletonGrid/g) ?? []).length,
    3
  );
  assert.match(panelSource, /<AdminResourceCardSkeletonGrid ariaLabel=\{text\.title\} \/>/);
  assert.match(skeletonSource, /export function AdminResourceCardSkeletonGrid/);
  assert.match(skeletonSource, /Array\.from\(\{ length: 8 \}\)/);
  assert.match(skeletonSource, /function AdminResourceCardSkeleton\(\)/);
  assert.match(skeletonSource, /admin-resource-card-skeleton/);
  for (const source of [adminSource, telegramPushSource]) {
    assert.doesNotMatch(source, /AdminToolCardSkeleton|AdminArticleCardSkeleton|TelegramPushRecordSkeleton/);
  }
  assert.doesNotMatch(styles, /admin-article-card-skeleton|admin-tool-card-skeleton/);
  assert.match(styles, /skeleton-layout-mask/);
  assert.match(
    styles,
    /\.skeleton-layout-mask \.admin-tool-link-text \{[\s\S]*?color: transparent !important/
  );
  assert.match(
    adminSource,
    /const showTelegramPushSkeletons = isInitialTelegramPushLoad;/
  );
  assert.doesNotMatch(
    adminSource,
    /showTelegramPushSkeletons = useLoadingSkeleton/
  );
});

test("deleting a push removes only the local record while message replacement may remove its old remote message", () => {
  const deleteSource = telegramSource.slice(
    telegramSource.indexOf("export async function deleteTelegramPush"),
    telegramSource.indexOf("export function buildTelegramMessageMarkdown")
  );
  assert.match(messageRouteSource, /onRequestDelete/);
  assert.match(messageRouteSource, /deleteTelegramPush/);
  assert.match(deleteSource, /WHERE id = \? AND resource_type = \? AND resource_id = \?/);
  assert.doesNotMatch(deleteSource, /deleteMessage|deleteTelegramRemoteMessage/);
  assert.match(deleteSource, /DELETE FROM telegram_messages WHERE id = \?/);
  assert.match(telegramSource, /telegramRequest<true>\(env, "deleteMessage"/);
  assert.match(apiSource, /recordId=\$\{encodeURIComponent\(recordId\)\}/);
  assert.match(adminSource, /telegramText\.management\.deleteDescription/);
});

test("source deletion retains independent push records and reports unavailable sync on demand", () => {
  assert.doesNotMatch(toolRouteSource, /DELETE FROM telegram_messages/);
  assert.doesNotMatch(articleRouteSource, /DELETE FROM telegram_messages/);
  assert.doesNotMatch(contentSourceRouteSource, /DELETE FROM telegram_messages/);
  assert.match(contentSourceRouteSource, /DELETE FROM content_items WHERE source_id = \?/);
  const deleteCategorySource = categoryRouteSource.slice(
    categoryRouteSource.indexOf("async function deleteCategoryContent"),
    categoryRouteSource.indexOf("function getChanges")
  );
  const toolsStart = deleteCategorySource.indexOf('if (scope === "tools")');
  const articlesStart = deleteCategorySource.indexOf('if (scope === "articles")');
  const pushStart = deleteCategorySource.indexOf('if (scope === "push")');
  const firstAllStart = deleteCategorySource.indexOf("if (isAllCategory(category))", pushStart);
  const contentStart = deleteCategorySource.indexOf(
    "if (isAllCategory(category))",
    firstAllStart + 1
  );
  assert.doesNotMatch(deleteCategorySource.slice(toolsStart, articlesStart), /telegram_messages/);
  assert.doesNotMatch(deleteCategorySource.slice(articlesStart, pushStart), /telegram_messages/);
  assert.doesNotMatch(deleteCategorySource.slice(contentStart), /telegram_messages/);
  assert.match(categoryRouteSource, /DELETE FROM telegram_messages/);
  assert.match(categoryRouteSource, /DELETE FROM telegram_messages WHERE category = \?/);
  assert.doesNotMatch(categoryRouteSource, /UPDATE telegram_messages SET category = ''/);
  assert.doesNotMatch(categoryRouteSource, /ensureTelegramMessageSchema/);
  assert.doesNotMatch(backupSource, /references a missing resource/);
  const cardSource = telegramPushSource.slice(
    telegramPushSource.indexOf("function TelegramPushRecordCard"),
    telegramPushSource.indexOf("export function AdminTelegramPushButton")
  );
  assert.doesNotMatch(cardSource, /text\.resourceDeleted/);
  assert.match(cardSource, /\{record\.resource \? \([\s\S]*?text\.editAction/);
  assert.doesNotMatch(cardSource, /\{record\.resourceExists \? \([\s\S]*?text\.editAction/);
  assert.doesNotMatch(
    adminSource,
    /disabled=\{[\s\S]{0,180}telegramMessage\?\.resourceExists === false/
  );
  assert.match(
    adminSource,
    /if \(telegramMessage\?\.resourceExists === false\) \{[\s\S]{0,120}setStatus\(telegramText\.management\.resourceDeleted\)/
  );
  assert.match(clientTelegramSource, /resourceDeleted: "来源已删除"/);
  assert.match(clientTelegramSource, /resourceDeleted: "Source deleted"/);
  const previewDialogSource = adminSource.slice(
    adminSource.indexOf("{viewingTelegramPush ? ("),
    adminSource.indexOf("{formOpen ? (")
  );
  assert.doesNotMatch(previewDialogSource, /resourceDeleted/);
});

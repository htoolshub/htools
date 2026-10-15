import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const adminApiSource = await readFile(
  new URL("../../src/admin-api.ts", import.meta.url),
  "utf8"
);
const githubSettingsSource = await readFile(
  new URL("../../src/components/admin-settings/GitHubSettingsForm.tsx", import.meta.url),
  "utf8"
);
const adminDisplaySource = await readFile(
  new URL("../../src/admin-display.ts", import.meta.url),
  "utf8"
);
const githubHookSource = await readFile(
  new URL("../../src/useAdminGitHubMetadata.ts", import.meta.url),
  "utf8"
);
const toolCardSource = await readFile(
  new URL("../../src/components/admin-cards/AdminToolCard.tsx", import.meta.url),
  "utf8"
);
const articleCardSource = await readFile(
  new URL("../../src/components/admin-cards/AdminArticleCard.tsx", import.meta.url),
  "utf8"
);
const umamiCardSource = await readFile(
  new URL("../../src/components/admin-settings/UmamiSettingsCard.tsx", import.meta.url),
  "utf8"
);
const turnstileCardSource = await readFile(
  new URL("../../src/components/admin-settings/TurnstileSettingsCard.tsx", import.meta.url),
  "utf8"
);

function getFunctionSource(name, nextName) {
  const start = adminSource.indexOf(`async function ${name}`);
  const end = adminSource.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  return adminSource.slice(start, end < 0 ? undefined : end);
}

test("admin list refreshes accept only their latest response", () => {
  for (const [functionName, generationRef, nextName] of [
    ["refresh", "adminToolsRequestGenerationRef", "refreshArticles"],
    ["refreshArticles", "adminArticlesRequestGenerationRef", "loadMoreAdminArticles"],
    ["refreshContent", "contentItemsRequestGenerationRef", "loadMoreContentItems"]
  ]) {
    const source = getFunctionSource(functionName, nextName);
    assert.match(source, new RegExp(`${generationRef}\\.current \\+ 1`));
    assert.match(source, new RegExp(`${generationRef}\\.current !== generation`));
  }
});

test("category refreshes ignore stale responses and errors", () => {
  const source = getFunctionSource("refreshAdminCategories", "rememberAdminCategory");
  assert.match(source, /adminCategoryLoadRequestRef\.current \+ 1/);
  assert.match(source, /adminCategoryLoadRequestRef\.current !== requestId/);
  assert.match(source, /adminCategoryLoadRequestRef\.current === requestId/);
});

test("only the latest mutation refresh may restore the scroll position", () => {
  const source = getFunctionSource("refreshAfterMutation", "refresh");
  assert.match(source, /mutationRefreshGenerationRef\.current \+ 1/);
  assert.match(source, /try \{[\s\S]*await refreshAction\(\)[\s\S]*catch \(error\)/);
  assert.match(source, /t\.errors\.requestFailed/);
  assert.match(source, /mutationRefreshGenerationRef\.current !== generation/);
  assert.match(
    source,
    /requestAnimationFrame\([\s\S]*mutationRefreshGenerationRef\.current === generation[\s\S]*scrollTo/
  );
});

test("a failed initial content sync does not report a successful source save as failed", () => {
  const source = getFunctionSource("handleSaveContentSource", "handleSyncContentSource");
  assert.match(
    source,
    /const savedSource =[\s\S]*setContentSources\(\(current\) => \[[\s\S]*savedSource[\s\S]*requestContentSourceEditorClose\(\)[\s\S]*try \{[\s\S]*syncContentSource\(savedSource\.id, token\)[\s\S]*catch \(error\)[\s\S]*contentText\.savedSyncFailed\(syncError\)/
  );
});

test("content source preview cancels and ignores stale requests", () => {
  const source = getFunctionSource("handlePreviewContentSource", "handleSaveContentSource");
  assert.match(source, /contentPreviewRequestRef\.current \+ 1/);
  assert.match(source, /contentPreviewAbortRef\.current\?\.abort\(\)/);
  assert.match(source, /previewContentSource\(payload, token, \{[\s\S]*signal: controller\.signal/);
  assert.match(source, /contentPreviewRequestRef\.current !== requestId/);
  assert.match(source, /current\.title\.trim\(\)[\s\S]*title: preview\.title/);
  assert.match(source, /contentPreviewAppliedTitleRef\.current = preview\.title/);
  assert.match(
    adminApiSource,
    /previewContentSource\([\s\S]*options: \{ signal\?: AbortSignal \}[\s\S]*signal: options\.signal/
  );
});

test("changing the feed URL or closing the editor invalidates its preview", () => {
  assert.match(
    adminSource,
    /function closeContentSourceEditor\(\) \{[\s\S]*?invalidateContentPreview\(\)/
  );
  assert.match(
    adminSource,
    /value=\{contentSourceForm\.url\}[\s\S]*?onChange=\{\(event\) => \{[\s\S]*?invalidateContentPreview\(\)[\s\S]*?onBlur=\{\(\) => \{[\s\S]*?invalidateContentPreview\(\)/
  );
  assert.match(
    adminSource,
    /shouldClearPreviewTitle[\s\S]*contentPreviewAppliedTitleRef\.current[\s\S]*\{ title: "" \}/
  );
});

test("saving a tool keeps its loaded GitHub details on screen", () => {
  const source = getFunctionSource("handleSave", "handleDelete");

  // Resetting here blanked the GitHub detail card mid-save, and on a failed save the
  // admin was left with an empty card and had to read the repository again.
  assert.doesNotMatch(source, /toolGitHub\.reset\(\)/);
  // Closing the editor is what clears it, through the dialog's onClose handler.
  assert.match(adminSource, /function closeToolEditor\(\)[\s\S]{0,120}toolGitHub\.reset\(\)/);
  assert.match(adminSource, /onClose=\{\(\) => \{[\s\S]{0,80}closeToolEditor\(\)/);
});

test("GitHub metadata keeps edits made while the request is pending", () => {
  assert.match(githubHookSource, /const requestSnapshot = getSnapshotRef\.current\(\)/);
  assert.match(
    githubHookSource,
    /onMetadataRef\.current\([\s\S]*lastAppliedRef\.current\?\.metadata \?\? null,[\s\S]*overwrite,[\s\S]*requestSnapshot/
  );
  assert.match(
    adminDisplaySource,
    /currentValue === snapshotValue \? metadataValue : currentValue/
  );
  for (const field of ["name", "description", "demoUrl", "image"]) {
    assert.match(
      adminDisplaySource,
      new RegExp(`applyIfUnchanged\\([\\s\\S]*current\\.${field}[\\s\\S]*snapshot\\.${field}`)
    );
  }
});

test("changing a GitHub URL invalidates stale metadata responses and notices", () => {
  const toolUrlFieldStart = adminSource.indexOf('id="admin-tool-url"');
  const toolUrlFieldEnd = adminSource.indexOf("<AdminUrlField", toolUrlFieldStart + 1);
  assert.notEqual(toolUrlFieldStart, -1, "tool URL field should exist");
  const toolUrlFieldSource = adminSource.slice(
    toolUrlFieldStart,
    toolUrlFieldEnd < 0 ? undefined : toolUrlFieldEnd
  );
  assert.match(toolUrlFieldSource, /value=\{form\.url\}/);
  assert.match(toolUrlFieldSource, /if \(nextUrl !== form\.url\) toolGitHub\.reset\(nextUrl\)/);
  assert.match(
    toolUrlFieldSource,
    /setForm\(\(current\) => \(\{ \.\.\.current, url: nextUrl \}\)\)/
  );
  assert.match(
    githubHookSource,
    /requestIdRef\.current \+= 1[\s\S]*setMetadata\(null\)[\s\S]*catch \(error\) \{[\s\S]*requestIdRef\.current === requestId/
  );
});

test("GitHub metadata request deduplication separates refresh mode and login token", () => {
  assert.match(
    adminApiSource,
    /const requestMode = options\.forceRefresh \? "force" : "cached"/
  );
  assert.match(
    adminApiSource,
    /const requestKey = `\$\{token\}\\u0000\$\{requestMode\}\\u0000\$\{url\.trim\(\)\.toLowerCase\(\)\}`/
  );
  assert.match(
    adminApiSource,
    /pendingGitHubMetadataRequests\.get\(requestKey\)[\s\S]*pendingGitHubMetadataRequests\.set\(requestKey, request\)/
  );
});

test("card-level featured and publish toggles require confirmation before mutation", () => {
  assert.match(
    adminSource,
    /const \[pendingFeaturedTool, setPendingFeaturedTool\] = useState<Tool \| null>\(null\)/
  );
  assert.match(
    adminSource,
    /const \[pendingPublishedArticle, setPendingPublishedArticle\][\s\S]*useState<ArticleSummary \| null>\(null\)/
  );
  assert.match(
    adminSource,
    /onToggleFeatured=\{\(\) => requestToggleFeatured\(tool\)\}/
  );
  assert.match(
    adminSource,
    /onTogglePublished=\{\(\) => requestToggleArticlePublished\(article\)\}/
  );
  assert.match(adminSource, /toggle-featured-dialog-description/);
  assert.match(adminSource, /toggle-published-dialog-description/);
  assert.equal(
    (adminSource.match(/confirmLabel=\{t\.actions\.confirm\}/g) ?? []).length,
    11
  );
  assert.doesNotMatch(adminSource, /deleteContinue/);
  assert.match(
    adminSource,
    /setPendingFeaturedTool\(null\);\s*void handleToggleFeatured\(tool\)/
  );
  assert.match(
    adminSource,
    /setPendingPublishedArticle\(null\);\s*void handleToggleArticlePublished\(article\)/
  );
});

test("conflicting admin mutations share one lock per entity", () => {
  assert.match(
    adminSource,
    /function getAdminWriteEntityKey\([\s\S]*return `\$\{scope\}:\$\{id \|\| "new"\}`/
  );

  for (const key of [
    'getAdminWriteEntityKey("tool", editingTool?.id)',
    'getAdminWriteEntityKey("tool", tool.id)',
    'getAdminWriteEntityKey("article", editingArticle?.id)',
    'getAdminWriteEntityKey("article", article.id)',
    'getAdminWriteEntityKey("content-source", editingContentSource?.id)',
    'getAdminWriteEntityKey("content-source", source.id)',
    'getAdminWriteEntityKey("content-item", item.id)'
  ]) {
    assert.ok(adminSource.includes(key), `${key} should be used`);
  }

  assert.doesNotMatch(
    adminSource,
    /`(?:tool|article|content-source|content-item):(?:save|delete|sync|featured|published|convert):/
  );
});

test("article detail loading participates in entity locks", () => {
  const articleSource = getFunctionSource("openEditArticle", "handleSave");
  assert.match(articleSource, /acquireWriteAction\(actionKey\)/);
  assert.match(articleSource, /finally \{[\s\S]*releaseWriteAction\(actionKey\)/);
});

test("entity locks drive every conflicting card action disabled state", () => {
  assert.match(
    adminSource,
    /const \[writeLockedEntityKeys, setWriteLockedEntityKeys\] = useState<Set<string>>/
  );
  assert.match(
    adminSource,
    /function acquireWriteAction\([\s\S]*setWriteLockedEntityKeys\([\s\S]*next\.add\(key\)/
  );
  assert.match(
    adminSource,
    /function releaseWriteAction\([\s\S]*setWriteLockedEntityKeys\([\s\S]*next\.delete\(key\)/
  );

  for (const staleName of [
    "featuredUpdatingIds",
    "articlePublishUpdatingIds",
    "syncingSourceIds",
    "convertingItemIds",
    "setItemActionPending"
  ]) {
    assert.doesNotMatch(adminSource, new RegExp(staleName));
  }

  assert.match(
    toolCardSource,
    /export function AdminToolCard\([\s\S]*disabled=\{isBusy\}/
  );
  assert.match(
    articleCardSource,
    /export function AdminArticleCard\([\s\S]*disabled=\{isBusy\}/
  );
  assert.match(
    adminSource,
    /function AdminContentFlowPanel\([\s\S]*disabled=\{writeLockedEntityKeys\.has\(getAdminWriteEntityKey\("content-source", selectedSource\.id\)\)\}/
  );
  assert.match(
    adminSource,
    /function ContentItemCard\([\s\S]*disabled=\{isBusy\}/
  );
});

test("system service save and toggle requests are serialized per service", () => {
  const githubSource = githubSettingsSource;

  assert.match(githubSource, /const writeInProgressRef = useRef\(false\)/);
  assert.match(
    githubSource,
    /async function handleSave[\s\S]*if \(writeInProgressRef\.current\) return[\s\S]*writeInProgressRef\.current = true[\s\S]*finally \{[\s\S]*writeInProgressRef\.current = false/
  );
  assert.match(
    githubSource,
    /async function toggleEnabled[\s\S]*if \(!settings \|\| writeInProgressRef\.current\) return[\s\S]*writeInProgressRef\.current = true[\s\S]*finally \{[\s\S]*writeInProgressRef\.current = false/
  );

  assert.match(adminSource, /if \(proxySavingRef\.current\) \{[\s\S]*proxySavingRef\.current = true/);
  assert.match(umamiCardSource, /if \(savingRef\.current\) return[\s\S]*savingRef\.current = true/);
  assert.match(
    turnstileCardSource,
    /if \(writeInProgressRef\.current\) return[\s\S]*writeInProgressRef\.current = true[\s\S]*finally \{[\s\S]*writeInProgressRef\.current = false/
  );
  assert.match(adminSource, /acquireSettingsWriteLock\(`source`\)/);
});

test("article editor accepts only the latest detail request", () => {
  const source = getFunctionSource("openEditArticle", "handleSave");
  assert.match(source, /articleEditorLoadRequestRef\.current \+ 1/);
  assert.match(source, /articleEditorLoadRequestRef\.current !== requestId/);
  assert.match(source, /articleEditorLoadRequestRef\.current === requestId/);
  assert.doesNotMatch(source, /if \(loadingArticleEditorRef\.current\) return/);
  assert.match(adminSource, /function openCreateArticle\(\) \{[\s\S]*?articleEditorLoadRequestRef\.current \+= 1/);
});

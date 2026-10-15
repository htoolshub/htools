import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const dialogSource = await readFile(
  new URL("../../src/components/AdminDialog.tsx", import.meta.url),
  "utf8"
);

test("every admin modal continues to use the shared Dialog component", () => {
  assert.match(
    dialogSource,
    /function AdminConfirmDialog\([\s\S]*?<Dialog[\s>]/
  );
  assert.match(dialogSource, /role="dialog"/);
  assert.doesNotMatch(source, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /tabIndex=\{-1\}/);
});

test("shared Dialog owns initial focus and restores keyboard opening controls", () => {
  assert.match(dialogSource, /function getDialogInitialFocus/);
  assert.match(dialogSource, /\[data-dialog-initial-focus\]/);
  assert.match(dialogSource, /\.dialog-body input:not/);
  assert.match(dialogSource, /\.dialog-footer button:not/);
  assert.match(dialogSource, /useLayoutEffect\(\(\) =>/);
  assert.match(dialogSource, /getDialogInitialFocus\(panel\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialogSource, /resolveDialogReturnFocusTarget/);
  assert.match(dialogSource, /element\?\.isConnected/);
  assert.match(dialogSource, /getLastInputModality\(\) === "keyboard"/);
  assert.match(dialogSource, /restoreFocusOnCloseRef\.current/);
  assert.match(
    dialogSource,
    /function handleDialogKeyDown[\s\S]*restoreFocusOnCloseRef\.current = true/
  );
});

test("shared Dialog traps Tab and handles Escape only on its panel", () => {
  assert.match(dialogSource, /const adminDialogStack: symbol\[\] = \[\]/);
  assert.match(dialogSource, /adminDialogStack\.push\(dialogId\)/);
  assert.match(
    dialogSource,
    /adminDialogStack\.at\(-1\) !== dialogIdRef\.current/
  );
  assert.match(dialogSource, /event\.key === "Escape"/);
  assert.match(dialogSource, /event\.preventDefault\(\)/);
  assert.match(dialogSource, /event\.stopPropagation\(\)/);
  assert.match(dialogSource, /event\.key !== "Tab"/);
  assert.match(dialogSource, /event\.shiftKey/);
  assert.match(dialogSource, /firstElement\.focus\(\)/);
  assert.match(dialogSource, /lastElement\.focus\(\)/);
  assert.match(dialogSource, /onKeyDown=\{handleDialogKeyDown\}/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function Dialog")),
    /document\.addEventListener\("keydown"/
  );
});

test("dialog return focus normalizes disappearing menus and category filters", () => {
  assert.match(dialogSource, /\.admin-category-filter-trigger/);
  assert.match(dialogSource, /\.admin-tool-card-actions/);
  assert.match(dialogSource, /\.admin-tool-menu-trigger/);
});

test("dialog focus restoration does not escape a newer active dialog", () => {
  assert.match(dialogSource, /document\.querySelectorAll<HTMLElement>\("\.dialog-panel"\)/);
  assert.match(dialogSource, /adminDialogStack\.length > 0 && topDialog/);
  assert.match(dialogSource, /topDialog\.contains\(element\)/);
  assert.match(dialogSource, /getDialogInitialFocus\(topDialog\)\.focus/);
});

test("nested dialogs share a counted page scroll lock", () => {
  assert.match(dialogSource, /let adminDialogScrollLockCount = 0/);
  assert.match(dialogSource, /function acquireAdminDialogScrollLock/);
  assert.match(dialogSource, /function releaseAdminDialogScrollLock/);
  assert.match(dialogSource, /adminDialogScrollLockCount > 1/);
  assert.match(dialogSource, /adminDialogScrollLockCount > 0/);
  assert.match(dialogSource, /acquireAdminDialogScrollLock\(\)/);
  assert.match(dialogSource, /return releaseAdminDialogScrollLock/);
});

test("mobile admin navigation uses shared overlay focus management", () => {
  assert.match(source, /const mobileSidebarFocus = useOverlayFocusManagement\(\{/);
  assert.match(source, /containerRef: mobileSidebarRef/);
  assert.match(source, /initialFocusRef: mobileSidebarCloseRef/);
  assert.match(source, /returnFocusRef: sidebarToggleRef/);
  assert.match(source, /onKeyDown=\{mobileSidebarFocus\.handleKeyDown\}/);
  assert.match(source, /const \[isMobileSidebarViewport, setIsMobileSidebarViewport\]/);
  assert.match(source, /mediaQuery\.addEventListener\("change", updateViewport\)/);
  assert.match(source, /aria-label=\{sidebarToggleLabel\}/);
  assert.match(source, /aria-expanded=\{/);
});

test("mobile dialog close animation uses inert without hiding focused descendants", () => {
  assert.match(dialogSource, /inert=\{isClosing\}/);
  assert.doesNotMatch(dialogSource, /aria-hidden=\{isClosing\}/);
});

test("async article editing preserves its trigger before loading", () => {
  const editorSource = source.slice(
    source.indexOf("async function openEditArticle"),
    source.indexOf("function openCreateContentSource")
  );

  assert.match(
    editorSource,
    /const returnFocusTarget = getDialogReturnFocusTarget\(document\.activeElement\)/
  );
  assert.ok(
    editorSource.indexOf("const returnFocusTarget") <
      editorSource.indexOf("await loadAdminArticle")
  );
  assert.ok(
    editorSource.indexOf("rememberNextDialogReturnFocus(returnFocusTarget)") <
      editorSource.indexOf("setArticleFormOpen(true)")
  );
});

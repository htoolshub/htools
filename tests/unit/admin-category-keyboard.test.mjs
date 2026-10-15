import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const styles = await readFile(
  new URL("../../src/styles.css", import.meta.url),
  "utf8"
);
const focusHelperSource = await readFile(
  new URL("../../src/usePointerFocusRelease.ts", import.meta.url),
  "utf8"
);
const categoryFilterSource = source.slice(
  source.indexOf("function AdminCategoryFilter"),
  source.indexOf("const ADMIN_CARD_MENU_OPEN_EVENT")
);

test("admin category filter supports consistent keyboard navigation", () => {
  assert.match(
    categoryFilterSource,
    /function handleCategoryOptionKeyDown[\s\S]*if \(!open\) \{[\s\S]*return;/
  );
  assert.match(categoryFilterSource, /event\.key === "ArrowDown"/);
  assert.match(categoryFilterSource, /event\.key === "ArrowUp"/);
  assert.match(categoryFilterSource, /event\.key === "Home"/);
  assert.match(categoryFilterSource, /event\.key === "End"/);
  assert.match(categoryFilterSource, /event\.key === "Escape"/);
  assert.match(categoryFilterSource, /event\.key === "Tab"/);
});

test("category filter width follows its stable prompt instead of the selected label", () => {
  // Editors pass `scope` so the prompt reads "选择或新建工具分类"; filters pass allLabel.
  // Either way the width comes from that prompt, never from the current selection.
  assert.match(
    categoryFilterSource,
    /const widthLabel = allLabel \?\? resolvedEmptyLabel/
  );
  assert.match(
    categoryFilterSource,
    /const resolvedEmptyLabel = scopeCategoryLabel[\s\S]{0,160}categoryText\.selectOrCreateLabel\(scopeCategoryLabel\)/
  );
  assert.match(
    categoryFilterSource,
    /getAdminCategoryLabelWidth\(widthLabel\)/
  );
  assert.doesNotMatch(categoryFilterSource, /labels\.map\(getAdminCategoryLabelWidth\)/);
  // The old per-call-site override is gone: every editor now declares its scope instead.
  assert.doesNotMatch(categoryFilterSource, /emptyLabel/);
});

test("category keyboard navigation only targets primary category options", () => {
  assert.match(
    categoryFilterSource,
    /querySelectorAll<HTMLButtonElement>\([\s\S]*data-admin-category-option/
  );
  assert.equal(
    (categoryFilterSource.match(/\sdata-admin-category-option="true"/g) ?? [])
      .length,
    2
  );
  assert.doesNotMatch(
    categoryFilterSource,
    /admin-category-option-action[^>]+data-admin-category-option/
  );
});

test("category filter restores focus for intentional keyboard closure", () => {
  assert.match(categoryFilterSource, /ref=\{triggerRef\}/);
  assert.match(
    categoryFilterSource,
    /requestAnimationFrame\(\(\) => triggerRef\.current\?\.focus\(\)\)/
  );
  assert.match(
    categoryFilterSource,
    /event\.key === "Escape"[\s\S]*closeCategoryFilter\(true\)/
  );
});

test("touch category opening transfers focus directly to its search field", () => {
  assert.match(source, /import \{ createPortal, flushSync \} from "react-dom"/);
  assert.match(categoryFilterSource, /onPointerDown=\{\(event\) => \{/);
  assert.doesNotMatch(categoryFilterSource, /onPointerUp=\{\(event\) => \{/);
  assert.match(categoryFilterSource, /event\.pointerType !== "touch"/);
  assert.match(categoryFilterSource, /event\.preventDefault\(\)/);
  assert.match(categoryFilterSource, /scrollFilterToDialogTop\("auto"\)/);
  assert.match(
    categoryFilterSource,
    /directTouchFocusUntilRef\.current = performance\.now\(\) \+ 400/
  );
  assert.match(categoryFilterSource, /flushSync\(\(\) => setOpen\(true\)\)/);
  assert.match(categoryFilterSource, /const directFocusTimer = window\.setTimeout/);
  assert.match(categoryFilterSource, /scrollFilterToDialogTop\("auto"\)/);
  assert.match(categoryFilterSource, /\}, 120\)/);
  assert.match(
    categoryFilterSource,
    /searchRef\.current\?\.focus\(\{ preventScroll: true \}\)/
  );
  assert.match(
    categoryFilterSource,
    /if \(alignToTopOnOpen && !hasDirectTouchFocus\)/
  );
});

test("admin sort remains a native keyboard-operable cycle button", () => {
  const sortSource = source.slice(
    source.indexOf("function AdminSortButton"),
    source.indexOf("function AdminFilterBar")
  );

  assert.match(sortSource, /<button/);
  assert.match(sortSource, /type="button"/);
  assert.match(sortSource, /aria-label=\{label\}/);
  assert.match(sortSource, /title=\{label\}/);
  assert.match(source, /usePointerFocusRelease\(\)/);
  assert.doesNotMatch(sortSource, /onPointerUp=/);
  assert.doesNotMatch(sortSource, /role="menu"|role="listbox"/);
});

test("mobile admin controls release touch focus without disabling press feedback", () => {
  const filterSource = source.slice(
    source.indexOf("function AdminFilterBar"),
    source.indexOf("function EditorTopActions")
  );
  const cardSource = source.slice(
    source.indexOf("function AdminToolCard"),
    source.indexOf("function AdminResourceCardSkeletonGrid")
  );

  assert.match(focusHelperSource, /event\.pointerType === "touch"/);
  assert.match(focusHelperSource, /classList\.add\("is-touch-pressing"\)/);
  assert.match(focusHelperSource, /classList\.remove\("is-touch-pressing"\)/);
  assert.match(focusHelperSource, /window\.requestAnimationFrame/);
  assert.match(focusHelperSource, /document\.activeElement === control/);
  assert.match(focusHelperSource, /control\.blur\(\)/);
  assert.match(filterSource, /document\.addEventListener\("pointerdown", releaseSearchFocus, true\)/);
  assert.match(filterSource, /!searchField\?\.contains\(event\.target as Node\)/);
  assert.doesNotMatch(cardSource, /releaseTouchButtonFocus|startTouchButtonPress/);
  assert.match(styles, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(styles, /\.admin-workspace \.icon-button\.is-touch-pressing:not\(:disabled\)/);
  assert.match(styles, /\.admin-workspace \.ghost-button\.is-touch-pressing:not\(:disabled\)/);
  assert.doesNotMatch(styles, /\.admin-workspace \.admin-sort-button:active:not\(:disabled\)/);
  assert.doesNotMatch(styles, /\.admin-workspace \.admin-tool-card-actions \.icon-button:active:not\(:disabled\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = await readFile(
  new URL("../../src/useVisualViewportKeyboard.ts", import.meta.url),
  "utf8"
);
const appSource = await readFile(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8"
);
const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const dialogComponentSource = await readFile(
  new URL("../../src/components/AdminDialog.tsx", import.meta.url),
  "utf8"
);
const stylesSource = await readFile(
  new URL("../../src/styles.css", import.meta.url),
  "utf8"
);

test("shared viewport hook tracks keyboard resize and cleans up its metrics", () => {
  assert.match(hookSource, /KEYBOARD_OPEN_THRESHOLD = 120/);
  assert.match(hookSource, /window\.visualViewport/);
  assert.match(hookSource, /visualViewport\.addEventListener\("resize"/);
  assert.match(hookSource, /visualViewport\.addEventListener\("scroll"/);
  assert.match(hookSource, /--overlay-viewport-height/);
  assert.match(hookSource, /--overlay-keyboard-inset/);
  assert.match(hookSource, /removeProperty\("--overlay-viewport-height"\)/);
  assert.match(hookSource, /removeProperty\("--overlay-keyboard-inset"\)/);
});

test("viewport baseline follows rotation and layout viewport resize", () => {
  assert.match(hookSource, /baselineViewportBottom/);
  assert.match(hookSource, /baselineViewportWidth/);
  assert.match(hookSource, /viewportWidthChanged/);
  assert.match(hookSource, /layoutViewportResized/);
  assert.match(hookSource, /Math\.abs\(window\.innerWidth - baselineViewportWidth\)/);
  assert.match(hookSource, /Math\.abs\(window\.innerHeight - visualViewportBottom\)/);
  assert.doesNotMatch(
    hookSource,
    /keyboardOcclusion < KEYBOARD_OPEN_THRESHOLD[\s\S]*activeElement/
  );
});

test("search and admin dialogs use the shared keyboard viewport hook", () => {
  assert.match(
    appSource,
    /useVisualViewportKeyboard\(\{[\s\S]*active: isSearchOverlayOpen[\s\S]*containerRef: searchPanelRef/
  );
  assert.match(
    dialogComponentSource,
    /useVisualViewportKeyboard\(\{[\s\S]*active: !isToolEditorDrawer,[\s\S]*containerRef: panelRef/
  );
});

test("admin editor drawers leave keyboard positioning to the mobile browser", () => {
  assert.match(dialogComponentSource, /const isToolEditorDrawer = panelClassName/);
  assert.match(dialogComponentSource, /active: !isToolEditorDrawer/);
  assert.doesNotMatch(adminSource, /scrollFocusedElementIntoView/);
  assert.doesNotMatch(dialogComponentSource, /scrollFocusedElementIntoView/);
});

test("mobile search and editor drawer reserve the visual viewport", () => {
  assert.match(stylesSource, /var\(--overlay-viewport-height, 100svh\)/);
  assert.match(stylesSource, /scroll-padding-bottom: calc\(16px \+ var\(--overlay-keyboard-inset/);
  assert.match(stylesSource, /\.tool-editor-dialog\[data-keyboard-open\]/);
  assert.match(stylesSource, /bottom: var\(--overlay-keyboard-inset, 0px\)/);
  assert.match(stylesSource, /scroll-padding-bottom: calc\(24px \+ var\(--overlay-keyboard-inset/);
});

test("mobile confirmation dialogs keep their body scrollable and footer visible", () => {
  assert.match(
    stylesSource,
    /\.tool-editor-dialog \.dialog-body\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/
  );
  assert.match(
    stylesSource,
    /\.tool-editor-dialog\[data-keyboard-open\]\s*\{[\s\S]*?bottom: var\(--overlay-keyboard-inset, 0px\);[\s\S]*?max-height: calc\(var\(--overlay-viewport-height, 100svh\) - 12px\);/
  );
  assert.match(
    dialogComponentSource,
    /panelClassName="tool-editor-dialog admin-action-dialog admin-confirm-dialog"/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 640px\) and \(max-height: 420px\)/
  );
});

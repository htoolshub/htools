import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const publicSource = await readFile(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8"
);
const pointerFocusSource = await readFile(
  new URL("../../src/usePointerFocusRelease.ts", import.meta.url),
  "utf8"
);
const outsideInteractionSource = await readFile(
  new URL("../../src/useOutsideInteractionDismiss.ts", import.meta.url),
  "utf8"
);
const cardActionMenuSource = await readFile(
  new URL("../../src/useAdminCardActionMenu.ts", import.meta.url),
  "utf8"
);

test("public and admin surfaces use one shared pointer focus release behavior", () => {
  assert.match(adminSource, /usePointerFocusRelease\(\)/);
  assert.equal((adminSource.match(/usePointerFocusRelease\(\)/g) ?? []).length, 1);
  assert.match(publicSource, /usePointerFocusRelease\(\)/);
  assert.equal((publicSource.match(/usePointerFocusRelease\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(adminSource, /startTouchButtonPress/);
  assert.doesNotMatch(adminSource, /releaseTouchButtonFocus/);
  assert.doesNotMatch(adminSource, /onMouseUp=\{\(event\) => event\.currentTarget\.blur\(\)\}/);
  assert.doesNotMatch(adminSource, /onPointerCancel=\{releaseTouchButtonFocus\}/);
});

test("shared pointer focus behavior preserves keyboard focus and releases pointer focus", () => {
  assert.match(pointerFocusSource, /document\.addEventListener\("pointerdown"/);
  assert.match(pointerFocusSource, /document\.addEventListener\("pointerup"/);
  assert.match(pointerFocusSource, /document\.addEventListener\("pointercancel"/);
  assert.match(pointerFocusSource, /event\s*\.composedPath\(\)/);
  assert.match(pointerFocusSource, /document\.activeElement === control/);
  assert.match(pointerFocusSource, /control\.blur\(\)/);
  assert.match(pointerFocusSource, /event\.pointerType === "touch"/);
  assert.match(pointerFocusSource, /lastInputModality = "pointer"/);
  assert.match(pointerFocusSource, /lastInputModality = "keyboard"/);
  assert.match(pointerFocusSource, /document\.addEventListener\("keydown"/);
});

test("admin utility, category and card menus share outside dismissal", () => {
  assert.match(cardActionMenuSource, /useOutsideInteractionDismiss\(\{[\s\S]*?rootRef\.current/);
  assert.equal(
    (adminSource.match(/useOutsideInteractionDismiss\(\{/g) ?? []).length +
      (cardActionMenuSource.match(/useOutsideInteractionDismiss\(\{/g) ?? []).length,
    2
  );
  assert.match(outsideInteractionSource, /isEventInsideElement/);
  assert.match(outsideInteractionSource, /pointerdown/);
  assert.match(outsideInteractionSource, /click/);
  assert.match(outsideInteractionSource, /focusin/);
});

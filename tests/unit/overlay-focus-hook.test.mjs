import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/useOverlayFocusManagement.ts", import.meta.url),
  "utf8"
);

test("overlay focus hook owns initial focus and trigger restoration", () => {
  assert.match(source, /useLayoutEffect\(\(\) =>/);
  assert.match(source, /initialFocusRef\?\.current/);
  assert.match(source, /getOverlayFocusableElements\(container\)\[0\]/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /returnFocus\?\.isConnected/);
});

test("overlay focus hook traps forward and backward Tab", () => {
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /firstElement\.focus\(\)/);
  assert.match(source, /lastElement\.focus\(\)/);
  assert.match(source, /container\.focus\(\{ preventScroll: true \}\)/);
});

test("overlay focus hook handles Escape inside the active layer", () => {
  assert.match(source, /if \(!active\) return/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /onEscape\(\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
test("admin language and theme menus use stable roots and close on outside interactions", () => {
  assert.match(source, /useUtilityMenuKeyboard/);
  assert.doesNotMatch(source, /authMenuRootRef|sidebarMenuRootRef/);
  assert.doesNotMatch(source, /handleOutsideInteraction/);
});

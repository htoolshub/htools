import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, styles] = await Promise.all([
  readFile(new URL("../../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/styles.css", import.meta.url), "utf8")
]);

test("global notifications deduplicate active messages", () => {
  assert.match(app, /const activeToastKeysRef = useRef\(new Set<string>\(\)\)/);
  assert.match(app, /if \(activeToastKeysRef\.current\.has\(toastKey\)\) return;/);
  assert.match(app, /activeToastKeysRef\.current\.add\(toastKey\)/);
  assert.match(app, /activeToastKeysRef\.current\.delete\(toastKey\)/);
});

test("global and admin notifications wrap long content within the viewport", () => {
  for (const selector of [".admin-status", ".global-toast"]) {
    const start = styles.indexOf(`${selector} {`);
    assert.notEqual(start, -1);
    const rule = styles.slice(start, styles.indexOf("}", start) + 1);
    assert.match(rule, /width: fit-content;/);
    assert.match(rule, /white-space: normal;/);
    assert.match(rule, /overflow-wrap: anywhere;/);
  }
});

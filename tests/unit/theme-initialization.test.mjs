import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../../src/App.tsx", import.meta.url), "utf8");

test("the inline theme bootstrap follows the system preference when no choice is stored", () => {
  assert.match(html, /const storedMode = localStorage\.getItem\("htools_theme"\);/);
  assert.match(html, /: "system";/);
  assert.match(html, /mode === "system"[\s\S]*?matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.doesNotMatch(html, /localStorage\.getItem\("htools_theme"\)\s*\|\|\s*"light"/);
});

test("React keeps an absent or invalid stored theme in system mode", () => {
  assert.match(
    app,
    /function resolveStoredThemeMode\(value\?: string \| null\)[\s\S]*?return value === "light" \|\| value === "dark" \|\| value === "system"[\s\S]*?: "system";/
  );
});

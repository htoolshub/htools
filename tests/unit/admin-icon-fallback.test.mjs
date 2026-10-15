import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [displaySource, routeSource] = await Promise.all([
  readFile(new URL("../../src/admin-display.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../functions/icons/[host]/icon.png.ts", import.meta.url),
    "utf8"
  )
]);

test("admin icon failures keep the initials fallback without console 404 noise", () => {
  assert.match(displaySource, /icon\.png\?fallback=empty/);
  assert.match(routeSource, /searchParams\.get\("fallback"\) === "empty"/);
  assert.match(routeSource, /\? 204\s*: 404/);
  assert.match(routeSource, /function missingIconResponse\(status: 204 \| 404\)/);
});

test("missing icons cache long enough to stop repeating the slow upstream lookup", () => {
  assert.match(routeSource, /const ICON_ERROR_CACHE_TTL_SECONDS = 60 \* 60;/);
  assert.match(
    routeSource,
    /max-age=\$\{ICON_ERROR_CACHE_TTL_SECONDS\}, stale-while-revalidate=\$\{ICON_ERROR_CACHE_TTL_SECONDS\}/
  );
});

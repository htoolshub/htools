import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const [robotsSource, fallbackSource, indexSource, appSource, helpersSource] =
  await Promise.all([
    readSource("functions/robots.txt.ts"),
    readSource("functions/[[path]].ts"),
    readSource("index.html"),
    readSource("src/App.tsx"),
    readSource("src/site-helpers.ts")
  ]);

test("robots.txt allows public pages and declares the canonical sitemap", () => {
  assert.match(robotsSource, /User-agent: \*/);
  assert.match(robotsSource, /Allow: \//);
  assert.match(robotsSource, /Disallow: \/admin/);
  assert.match(robotsSource, /Disallow: \/api\//);
  assert.match(robotsSource, /Disallow: \/__htools-cache\//);
  assert.match(robotsSource, /Sitemap: \$\{siteUrl\}\/sitemap\.xml/);
  assert.match(robotsSource, /getPublicSiteUrl\(request\.url\)/);
});

test("HTML advertises all public discovery documents", () => {
  assert.match(indexSource, /name="robots" content="index,follow"/);
  assert.match(indexSource, /rel="sitemap" type="application\/xml" href="\/sitemap\.xml"/);
  assert.match(indexSource, /type="application\/rss\+xml"[^>]+href="\/rss\.xml"/);
  assert.match(indexSource, /type="application\/feed\+json"[^>]+href="\/rss\.json"/);
});

test("SPA fallback blocks admin, API, preview, and unknown paths", () => {
  assert.match(fallbackSource, /withRobotsPolicy\(await context\.next\(\), true\)/);
  assert.match(fallbackSource, /url\.searchParams\.has\("preview"\)/);
  assert.match(fallbackSource, /url\.searchParams\.has\("contentItem"\)/);
  assert.match(fallbackSource, /!isKnownPublicPath\(pathname\)/);
  assert.match(fallbackSource, /X-Robots-Tag/);
  assert.match(fallbackSource, /noindex, nofollow, noarchive/);
});

test("public metadata marks unknown and preview pages as noindex", () => {
  assert.match(appSource, /const isUnknownPublicRoute = isHomeRoute/);
  assert.match(appSource, /const isPreviewRoute =/);
  assert.match(appSource, /robots: isUnknownPublicRoute \? NO_INDEX_ROBOTS : INDEX_ROBOTS/);
  assert.match(appSource, /robots: NO_INDEX_ROBOTS/);
  assert.match(appSource, /const isPreviewDocument =/);
  assert.match(appSource, /robots: isPreviewDocument \? NO_INDEX_ROBOTS : INDEX_ROBOTS/);
  assert.match(helpersSource, /syncMetadataTag\("name", "robots", robots\)/);
});

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const distAssets = new URL("../../dist/assets/", import.meta.url);

async function readAsset(file) {
  return readFile(new URL(file, distAssets), "utf8");
}

function findJavaScriptDependencies(source, includeDynamic) {
  const dependencies = new Set();
  const importPattern = includeDynamic
    ? /(?:from|import)\s*(?:\(\s*)?["']\.\/([^"']+\.js)["']/g
    : /(?:from|import)\s*["']\.\/([^"']+\.js)["']/g;
  let match;
  while ((match = importPattern.exec(source))) {
    dependencies.add(match[1]);
  }
  return dependencies;
}

async function readChunkGraph(entryFile, availableFiles, includeDynamic = true) {
  const pending = [entryFile];
  const visited = new Set();
  const sources = [];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    const source = await readAsset(file);
    sources.push(source);
    for (const dependency of findJavaScriptDependencies(source, includeDynamic)) {
      if (availableFiles.has(dependency) && !visited.has(dependency)) {
        pending.push(dependency);
      }
    }
  }

  return { source: sources.join("\n"), files: visited };
}

test("admin source does not reverse-import the public application", async () => {
  const adminSource = await readFile(
    new URL("../../src/AdminApp.tsx", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(
    adminSource,
    /from\s+["']\.\/App["']/,
    "AdminApp.tsx must import shared or admin-only modules instead of App.tsx"
  );
});

test("route-only applications stay out of the public entry chunk", async () => {
  const indexHtml = await readFile(new URL("../../dist/index.html", import.meta.url), "utf8");
  const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/(index-[^"]+\.js)"/);
  assert.ok(entryMatch, "dist/index.html should reference the public entry chunk");

  const files = await readdir(distAssets);
  const routeChunks = [
    files.find((file) => /^AdminApp-.*\.js$/.test(file)),
    files.find((file) => /^MarkdownContent-.*\.js$/.test(file))
  ];
  assert.equal(routeChunks.every(Boolean), true, "missing a route-only chunk");

  const entry = await readAsset(entryMatch[1]);
  for (const chunk of routeChunks) {
    assert.equal(entry.includes(chunk), true, `${chunk} is not dynamically referenced by the entry`);
  }
  const allJavaScript = (
    await Promise.all(
      files.filter((file) => file.endsWith(".js")).map((file) =>
        readFile(new URL(file, distAssets), "utf8")
      )
    )
  ).join("\n");
  for (const endpoint of ["/api/submission-settings", "/api/submission-check"]) {
    assert.equal(entry.includes(endpoint), true, `${endpoint} is missing from the public entry chunk`);
  }
  for (const endpoint of [
    "/api/github/login",
    "/api/github/callback",
    "/api/github/me",
    "/api/github/logout",
    "/api/submissions"
  ]) {
    assert.equal(allJavaScript.includes(endpoint), false, `${endpoint} remains in the build`);
  }

  const adminChunk = routeChunks[0];
  const adminGraph = await readChunkGraph(adminChunk, new Set(files));
  for (const marker of ["/api/admin/", "factory-reset"]) {
    assert.equal(entry.includes(marker), false, `${marker} leaked into the public entry chunk`);
    assert.equal(adminGraph.source.includes(marker), true, `${marker} is missing from the admin chunk graph`);
  }
});

test("admin initial loading defers the Markdown renderer until a preview opens", async () => {
  const files = new Set(await readdir(distAssets));
  const adminChunk = [...files].find((file) => /^AdminApp-.*\.js$/.test(file));
  const markdownChunk = [...files].find((file) => /^MarkdownContent-.*\.js$/.test(file));
  assert.ok(adminChunk && markdownChunk, "admin and Markdown chunks must exist");
  const initial = await readChunkGraph(adminChunk, files, false);
  const withPreviews = await readChunkGraph(adminChunk, files);
  assert.equal(initial.files.has(markdownChunk), false, "Markdown must not enter the static admin dependency graph");
  assert.equal(withPreviews.files.has(markdownChunk), true, "admin previews must still be able to load Markdown");
});

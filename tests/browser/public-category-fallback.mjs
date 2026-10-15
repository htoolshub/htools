import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { launchEdge, openPage, navigate, evaluate, closeBrowser, safeRemove } from "../../scripts/browser-regression.mjs";

// Only this script's headless browser receives synthetic GET responses.
// No server process, database, existing browser tab, or application file is changed.
const origin = process.argv.find((arg) => arg.startsWith("--origin="))?.slice(9) ?? "http://127.0.0.1:8788";
const temporaryRoot = resolve("tmp/browser-regression");
const profile = resolve(temporaryRoot, `category-check-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });

function installResponses() {
  localStorage.setItem("htools_locale", "en");
  const originalFetch = window.fetch.bind(window);
  const categoryFailure = new URLSearchParams(location.search).get("categoryFailure");
  const state = window.__categoryCheck = { failCategories: true, categories: 0, tools: [], articles: 0, writes: [] };
  const tools = Array.from({ length: 35 }, (_, index) => ({
    id: `category-check-${index + 1}`,
    name: `Category Check Tool ${String(index + 1).padStart(2, "0")}`,
    description: "Synthetic browser check",
    url: `https://example.invalid/tool/${index + 1}`,
    demoUrl: "",
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'/%3E",
    category: index < 20 ? "Check A" : "Check B",
    tags: [],
    featured: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  }));
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" }
  }));
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "GET") {
      state.writes.push(`${method} ${url.pathname}`);
      return Promise.reject(new Error("Browser check forbids API writes."));
    }
    if (url.pathname === "/api/categories") {
      state.categories += 1;
      if (state.failCategories && categoryFailure === "html") {
        return Promise.resolve(new Response("<html>Unavailable</html>"));
      }
      if (state.failCategories && categoryFailure === "payload") return json({});
      return state.failCategories
        ? json({ error: "Category service unavailable." }, 500)
        : json({
          categories: [{ category: "Check A", total: 20, featured_total: 0 }, { category: "Check B", total: 15, featured_total: 0 }],
          settings: { tools: ["Check A", "Check B"], articles: [], push: [], content: [] }
        });
    }
    if (url.pathname === "/api/tools") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 16);
      const category = url.searchParams.get("category");
      const matches = tools.filter((tool) => !category || tool.category === category);
      const offset = (page - 1) * limit;
      state.tools.push({ page, limit, category, counts: url.searchParams.get("counts") });
      return json({ tools: matches.slice(offset, offset + limit), hasMore: offset + limit < matches.length,
        limit, nextCursor: null, total: null, categoryCounts: null, featuredTotal: null });
    }
    if (url.pathname === "/api/articles") {
      state.articles += 1;
      return json({ articles: [], hasMore: false, limit: 20, nextCursor: null, total: 0, categoryCounts: {} });
    }
    if (url.pathname === "/api/site-settings") return json({ settings: {
      name: "HTools", subtitle: "Tool directory", iconUrl: "", aboutContent: { zh: "", en: "" }
    }, umami: { enabled: false, scriptUrl: "", websiteId: "" } });
    if (url.pathname === "/api/proxy-settings") return json({ settings: {
      enabled: false, baseUrl: "", mode: "path", scope: "all"
    } });
    return json({ error: `Unexpected read: ${url.pathname}` }, 404);
  };
}

function readState() {
  const nav = document.querySelector(".category-pagination");
  const retry = [...document.querySelectorAll('button')].find((button) =>
    /retry|try again|reload|重试|重新加载/i.test(button.textContent));
  return {
    titles: [...document.querySelectorAll(".tool-grid .tool-title-link")].map((item) => item.textContent.trim()),
    categories: [...document.querySelectorAll(".category-rail .category-item")].map((item) => item.textContent.trim()),
    page: nav?.querySelector('[aria-current="page"]')?.textContent.trim() ?? null,
    pageNumbers: nav ? [...nav.querySelectorAll('button')].map((button) => button.textContent.trim()).filter((value) => /^\d+$/.test(value)) : [],
    nav: Boolean(nav),
    nextEnabled: Boolean(nav?.querySelector('[aria-label="Next page"]:not(:disabled)')),
    previousEnabled: Boolean(nav?.querySelector('[aria-label="Previous page"]:not(:disabled)')),
    retry: Boolean(retry),
    hero: document.querySelector(".hero-pill")?.textContent.trim() ?? null,
    requests: structuredClone(window.__categoryCheck)
  };
}

let browser;
let client;
const results = [];
try {
  browser = await launchEdge(profile);
  ({ client } = await openPage(browser));
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installResponses.toString()})()` });
  const snapshot = () => evaluate(client, `(${readState.toString()})()`);
  async function until(predicate, label) {
    const deadline = Date.now() + 6000;
    let state;
    do {
      state = await snapshot();
      if (predicate(state)) return state;
      await new Promise((done) => setTimeout(done, 75));
    } while (Date.now() < deadline);
    throw new Error(`${label}: ${JSON.stringify(state)}`);
  }
  async function clickArrow(label) {
    await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.category-pagination button')].find((item) =>
        item.getAttribute('aria-label') === ${JSON.stringify(label)} && !item.disabled);
      if (!button) throw new Error('Missing enabled pagination arrow: ' + ${JSON.stringify(label)});
      button.click();
    })()`);
  }
  async function retryCategories() {
    await evaluate(client, `(() => {
      window.__categoryCheck.failCategories = false;
      const button = [...document.querySelectorAll('button')].find((item) => /retry|try again|reload|重试|重新加载/i.test(item.textContent));
      if (!button) throw new Error('Missing category retry action');
      button.click();
    })()`);
  }

  for (const failure of ["http", "html", "payload"]) {
    await navigate(client, `${origin}/tools?categoryFailure=${failure}`);
    const first = await until((state) => state.titles.length === 16 && state.requests.categories === 1 && state.retry, `Initial tools (${failure})`);
    assert.equal(first.nextEnabled, true, "Unknown counts must retain Next");
    assert.equal(first.previousEnabled, false);
    await clickArrow("Next page");
    await until((state) => state.titles[0] === "Category Check Tool 17", "Second page");
    await clickArrow("Next page");
    const last = await until((state) => state.titles.length === 3, "Last page");
    assert.equal(last.nextEnabled, false, "Last unknown-count page must stop at hasMore=false");
    assert.equal(last.previousEnabled, true, "Last page must retain Previous");
    await clickArrow("Previous page");
    const beforeRetry = await until((state) => state.titles[0] === "Category Check Tool 17", "Return to page two");
    await retryCategories();
    const recovered = await until((state) => state.categories.includes("Check B") && !state.retry, "Category recovery");
    assert.deepEqual(recovered.titles, beforeRetry.titles, "Retry must preserve the current tool page");
    assert.deepEqual(recovered.requests.tools, beforeRetry.requests.tools, "Category retry must not refetch tools");
    assert.deepEqual(recovered.pageNumbers, ["1", "2", "3"]);
    assert.equal(recovered.page, "2");
    assert.equal(recovered.requests.categories, 2);
    assert.deepEqual(recovered.requests.writes, []);
    results.push({ scenario: `${failure}: unknown counts, last page, retry recovery`, passed: true });
  }

  await navigate(client, `${origin}/`);
  const home = await until((state) => state.hero && state.requests.categories === 1 && state.requests.tools.length === 1, "Home failure");
  assert.doesNotMatch(home.hero, /\b0\b/, "Unknown category count must not be presented as zero");
  assert.equal(home.retry, true, "Home must expose the same category retry");
  await retryCategories();
  const recoveredHome = await until((state) => /\b2\b/.test(state.hero) && !state.retry, "Home recovery");
  assert.equal(recoveredHome.requests.tools.length, 1, "Home retry must not refetch tools");
  assert.equal(recoveredHome.requests.articles, 1, "Home retry must not refetch articles");
  assert.deepEqual(recoveredHome.requests.writes, []);
  results.push({ scenario: "home unknown count and retry recovery", passed: true });
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  client?.close();
  await closeBrowser(browser);
  await safeRemove(temporaryRoot, profile);
}

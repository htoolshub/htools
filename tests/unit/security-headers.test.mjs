import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const builds = await Promise.all([
  "../../functions/_middleware.ts",
  "../../functions/api/_middleware.ts",
  "../../functions/[[path]].ts"
].map((path) => compileTypescriptModule(new URL(path, import.meta.url))));
const [middleware, apiMiddleware, fallback] = await Promise.all(
  builds.map((build) => import(build.url.href))
);
after(() => Promise.all(builds.map((build) => build.cleanup())));

async function requestPage(path, {
  nextStatus = 200,
  nextStatusText = "",
  nextHeaders = {},
  nextBody = nextStatus === 404 ? "missing" : "asset",
  method = "GET",
  directRoute = false
} = {}) {
  const fallbackRequests = [];
  const context = {
    request: new Request(`https://htools.example${path}`, { method }),
    env: {
      ASSETS: {
        async fetch(request) {
          fallbackRequests.push(new URL(request.url).pathname);
          return new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
        }
      }
    },
    async next() {
      return new Response(nextBody, {
        status: nextStatus,
        statusText: nextStatusText,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
          ...nextHeaders
        }
      });
    }
  };
  // Pages 的具名路由直接返回响应，不会再执行 [[path]] 回退路由。
  const nextRoute = () => directRoute ? context.next() : fallback.onRequest(context);
  const response = await middleware.onRequest({
    ...context,
    next: () => path.startsWith("/api/")
      ? apiMiddleware.onRequest({ ...context, next: nextRoute })
      : nextRoute()
  });
  return { response, fallbackRequests };
}

test("后台页面禁止被嵌入，并保留不收录与原有响应", async () => {
  for (const [path, nextStatus] of [
    ["/admin", 200],
    ["/admin/", 200],
    ["/admin/settings/site", 404],
    ["/admin/push", 404]
  ]) {
    const { response, fallbackRequests } = await requestPage(path, { nextStatus });
    assert.equal(response.headers.get("X-Frame-Options"), "DENY", path);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
    assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin", path);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive", path);
    assert.equal(response.headers.get("Cache-Control"), nextStatus === 404 ? null : "no-cache", path);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), nextStatus === 404 ? "<!doctype html>" : "asset", path);
    assert.deepEqual(fallbackRequests, nextStatus === 404 ? ["/index.html"] : [], path);
  }
});

test("前台与静态资源不禁止嵌入，但同样带基础安全头", async () => {
  for (const [path, robots] of [
    ["/", null],
    ["/tools/dev", null],
    ["/articles/hello", null],
    ["/administrator", "noindex, nofollow, noarchive"],
    ["/assets/index.js", null]
  ]) {
    const { response } = await requestPage(path);
    assert.equal(response.headers.get("X-Frame-Options"), null, path);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
    assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin", path);
    assert.equal(response.headers.get("X-Robots-Tag"), robots, path);
    assert.equal(await response.text(), "asset", path);
  }
});

test("具名 API 路由保留状态、正文与已有响应头，并统一附加安全头", async () => {
  for (const nextStatus of [200, 204, 302, 304, 401, 500]) {
    const nextBody = [204, 304].includes(nextStatus) ? null : JSON.stringify({ status: nextStatus });
    const { response, fallbackRequests } = await requestPage("/api/tools", {
      directRoute: true,
      nextStatus,
      nextStatusText: "Original response",
      nextBody,
      nextHeaders: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        ETag: '"original-etag"',
        Vary: "Accept-Encoding",
        ...(nextStatus === 302 ? { Location: "/api/next" } : {})
      }
    });
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", String(nextStatus));
    assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(response.headers.get("X-Frame-Options"), null);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
    assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    assert.equal(response.headers.get("ETag"), '"original-etag"');
    assert.equal(response.headers.get("Vary"), "Accept-Encoding");
    assert.equal(response.headers.get("Location"), nextStatus === 302 ? "/api/next" : null);
    assert.equal(response.status, nextStatus);
    assert.equal(response.statusText, "Original response");
    assert.equal(await response.text(), nextBody ?? "");
    assert.deepEqual(fallbackRequests, []);
  }
});

test("具名订阅、站点地图和默认数据路由同样带基础安全头", async () => {
  for (const path of ["/htools.json", "/rss.xml", "/rss.json", "/sitemap.xml", "/robots.txt"]) {
    const { response, fallbackRequests } = await requestPage(path, { directRoute: true });
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
    assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin", path);
    assert.equal(response.headers.get("X-Frame-Options"), null, path);
    assert.equal(response.headers.get("X-Robots-Tag"), null, path);
    assert.equal(response.headers.get("Cache-Control"), "no-cache", path);
    assert.equal(await response.text(), "asset", path);
    assert.deepEqual(fallbackRequests, [], path);
  }
});

test("不存在的 API 保持 JSON 404 和不收录规则", async () => {
  const { response, fallbackRequests } = await requestPage("/api/unknown", { nextStatus: 404 });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-cache");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("X-Frame-Options"), null);
  assert.deepEqual(await response.json(), { error: "API endpoint not found.", code: "NOT_FOUND" });
  assert.deepEqual(fallbackRequests, []);
});

test("非 GET 请求和资源 404 保持原状态码", async () => {
  const post = await requestPage("/admin", { method: "POST", nextStatus: 405 });
  assert.equal(post.response.status, 405);
  assert.equal(post.response.headers.get("X-Frame-Options"), "DENY");
  assert.deepEqual(post.fallbackRequests, []);

  const missingAsset = await requestPage("/assets/missing.js", { nextStatus: 404 });
  assert.equal(missingAsset.response.status, 404);
  assert.deepEqual(missingAsset.fallbackRequests, []);
});

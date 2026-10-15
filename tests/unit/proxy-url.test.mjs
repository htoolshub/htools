import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledProxy = await compileTypescriptModule(
  new URL("../../src/proxy.ts", import.meta.url)
);
const proxy = await import(`${compiledProxy.url.href}?proxy-url=1`);

after(async () => {
  await compiledProxy.cleanup();
});

function settings(overrides = {}) {
  return {
    enabled: true,
    baseUrl: "https://proxy.example.com/",
    mode: "prefix",
    scope: "all",
    ...overrides
  };
}

test("proxy mode and scope fall back to their defaults for any unknown value", () => {
  for (const mode of ["prefix", "edgeone-proxy", "edgeone-advanced"]) {
    assert.equal(proxy.normalizeProxyMode(mode), mode);
  }
  for (const value of ["PREFIX", "", "unknown", undefined, null, 0, {}, []]) {
    assert.equal(proxy.normalizeProxyMode(value), "prefix");
  }

  for (const scope of ["all", "images"]) {
    assert.equal(proxy.normalizeProxyScope(scope), scope);
  }
  for (const value of ["IMAGES", "", "unknown", undefined, null, 0, {}, []]) {
    assert.equal(proxy.normalizeProxyScope(value), "all");
  }

  assert.equal(proxy.DEFAULT_PROXY_MODE, "prefix");
  assert.equal(proxy.DEFAULT_PROXY_SCOPE, "all");
});

test("proxy base URLs gain https, keep their subpath, and drop query or hash", () => {
  assert.equal(
    proxy.normalizeProxyBaseUrl("proxy.example.com"),
    "https://proxy.example.com/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("//proxy.example.com"),
    "https://proxy.example.com/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("https://proxy.example.com"),
    "https://proxy.example.com/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("https://proxy.example.com/base"),
    "https://proxy.example.com/base/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("https://proxy.example.com/base/"),
    "https://proxy.example.com/base/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("https://proxy.example.com/a/b/c"),
    "https://proxy.example.com/a/b/c/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("http://localhost:8788"),
    "http://localhost:8788/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("HTTPS://Proxy.Example.COM/Base"),
    "https://proxy.example.com/Base/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("https://proxy.example.com/?q=1"),
    "https://proxy.example.com/"
  );
  assert.equal(
    proxy.normalizeProxyBaseUrl("https://proxy.example.com/#frag"),
    "https://proxy.example.com/"
  );
});

test("proxy base URLs reject empty, malformed, and non-HTTP values", () => {
  for (const value of [
    "",
    "   ",
    "not a url",
    "ftp://proxy.example.com",
    "javascript:alert(1)",
    "data:text/html,x"
  ]) {
    assert.equal(proxy.normalizeProxyBaseUrl(value), "");
  }
});

test("disabled or unusable proxy settings leave the URL untouched", () => {
  const target = "https://tool.example.com/page";

  assert.equal(proxy.proxifyUrl(target, settings({ enabled: false })), target);
  assert.equal(proxy.proxifyUrl(target, settings({ baseUrl: "" })), target);
  assert.equal(proxy.proxifyUrl(target, settings({ baseUrl: "   " })), target);
  assert.equal(
    proxy.proxifyUrl(target, settings({ baseUrl: "ftp://proxy.example.com" })),
    target
  );
  assert.equal(proxy.proxifyUrl("   ", settings()), "");
});

test("image-only scope proxies images and leaves links alone", () => {
  const imageScope = settings({ scope: "images" });

  assert.equal(
    proxy.proxifyUrl("https://tool.example.com/i.png", imageScope, {
      resourceType: "image"
    }),
    "https://proxy.example.com/https://tool.example.com/i.png"
  );
  for (const options of [undefined, {}, { resourceType: undefined }, { resourceType: "link" }]) {
    assert.equal(
      proxy.proxifyUrl("https://tool.example.com/page", imageScope, options),
      "https://tool.example.com/page"
    );
  }
  assert.equal(
    proxy.proxifyUrl("https://tool.example.com/page", settings(), {
      resourceType: "link"
    }),
    "https://proxy.example.com/https://tool.example.com/page"
  );
});

test("only HTTP and HTTPS targets are ever rewritten", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "mailto:someone@example.com",
    "tel:+123456",
    "/relative/path",
    "//cdn.example.com/a.png",
    "#anchor",
    "not a url"
  ]) {
    assert.equal(proxy.proxifyUrl(value, settings()), value);
  }
});

test("each proxy mode builds its own URL shape", () => {
  const target = "https://tool.example.com/page?q=1#section";

  assert.equal(
    proxy.proxifyUrl(target, settings({ mode: "prefix" })),
    `https://proxy.example.com/${target}`
  );
  assert.equal(
    proxy.proxifyUrl(target, settings({ mode: "edgeone-proxy" })),
    "https://proxy.example.com/proxy?url=https%3A%2F%2Ftool.example.com%2Fpage%3Fq%3D1%23section"
  );
  assert.equal(
    proxy.proxifyUrl(target, settings({ mode: "edgeone-advanced" })),
    "https://proxy.example.com/advanced-proxy?url=https%3A%2F%2Ftool.example.com%2Fpage%3Fq%3D1%23section"
  );
  assert.equal(
    proxy.proxifyUrl(target, settings({ mode: "unknown" })),
    `https://proxy.example.com/${target}`
  );
});

test("proxy base subpaths survive both prefix and query modes", () => {
  const target = "https://tool.example.com/page";

  assert.equal(
    proxy.proxifyUrl(target, settings({ baseUrl: "https://proxy.example.com/base/" })),
    `https://proxy.example.com/base/${target}`
  );
  assert.equal(
    proxy.proxifyUrl(
      target,
      settings({ baseUrl: "https://proxy.example.com/base/", mode: "edgeone-proxy" })
    ),
    "https://proxy.example.com/base/proxy?url=https%3A%2F%2Ftool.example.com%2Fpage"
  );
  assert.equal(
    proxy.proxifyUrl(
      target,
      settings({ baseUrl: "https://proxy.example.com/a/b/", mode: "edgeone-proxy" })
    ),
    "https://proxy.example.com/a/b/proxy?url=https%3A%2F%2Ftool.example.com%2Fpage"
  );
});

test("proxy base URLs are normalized before use, so raw settings still work", () => {
  const target = "https://tool.example.com/page";

  for (const baseUrl of [
    "proxy.example.com",
    "  https://proxy.example.com/  ",
    "https://proxy.example.com"
  ]) {
    assert.equal(
      proxy.proxifyUrl(target, settings({ baseUrl })),
      `https://proxy.example.com/${target}`
    );
  }

  assert.equal(
    proxy.proxifyUrl(target, settings({ baseUrl: "proxy.example.com", mode: "edgeone-proxy" })),
    "https://proxy.example.com/proxy?url=https%3A%2F%2Ftool.example.com%2Fpage"
  );
  assert.equal(
    proxy.proxifyUrl(
      target,
      settings({ baseUrl: "https://proxy.example.com/?k=v", mode: "edgeone-proxy" })
    ),
    "https://proxy.example.com/proxy?url=https%3A%2F%2Ftool.example.com%2Fpage"
  );
  assert.equal(
    proxy.proxifyUrl(
      target,
      settings({ baseUrl: "https://proxy.example.com/#h", mode: "edgeone-proxy" })
    ),
    "https://proxy.example.com/proxy?url=https%3A%2F%2Ftool.example.com%2Fpage"
  );
});

test("same-origin resources skip the proxy only when a browser origin is known", () => {
  const previousWindow = globalThis.window;

  try {
    delete globalThis.window;
    assert.equal(
      proxy.proxifyUrl("https://site.example.com/x", settings()),
      "https://proxy.example.com/https://site.example.com/x"
    );

    globalThis.window = { location: { origin: "https://site.example.com" } };
    assert.equal(
      proxy.proxifyUrl("https://site.example.com/x", settings()),
      "https://site.example.com/x"
    );
    assert.equal(
      proxy.proxifyUrl("https://other.example.com/x", settings()),
      "https://proxy.example.com/https://other.example.com/x"
    );
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("targets are canonicalized by URL parsing before being proxied", () => {
  assert.equal(
    proxy.proxifyUrl("  https://tool.example.com/page  ", settings()),
    "https://proxy.example.com/https://tool.example.com/page"
  );
  assert.equal(
    proxy.proxifyUrl("https://tool.example.com", settings()),
    "https://proxy.example.com/https://tool.example.com/"
  );
  assert.equal(
    proxy.proxifyUrl("https://TOOL.example.com/Page", settings()),
    "https://proxy.example.com/https://tool.example.com/Page"
  );
  assert.equal(
    proxy.proxifyUrl("https://tool.example.com:443/page", settings()),
    "https://proxy.example.com/https://tool.example.com/page"
  );
  assert.equal(
    proxy.proxifyUrl("https://tool.example.com:8443/page", settings()),
    "https://proxy.example.com/https://tool.example.com:8443/page"
  );
  assert.equal(
    proxy.proxifyUrl("https://tool.example.com/文件.png", settings(), {
      resourceType: "image"
    }),
    "https://proxy.example.com/https://tool.example.com/%E6%96%87%E4%BB%B6.png"
  );
});

test("missing optional settings fields fall back instead of disabling the proxy", () => {
  const target = "https://tool.example.com/page";

  assert.equal(
    proxy.proxifyUrl(target, {
      enabled: true,
      baseUrl: "https://proxy.example.com/",
      scope: "all"
    }),
    `https://proxy.example.com/${target}`
  );
  assert.equal(
    proxy.proxifyUrl(target, {
      enabled: true,
      baseUrl: "https://proxy.example.com/",
      mode: "prefix"
    }),
    `https://proxy.example.com/${target}`
  );
});

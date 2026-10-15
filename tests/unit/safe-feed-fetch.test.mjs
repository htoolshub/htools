import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const compiledTimeoutShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url),
  {
    transformSource: (source) =>
      source.replace(
        "const FEED_REQUEST_TIMEOUT_MS = 15_000;",
        "const FEED_REQUEST_TIMEOUT_MS = 50;"
      )
  }
);
const shared = await import(`${compiledShared.url.href}?feed=1`);
const timeoutShared = await import(`${compiledTimeoutShared.url.href}?feed=timeout`);

after(() => Promise.all([compiledShared.cleanup(), compiledTimeoutShared.cleanup()]));

const feedXml = `<?xml version="1.0"?><rss><channel><title>Test Feed</title><link>https://example.com/</link><item><guid>item-1</guid><title>Item One</title><link>https://example.com/item-1</link><description>Body</description></item></channel></rss>`;

async function errorMessage(run) {
  try {
    await run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test("feed fetching enforces URL, redirect, size, type and timeout limits", async () => {
  const originalFetch = globalThis.fetch;
  let handler = async () =>
    new Response(feedXml, { headers: { "content-type": "application/rss+xml" } });
  let fetchCalls = 0;
  globalThis.fetch = async (url, init) => {
    fetchCalls += 1;
    return handler(String(url), init);
  };

  try {
    const normal = await shared.fetchFeedPreview("https://example.com/feed.xml");
    assert.equal(normal.title, "Test Feed");
    assert.equal(normal.items.length, 1);

    fetchCalls = 0;
    assert.equal(
      await errorMessage(() => shared.fetchFeedPreview("http://127.0.0.1/feed.xml")),
      "Feed URL is not allowed."
    );
    assert.equal(fetchCalls, 0);
    assert.equal(
      await errorMessage(() => shared.fetchFeedPreview("http://[ff02::1]/feed.xml")),
      "Feed URL is not allowed."
    );
    assert.equal(
      await errorMessage(() =>
        shared.fetchFeedPreview("http://[2002:7f00:1::]/feed.xml")
      ),
      "Feed URL is not allowed."
    );

    let redirectStep = 0;
    handler = async () => {
      redirectStep += 1;
      if (redirectStep === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/path/feed.xml" }
        });
      }
      return new Response(
        `<?xml version="1.0"?><rss><channel><title>Redirect Feed</title><item><guid>redirect-1</guid><title>Redirect Item</title><link>item-1</link><description>Body</description></item></channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } }
      );
    };
    const redirected = await shared.fetchFeedPreview(
      "https://example.com/old/feed.xml"
    );
    assert.equal(redirected.items[0].url, "https://cdn.example.com/path/item-1");

    handler = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" }
      });
    assert.equal(
      await errorMessage(() => shared.fetchFeedPreview("https://example.com/redirect")),
      "Feed redirect URL is not allowed."
    );

    handler = async () =>
      new Response("small", {
        headers: {
          "content-type": "application/rss+xml",
          "content-length": String(6 * 1024 * 1024)
        }
      });
    assert.equal(
      await errorMessage(() => shared.fetchFeedPreview("https://example.com/large")),
      "Feed response is too large."
    );

    handler = async () =>
      new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
        headers: { "content-type": "application/xml" }
      });
    assert.equal(
      await errorMessage(() => shared.fetchFeedPreview("https://example.com/stream")),
      "Feed response is too large."
    );

    handler = async () =>
      new Response("binary", { headers: { "content-type": "image/png" } });
    assert.equal(
      await errorMessage(() => shared.fetchFeedPreview("https://example.com/image")),
      "Feed response type is not supported."
    );

    handler = async (_url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    assert.equal(
      await errorMessage(() =>
        timeoutShared.fetchFeedPreview("https://example.com/slow")
      ),
      "Feed request timed out."
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

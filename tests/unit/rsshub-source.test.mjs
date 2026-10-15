import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledRssHub = await compileTypescriptModule(
  new URL("../../shared/rsshub.ts", import.meta.url)
);
const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const rssHub = await import(`${compiledRssHub.url.href}?rsshub=1`);
const shared = await import(`${compiledShared.url.href}?rsshub=1`);

after(() => Promise.all([compiledRssHub.cleanup(), compiledShared.cleanup()]));

function createSettingsDb(value) {
  let savedValue = "";
  return {
    get savedValue() {
      return savedValue;
    },
    prepare() {
      return {
        bind(_key, nextValue) {
          if (typeof nextValue === "string") savedValue = nextValue;
          return this;
        },
        first() {
          return Promise.resolve(value ? { value: JSON.stringify(value) } : null);
        },
        run() {
          return Promise.resolve({ success: true });
        }
      };
    }
  };
}

test("Folo RSSHub routes normalize and resolve against the configured service", () => {
  const route = "rsshub://epicgames/freegames/en-US/US";
  assert.equal(rssHub.normalizeRssHubRouteUrl(` ${route}/ `), route);
  assert.equal(
    rssHub.resolveRssHubRouteUrl(route, "https://rsshub.example.com/base"),
    "https://rsshub.example.com/base/epicgames/freegames/en-US/US"
  );
  assert.equal(rssHub.normalizeRssHubRouteUrl("rsshub://../private"), "");
  assert.equal(rssHub.normalizeRssHubRouteUrl("https://example.com/feed.xml"), "");
});

test("content source validation accepts RSSHub routes without changing normal RSS URLs", () => {
  assert.equal(
    shared.validateContentSourcePayload({
      url: "rsshub://epicgames/freegames/en-US/US/",
      category: "Games"
    }).url,
    "rsshub://epicgames/freegames/en-US/US"
  );
  assert.equal(
    shared.validateContentSourcePayload({
      url: "https://example.com/feed.xml",
      category: "News"
    }).url,
    "https://example.com/feed.xml"
  );
});

test("RSSHub routes use the enabled default service and respect the service switch", async () => {
  const route = "rsshub://epicgames/freegames/en-US/US";
  assert.equal(
    await shared.resolveContentSourceFetchUrl(createSettingsDb(null), route),
    "https://rsshub.rssforever.com/epicgames/freegames/en-US/US"
  );
  await assert.rejects(
    shared.resolveContentSourceFetchUrl(createSettingsDb({
      enabled: false,
      baseUrl: "https://rsshub.example.com/"
    }), route),
    /RSSHub service is disabled\./
  );
  assert.equal(
    await shared.resolveContentSourceFetchUrl(
      createSettingsDb({ baseUrl: "https://rsshub.example.com/" }),
      route
    ),
    "https://rsshub.example.com/epicgames/freegames/en-US/US"
  );
  assert.equal(
    await shared.resolveContentSourceFetchUrl(
      createSettingsDb(null),
      "https://example.com/feed.xml"
    ),
    "https://example.com/feed.xml"
  );
});

test("RSSHub settings reject private hosts and normalize saved service URLs", async () => {
  await assert.rejects(
    shared.saveRssHubSettings(createSettingsDb(null), {
      enabled: true,
      baseUrl: "http://127.0.0.1:1200/"
    }),
    /RSSHub base URL must be a public http\/https URL\./
  );

  const db = createSettingsDb(null);
  const settings = await shared.saveRssHubSettings(db, {
    enabled: false,
    baseUrl: "https://rsshub.example.com/base"
  });
  assert.deepEqual(settings, {
    enabled: false,
    baseUrl: "https://rsshub.example.com/base/"
  });
  assert.match(db.savedValue, /https:\/\/rsshub\.example\.com\/base\//);

  assert.deepEqual(
    await shared.saveRssHubSettings(createSettingsDb(null), {
      enabled: true,
      baseUrl: ""
    }),
    {
      enabled: true,
      baseUrl: "https://rsshub.rssforever.com/"
    }
  );
});

test("RSSHub settings stay inside full backup and the shared service card", async () => {
  const [backup, admin, card] = await Promise.all([
    readFile(new URL("../../functions/api/admin/backup.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../src/components/admin-settings/RssHubSettingsCard.tsx", import.meta.url),
      "utf8"
    )
  ]);
  assert.match(backup, /"rsshub_settings"/);
  assert.match(card, /export function RssHubSettingsCard\(/);
  assert.match(admin, /<RssHubSettingsCard[\s\S]*?token=\{token\}/);
  assert.match(admin, /normalizeRssHubRouteUrl\(contentSourceForm\.url\)/);
});

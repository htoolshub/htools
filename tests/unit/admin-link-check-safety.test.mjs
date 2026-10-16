import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
const sharedBuild = await compileTypescriptModule(new URL("../../functions/_shared.ts", import.meta.url));
const shared = await import(sharedBuild.url.href);
const routeBuild = await compileTypescriptModule(
  new URL("../../functions/api/admin/link-check.ts", import.meta.url),
  { importReplacements: { "../../_shared": sharedBuild.url.href } }
);
const linkCheck = await import(routeBuild.url.href);
after(async () => {
  await routeBuild.cleanup();
  await sharedBuild.cleanup();
});

const BLOCKED = "URL is not allowed for server-side checking.";

function fixture(t, tools) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  for (const [id, url] of tools) {
    sqlite.prepare("INSERT INTO tools (id, name, description, url, image, category) VALUES (?, ?, '', ?, '', 'Tools')")
      .run(id, id, url);
  }
  const state = { failKey: null };
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async first() {
          if (state.failKey && values[0] === state.failKey) throw new Error("D1_ERROR: simulated");
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; }
      };
    }
  };
  return { state, env: { DB: db, ADMIN_PASSWORD: "test-password" } };
}

async function checkLinks(env, links) {
  return postLinkCheck(env, { links, timeout: 3 });
}

async function postLinkCheck(env, payload) {
  const token = await shared.createToken(env);
  return linkCheck.onRequestPost({
    env,
    request: new Request("https://example.com/api/admin/link-check", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  });
}

function mockFetch(t, routes) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, redirect: init.redirect });
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route();
  });
  return calls;
}

test("IPv6 字面量与内网主机名在发起请求前被拒绝", async (t) => {
  const tools = [
    ["ipv6-loopback", "http://[::1]:8788/"],
    ["ipv6-private", "http://[fd00::1]/"],
    ["ipv4-mapped", "http://[::ffff:127.0.0.1]/"],
    ["local-name", "http://router.local/"]
  ];
  const { env } = fixture(t, tools);
  const calls = mockFetch(t, {});
  const response = await checkLinks(env, tools.map(([id]) => ({ id, kind: "url" })));
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(results.map((result) => [result.id, result.ok, result.error]),
    tools.map(([id]) => [id, false, BLOCKED]));
  assert.deepEqual(calls, []);
});

test("公网地址跳转到内网时停止跟随，不访问内网目标", async (t) => {
  const start = "https://public.example/start";
  const { env } = fixture(t, [["redirect", start]]);
  await shared.saveProxySettings(env, { enabled: true, baseUrl: "https://proxy.example/", mode: "prefix", scope: "all" });
  const calls = mockFetch(t, {
    [start]: () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:8788/admin" } })
  });
  const { results: [result] } = await (await checkLinks(env, [{ id: "redirect", kind: "url" }])).json();
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.error, BLOCKED);
  assert.deepEqual(calls, [{ url: start, redirect: "manual" }]);
});

test("公网之间的跳转逐跳校验后继续跟随，并返回最终地址", async (t) => {
  const start = "https://public.example/start";
  const { env } = fixture(t, [["redirect", start]]);
  const calls = mockFetch(t, {
    [start]: () => new Response(null, { status: 301, headers: { Location: "/next" } }),
    "https://public.example/next": () => new Response("ok", { status: 200 })
  });
  const { results: [result] } = await (await checkLinks(env, [{ id: "redirect", kind: "url" }])).json();
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, "https://public.example/next");
  assert.deepEqual(calls.map((call) => call.redirect), ["manual", "manual"]);
});

test("超过跳转上限时按失败处理", async (t) => {
  const { env } = fixture(t, [["loop", "https://public.example/0"]]);
  const routes = {};
  for (let index = 0; index <= 6; index += 1) {
    routes[`https://public.example/${index}`] = () =>
      new Response(null, { status: 302, headers: { Location: `/${index + 1}` } });
  }
  const calls = mockFetch(t, routes);
  const { results: [result] } = await (await checkLinks(env, [{ id: "loop", kind: "url" }])).json();
  assert.equal(result.ok, false);
  assert.equal(calls.length, 6);
});

test("提交内容有误返回 400，服务端读取失败返回 500", async (t) => {
  const { env, state } = fixture(t, [["tool", "https://public.example/"]]);
  mockFetch(t, {});

  for (const links of [[], [{ id: "tool", kind: "other" }], Array.from({ length: 11 }, () => ({ id: "tool", kind: "url" }))]) {
    const response = await checkLinks(env, links);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_REQUEST");
  }

  state.failKey = "proxy_settings";
  const failed = await checkLinks(env, [{ id: "tool", kind: "url" }]);
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).code, "SERVER_ERROR");
});

test("链接检测拒绝非对象请求体，且不读取代理设置或发起外部请求", async (t) => {
  const { env, state } = fixture(t, []);
  state.failKey = "proxy_settings";
  const calls = mockFetch(t, {});
  for (const payload of [null, [], [{}], "text", 0, false]) {
    const response = await postLinkCheck(env, payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal((await response.json()).code, "INVALID_REQUEST");
  }
  assert.deepEqual(calls, []);
});

test("链接检测拒绝对象、数组和布尔超时参数，不读取代理设置或发起外部请求", async (t) => {
  const { env, state } = fixture(t, [["tool", "https://public.example/"]]);
  state.failKey = "proxy_settings";
  const calls = mockFetch(t, {});
  for (const timeout of [{ toString: null }, { toString: "3" }, [{ toString: null }], {}, [], [3], true, false]) {
    const response = await postLinkCheck(env, { links: [{ id: "tool", kind: "url" }], timeout });
    assert.equal(response.status, 400, JSON.stringify(timeout));
    assert.equal((await response.json()).code, "INVALID_REQUEST");
  }
  assert.deepEqual(calls, []);
});

test("链接检测保留超时默认值、数字字符串、取整与上下限", async (t) => {
  const url = "https://public.example/";
  const { env } = fixture(t, [["tool", url]]);
  mockFetch(t, { [url]: () => new Response("ok") });
  const timeouts = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  for (const [timeout, seconds] of [[undefined, 6], [null, 6], [3, 3], ["3", 3],
    [3.6, 4], ["3.6", 4], [0, 1], [-2, 1], [20, 9], ["20", 9],
    ["bad", 6], ["Infinity", 6], ["", 1], [" 5 ", 5]]) {
    timeouts.length = 0;
    const response = await postLinkCheck(env, { links: [{ id: "tool", kind: "url" }], timeout });
    assert.equal(response.status, 200, JSON.stringify(timeout));
    assert.equal((await response.json()).results[0].ok, true);
    assert.deepEqual(timeouts, [seconds * 1000], JSON.stringify(timeout));
  }
});

for (const mode of ["prefix", "edgeone-proxy", "edgeone-advanced"]) {
  test(`${mode} 代理首个请求拒绝内网地址`, async (t) => {
    const start = "https://public.example/start";
    const { env } = fixture(t, [["tool", start]]);
    const routes = { [start]: () => { throw new Error("simulated network failure"); } };
    const calls = mockFetch(t, routes);
    for (const baseUrl of ["http://127.0.0.1:8788/", "http://[::1]/", "http://[fd00::1]/", "http://router.local/"]) {
      const settings = await shared.saveProxySettings(env, { enabled: true, baseUrl, mode, scope: "all" });
      routes[shared.proxifyUrl(start, settings)] = () => new Response("mock proxy");
      calls.length = 0;
      const { results: [result] } = await (await checkLinks(env, [{ id: "tool", kind: "url" }])).json();
      assert.equal(result.ok, false, baseUrl);
      assert.equal(result.status, 0, baseUrl);
      assert.equal(result.error, BLOCKED, baseUrl);
      assert.deepEqual(calls, [{ url: start, redirect: "manual" }], baseUrl);
    }
  });
}

test("公网代理回退仍可跟随公网跳转并成功返回", async (t) => {
  const start = "https://public.example/start";
  const { env } = fixture(t, [["tool", start]]);
  const settings = await shared.saveProxySettings(env, { enabled: true, baseUrl: "https://proxy.example/", mode: "prefix", scope: "all" });
  const proxyUrl = shared.proxifyUrl(start, settings);
  const calls = mockFetch(t, {
    [start]: () => { throw new Error("simulated network failure"); },
    [proxyUrl]: () => new Response(null, { status: 302, headers: { Location: "/finish" } }),
    "https://proxy.example/finish": () => new Response("ok")
  });
  const { results: [result] } = await (await checkLinks(env, [{ id: "tool", kind: "url" }])).json();
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(({ url }) => url), [start, proxyUrl, "https://proxy.example/finish"]);
  assert.ok(calls.every(({ redirect }) => redirect === "manual"));
});

test("公网代理跳向内网时停止请求并返回地址被拒绝", async (t) => {
  const start = "https://public.example/start";
  const { env } = fixture(t, [["tool", start]]);
  const settings = await shared.saveProxySettings(env, { enabled: true, baseUrl: "https://proxy.example/", mode: "prefix", scope: "all" });
  const proxyUrl = shared.proxifyUrl(start, settings);
  const calls = mockFetch(t, {
    [start]: () => { throw new Error("simulated network failure"); },
    [proxyUrl]: () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:8788/" } })
  });
  const { results: [result] } = await (await checkLinks(env, [{ id: "tool", kind: "url" }])).json();
  assert.equal(result.ok, false);
  assert.equal(result.error, BLOCKED);
  assert.deepEqual(calls.map(({ url }) => url), [start, proxyUrl]);
});

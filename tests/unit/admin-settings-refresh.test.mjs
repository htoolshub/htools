import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const hookUrl = moduleUrl(`
  let runtime;
  export const setRuntime = (value) => { runtime = value; };
  export const useState = (value) => runtime.useState(value);
  export const useRef = (value) => runtime.useRef(value);
  export const useEffect = (effect, dependencies) => runtime.useEffect(effect, dependencies);
`);
const apiUrl = moduleUrl(`
  let api;
  export const setApi = (value) => { api = value; };
  export const loadGitHubSettings = (...args) => api.load(...args);
  export const loadImageBedSettings = (...args) => api.load(...args);
  export const loadRssHubSettings = (...args) => api.load(...args);
  export const saveGitHubSettings = (...args) => api.save(...args);
  export const saveImageBedSettings = (...args) => api.save(...args);
  export const saveRssHubSettings = (...args) => api.save(...args);
`);
const { setRuntime } = await import(hookUrl);
const { setApi } = await import(apiUrl);
const replacements = {
  react: hookUrl,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../../admin-api": apiUrl,
  "../../site-helpers": moduleUrl("export const getLocalizedErrorMessage = (error) => error.message;"),
  "../../shared-ui": moduleUrl("export function SkeletonVisibility() {}"),
  "../../useLoadingSkeleton": moduleUrl("export const useLoadingSkeleton = (loading) => loading;"),
  "../../../shared/rsshub": moduleUrl("export const normalizeRssHubBaseUrl = (value) => value.trim();"),
  "../admin-skeletons": moduleUrl(`
    export function AdminSettingsActionsSkeleton() {}
    export function AdminSettingsCopySkeleton() {}
    export function AdminSettingsFieldSkeleton() {}
    export function AdminSettingsTextMask() {}
    export function GitHubSettingsFormSkeleton() {}
  `),
  "./SettingsStatusBadge": moduleUrl("export function SettingsStatusBadge() {}")
};

async function loadComponent(name) {
  const source = await readFile(new URL(`../../src/components/admin-settings/${name}.tsx`, import.meta.url), "utf8");
  let code = ts.transpileModule(source, {
    fileName: `${name}.tsx`,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  for (const [specifier, replacement] of Object.entries(replacements)) {
    code = code.replaceAll(`from "${specifier}"`, `from "${replacement}"`);
  }
  return (await import(moduleUrl(code)))[name];
}

// 执行真实组件的状态与事件回调；仅替换 React 挂载环境及网络请求。
function mount(Component, api) {
  const hooks = [];
  let index = 0;
  let dirty = false;
  let effects = [];
  let tree;
  let props = {
    maintenanceText: {}, t: { githubSettings: {}, actions: {} }, token: "local-test-token", reloadKey: 0,
    onDirtyChange() {}, onStatus() {}, setStatus() {}
  };
  const runtime = {
    useState(initial) {
      const slot = index++;
      hooks[slot] ??= { value: typeof initial === "function" ? initial() : initial };
      return [hooks[slot].value, (next) => {
        const value = typeof next === "function" ? next(hooks[slot].value) : next;
        if (!Object.is(value, hooks[slot].value)) dirty = true;
        hooks[slot].value = value;
      }];
    },
    useRef(initial) {
      const slot = index++;
      return hooks[slot] ??= { current: initial };
    },
    useEffect(effect, dependencies) {
      const slot = index++;
      const previous = hooks[slot];
      if (!previous || dependencies.some((value, item) => !Object.is(value, previous.dependencies[item]))) {
        hooks[slot] = { dependencies, cleanup: previous?.cleanup };
        effects.push(() => {
          hooks[slot].cleanup?.();
          hooks[slot].cleanup = effect();
        });
      }
    }
  };
  function render(nextProps = {}) {
    props = { ...props, ...nextProps };
    index = 0;
    dirty = false;
    effects = [];
    setRuntime(runtime);
    setApi(api);
    tree = Component(props);
    for (const effect of effects) effect();
  }
  render();
  return {
    render,
    async flush() {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        await Promise.resolve();
        if (dirty) render();
      }
    },
    find(predicate) {
      function walk(value) {
        if (Array.isArray(value)) return value.flatMap(walk);
        if (!value || typeof value !== "object") return [];
        return [...(predicate(value) ? [value] : []), ...walk(value.props?.children)];
      }
      return walk(tree);
    },
    unmount() { for (const hook of hooks) hook.cleanup?.(); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const cards = [
  { name: "GitHubSettingsForm", initial: { enabled: true, owner: "old-owner", repo: "old-repo", labels: [] }, restored: { enabled: false, owner: "new-owner", repo: "new-repo", labels: ["restored"] }, value: "new-owner" },
  { name: "ImageBedSettingsCard", initial: { available: true, enabled: true, baseUrl: "https://old.example/", uploadChannel: "telegram", channelName: "", uploadNameType: "default", uploadFolder: "old" }, restored: { available: true, enabled: false, baseUrl: "https://new.example/", uploadChannel: "s3", channelName: "new", uploadNameType: "origin", uploadFolder: "new" }, value: "https://new.example/" },
  { name: "RssHubSettingsCard", initial: { enabled: true, baseUrl: "https://old.example/" }, restored: { enabled: false, baseUrl: "https://new.example/" }, value: "https://new.example/" }
];

for (const card of cards) {
  const Component = await loadComponent(card.name);
  card.Component = Component;
  test(`${card.name} 在备份恢复刷新后同步新配置并替换旧草稿`, async () => {
    let saved = card.initial;
    let reads = 0;
    const mounted = mount(Component, { load: async () => { reads += 1; return saved; } });
    try {
      await mounted.flush();
      mounted.find((node) => node.type === "input")[0].props.onChange({ target: { value: "unsaved-draft" } });
      await mounted.flush();
      saved = card.restored;
      mounted.render({ reloadKey: 1 });
      await mounted.flush();
      assert.equal(reads, 2);
      assert.equal(mounted.find((node) => node.type === "input")[0].props.value, card.value);
      assert.equal(mounted.find((node) => node.type?.name === "SettingsStatusBadge")[0].props.enabled, false);
    } finally { mounted.unmount(); }
  });

  test(`${card.name} 忽略恢复前尚未完成的加载响应`, async () => {
    const pending = [];
    const mounted = mount(Component, { load: (_token, options) => {
      const request = { ...deferred(), signal: options.signal };
      pending.push(request);
      return request.promise;
    } });
    try {
      mounted.render({ reloadKey: 1 });
      await mounted.flush();
      assert.equal(pending.length, 2);
      assert.equal(pending[0].signal.aborted, true);
      pending[1].resolve(card.restored);
      await mounted.flush();
      pending[0].resolve(card.initial);
      await mounted.flush();
      assert.equal(mounted.find((node) => node.type === "input")[0].props.value, card.value);
    } finally { mounted.unmount(); }
  });

  test(`${card.name} 恢复后的配置不会被更早的手动重试响应覆盖`, async () => {
    const pending = [];
    const mounted = mount(Component, { load: () => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    } });
    try {
      pending[0].reject(new Error("本地模拟读取失败"));
      await mounted.flush();
      mounted.find((node) => node.type === "button")[0].props.onClick();
      await mounted.flush();
      mounted.render({ reloadKey: 1 });
      await mounted.flush();
      assert.equal(pending.length, 3);
      pending[2].resolve(card.restored);
      await mounted.flush();
      pending[1].resolve(card.initial);
      await mounted.flush();
      assert.equal(mounted.find((node) => node.type === "input")[0].props.value, card.value);
    } finally { mounted.unmount(); }
  });
}

test("GitHub 切换语言保留草稿，备份恢复读取失败后重试仍以恢复值替换旧草稿", async () => {
  const card = cards[0];
  let current = card.initial;
  let fail = false;
  const mounted = mount(card.Component, { load: async () => {
    if (fail) throw new Error("本地模拟读取失败");
    return current;
  } });
  try {
    await mounted.flush();
    mounted.find((node) => node.type === "input")[0].props.onChange({ target: { value: "unsaved-owner" } });
    await mounted.flush();
    mounted.render({ t: { githubSettings: {}, actions: {} } });
    await mounted.flush();
    assert.equal(mounted.find((node) => node.type === "input")[0].props.value, "unsaved-owner");
    current = card.restored;
    fail = true;
    mounted.render({ reloadKey: 1 });
    await mounted.flush();
    fail = false;
    mounted.find((node) => node.type === "button")[0].props.onClick();
    await mounted.flush();
    assert.equal(mounted.find((node) => node.type === "input")[0].props.value, card.value);
  } finally { mounted.unmount(); }
});

for (const fail of [false, true]) {
  test(`图床开关${fail ? "失败" : "成功"}时保留未保存的地址和目录`, async () => {
    const card = cards[1];
    let written;
    const mounted = mount(card.Component, {
      load: async () => card.initial,
      save: async (next) => {
        written = next;
        if (fail) throw new Error("本地模拟保存失败");
        return { ...next, available: true };
      }
    });
    try {
      await mounted.flush();
      mounted.find((node) => node.type === "input")[0].props.onChange({ target: { value: "https://draft.example/" } });
      await mounted.flush();
      mounted.find((node) => node.type === "input").at(-1).props.onChange({ target: { value: "draft-folder" } });
      await mounted.flush();
      mounted.find((node) => node.type?.name === "SettingsStatusBadge")[0].props.onChange();
      await mounted.flush();
      assert.equal(written.baseUrl, card.initial.baseUrl);
      assert.equal(written.uploadFolder, card.initial.uploadFolder);
      assert.equal(mounted.find((node) => node.type === "input")[0].props.value, "https://draft.example/");
      assert.equal(mounted.find((node) => node.type === "input").at(-1).props.value, "draft-folder");
    } finally { mounted.unmount(); }
  });
}

test("恢复备份刷新标记传到三个服务卡片", async () => {
  const source = await readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8");
  for (const { name } of cards) {
    assert.ok(new RegExp(`<${name}\\b[^>]*reloadKey=\\{settingsReloadKey\\}`).test(source), `${name} 应接收恢复后的刷新标记`);
  }
});

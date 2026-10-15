import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source, fileName) => ts.transpileModule(source, {
  fileName,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const hooksUrl = moduleUrl(`
  let runtime;
  export const setRuntime = (value) => { runtime = value; };
  export const useState = (value) => runtime.useState(value);
  export const useRef = (value) => runtime.useRef(value);
  export const useEffect = (effect, dependencies) => runtime.useEffect(effect, dependencies);
`);
const apiUrl = moduleUrl(`
  let handler;
  export const setHandler = (value) => { handler = value; };
  export const uploadAdminImage = (...args) => handler(...args);
  export const generateAdminAi = (...args) => handler(...args);
`);
const { setRuntime } = await import(hooksUrl);
const { setHandler } = await import(apiUrl);
const validationUrl = moduleUrl(compile(
  await readFile(new URL("../../shared/image-upload.ts", import.meta.url), "utf8"),
  "image-upload.ts"
));
const replacements = {
  react: hooksUrl,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": import.meta.resolve("lucide-react"),
  "../admin-api": apiUrl,
  "../../shared/image-upload": validationUrl,
  "./AdminFieldAssistButton": moduleUrl("export default function AdminFieldAssistButton() {}")
};

async function loadComponent(name) {
  let code = compile(
    await readFile(new URL(`../../src/components/${name}.tsx`, import.meta.url), "utf8"),
    `${name}.tsx`
  );
  for (const [specifier, replacement] of Object.entries(replacements)) {
    code = code.replaceAll(`from "${specifier}"`, `from "${replacement}"`);
  }
  return (await import(moduleUrl(code))).default;
}

// 执行真实组件事件及清理回调；仅替换 React 挂载宿主和请求，不需要 DOM 或网络。
function mount(Component, kind, handler, callbacks) {
  const hooks = [];
  let index = 0;
  let dirty = false;
  let mounted = true;
  let updatesAfterUnmount = 0;
  let effects;
  let tree;
  const runtime = {
    useState(initial) {
      const slot = index++;
      hooks[slot] ??= { value: typeof initial === "function" ? initial() : initial };
      return [hooks[slot].value, (next) => {
        if (!mounted) updatesAfterUnmount += 1;
        const value = typeof next === "function" ? next(hooks[slot].value) : next;
        if (!Object.is(value, hooks[slot].value)) dirty = true;
        hooks[slot].value = value;
      }];
    },
    useRef(initial) {
      return hooks[index++] ??= { current: initial };
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
  function render() {
    index = 0;
    dirty = false;
    effects = [];
    setRuntime(runtime);
    tree = Component({
      available: true, enabled: true, input: { title: "草稿" }, label: "辅助操作", mobileLabel: "操作",
      locale: "zh", task: "tool_name", token: "local-test-token", ...callbacks
    });
    for (const effect of effects) effect();
  }
  render();
  return {
    trigger() {
      setHandler(handler);
      if (kind === "upload") {
        tree.props.children[0].props.onChange({
          currentTarget: { files: [new File(["png"], "test.png", { type: "image/png" })] }
        });
      } else {
        tree.props.onClick();
      }
    },
    get busy() { return (kind === "upload" ? tree.props.children[1] : tree).props.busy; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    async flush() {
      for (let turn = 0; turn < 12; turn++) {
        await Promise.resolve();
        if (dirty && mounted) render();
      }
    },
    unmount() {
      mounted = false;
      for (const hook of hooks) hook.cleanup?.();
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const [kind, name] of [["upload", "AdminImageUploadButton"], ["ai", "AdminAiAction"]]) {
  const Component = await loadComponent(name);
  const result = (value) => kind === "upload" ? { url: value } : { name: value };
  const callbacks = (onSuccess, onError) => ({
    onUploaded: onSuccess,
    onResult: (value) => onSuccess(value.name),
    onError
  });

  for (const fail of [false, true]) {
    test(`${name} 在当前编辑器${fail ? "失败后可重试" : "成功回填且阻止重复触发"}`, async () => {
      const pending = [deferred(), deferred()];
      let calls = 0;
      const values = [];
      const errors = [];
      const mounted = mount(Component, kind, () => pending[calls++].promise, callbacks(
        (value) => values.push(value), (error) => errors.push(error)
      ));
      try {
        mounted.trigger();
        mounted.trigger();
        assert.equal(calls, 1);
        await mounted.flush();
        assert.equal(mounted.busy, true);
        const failure = new Error("本地模拟失败");
        if (fail) pending[0].reject(failure);
        else pending[0].resolve(result("首次结果"));
        await mounted.flush();
        assert.equal(mounted.busy, false);
        assert.deepEqual(values, fail ? [] : ["首次结果"]);
        assert.deepEqual(errors, fail ? [failure] : []);
        mounted.trigger();
        assert.equal(calls, 2);
        pending[1].resolve(result("后续结果"));
        await mounted.flush();
        assert.equal(mounted.busy, false);
        assert.equal(values.at(-1), "后续结果");
      } finally {
        mounted.unmount();
      }
    });

    test(`${name} 关闭 A 再打开 B 后忽略 A 的${fail ? "失败" : "成功"}回调`, async () => {
      const oldRequest = deferred();
      const newRequest = deferred();
      const errors = [];
      let currentDraft = { id: "A", value: "A 草稿" };
      const sharedCallbacks = callbacks(
        (value) => { currentDraft = { ...currentDraft, value }; },
        (error) => errors.push(error)
      );
      const oldEditor = mount(Component, kind, () => oldRequest.promise, sharedCallbacks);
      oldEditor.trigger();
      await oldEditor.flush();
      oldEditor.unmount();
      currentDraft = { id: "B", value: "B 草稿" };
      const newEditor = mount(Component, kind, () => newRequest.promise, sharedCallbacks);
      try {
        newEditor.trigger();
        await newEditor.flush();
        if (fail) oldRequest.reject(new Error("A 的延迟错误"));
        else oldRequest.resolve(result("A 的延迟结果"));
        await oldEditor.flush();
        await newEditor.flush();
        assert.deepEqual(currentDraft, { id: "B", value: "B 草稿" });
        assert.deepEqual(errors, []);
        assert.equal(oldEditor.updatesAfterUnmount, 0);
        assert.equal(newEditor.busy, true);
        newRequest.resolve(result("B 的有效结果"));
        await newEditor.flush();
        assert.deepEqual(currentDraft, { id: "B", value: "B 的有效结果" });
        assert.equal(newEditor.busy, false);
      } finally {
        newEditor.unmount();
      }
    });
  }
}

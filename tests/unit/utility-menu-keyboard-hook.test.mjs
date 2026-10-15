import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const source = await readFile(
  new URL("../../src/useUtilityMenuKeyboard.ts", import.meta.url),
  "utf8"
);
const outsideInteractionSource = await readFile(
  new URL("../../src/useOutsideInteractionDismiss.ts", import.meta.url),
  "utf8"
);

test("shared utility menu hook exposes the complete integration API", () => {
  assert.match(source, /export function useUtilityMenuKeyboard<[^>]+>/);
  assert.match(source, /openMenu/);
  assert.match(source, /setOpenMenu/);
  assert.match(source, /closeMenu/);
  assert.match(source, /toggleMenu/);
  assert.match(source, /getMenuId/);
  assert.match(source, /handleTriggerKeyDown/);
  assert.match(source, /handleMenuKeyDown/);
});

test("shared utility menu dismissal owns every outside interaction path", () => {
  assert.match(source, /activeTriggerRef\.current/);
  assert.match(source, /data-utility-menu/);
  assert.match(source, /useOutsideInteractionDismiss/);
  assert.match(source, /\[activeTriggerRef\.current, menu\]\.some/);
  assert.match(source, /isEventInsideElement/);
  assert.match(outsideInteractionSource, /event\.composedPath\(\)/);
  assert.match(outsideInteractionSource, /element\.contains\(target\)/);
  assert.match(
    outsideInteractionSource,
    /document\.addEventListener\("pointerdown", handleOutsideInteraction, true\)/
  );
  assert.match(
    outsideInteractionSource,
    /document\.addEventListener\("click", handleOutsideInteraction, true\)/
  );
  assert.match(
    outsideInteractionSource,
    /document\.addEventListener\("focusin", handleOutsideInteraction, true\)/
  );
  assert.match(source, /closeMenu\(true\)/);
});

test("shared hook owns trigger restoration and deferred menu focus", () => {
  assert.match(source, /useRef<HTMLButtonElement>/);
  assert.match(source, /event\.currentTarget/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /\.focus\(\)/);
  assert.match(source, /data-utility-menu/);
  assert.match(source, /menuitemradio/);
});

test("menu keys cycle focus and Escape restores the opening trigger", async (t) => {
  const importReplacements = { react: import.meta.resolve("react") };
  const outside = await compileTypescriptModule(
    new URL("../../src/useOutsideInteractionDismiss.ts", import.meta.url),
    { importReplacements }
  );
  t.after(() => outside.cleanup());
  const compiled = await compileTypescriptModule(
    new URL("../../src/useUtilityMenuKeyboard.ts", import.meta.url),
    { importReplacements: { ...importReplacements, "./useOutsideInteractionDismiss": outside.url.href } }
  );
  t.after(() => compiled.cleanup());
  const { useUtilityMenuKeyboard } = await import(compiled.url.href);
  let menu;
  // ponytail: SSR checks handlers only; use browser checks for mounted focus effects.
  renderToString(createElement(function Probe() {
    menu = useUtilityMenuKeyboard("test");
    return null;
  }));

  const originals = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, originals));
  globalThis.document = { activeElement: null };
  let restoreFocus;
  globalThis.window = { requestAnimationFrame: (callback) => { restoreFocus = callback; } };
  const buttons = Array.from({ length: 3 }, () => ({
    focus() { document.activeElement = this; }
  }));
  const event = {
    currentTarget: { querySelectorAll: () => buttons },
    preventDefault: t.mock.fn(),
    stopPropagation: t.mock.fn()
  };

  for (const [start, key, target] of [
    [-1, "ArrowDown", 0], [-1, "ArrowUp", 2],
    [2, "ArrowDown", 0], [0, "ArrowUp", 2],
    [1, "Home", 0], [1, "End", 2]
  ]) {
    document.activeElement = buttons[start] ?? null;
    event.preventDefault.mock.resetCalls();
    menu.handleMenuKeyDown({ ...event, key });
    assert.equal(document.activeElement, buttons[target], `${key} from item ${start}`);
    assert.equal(event.preventDefault.mock.callCount(), 1);
  }

  const trigger = { focus() { document.activeElement = this; } };
  menu.toggleMenu("locale", trigger);
  menu.handleMenuKeyDown({ ...event, key: "Escape" });
  assert.equal(event.stopPropagation.mock.callCount(), 1);
  assert.equal(document.activeElement, buttons[2]);
  restoreFocus();
  assert.equal(document.activeElement, trigger);
});

test("shared hook scopes menu ids so public and admin instances cannot collide", () => {
  assert.match(source, /scope/);
  assert.match(source, /getMenuId/);
  assert.match(source, /utility-menu/);
});

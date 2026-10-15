import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8"
);
const sharedControls = await readFile(
  new URL("../../src/components/UtilityMenuControls.tsx", import.meta.url),
  "utf8"
);

const homeHeaderSource = source.slice(
  source.indexOf("function HomeHeader"),
  source.indexOf("function SectionTitle")
);

test("public utility menus use the shared keyboard hook", () => {
  assert.match(
    source,
    /import\s*\{\s*useUtilityMenuKeyboard\s*\}\s*from\s*["']\.\/useUtilityMenuKeyboard["']/
  );
  assert.match(
    homeHeaderSource,
    /useUtilityMenuKeyboard<\s*["']locale["']\s*\|\s*["']theme["']\s*>\(\s*["']public["']\s*\)/
  );
  assert.match(homeHeaderSource, /\bopenMenu\b/);
  assert.match(homeHeaderSource, /\bsetOpenMenu\b/);
  assert.match(homeHeaderSource, /\bcloseMenu\b|closeMenu:\s*closePublicUtilityMenu/);
  assert.match(homeHeaderSource, /\btoggleMenu\b|toggleMenu:\s*togglePublicUtilityMenu/);
  assert.match(homeHeaderSource, /\bgetMenuId\b|getMenuId:\s*getPublicUtilityMenuId/);
  assert.match(
    homeHeaderSource,
    /\bhandleTriggerKeyDown\b|handleTriggerKeyDown:\s*handlePublicUtilityMenuTriggerKeyDown/
  );
  assert.match(
    homeHeaderSource,
    /\bhandleMenuKeyDown\b|handleMenuKeyDown:\s*handlePublicUtilityMenuKeyDown/
  );
  assert.doesNotMatch(homeHeaderSource, /menuRootRef|mobileUtilityRootRef/);
});

test("desktop and mobile menus keep the shared ARIA contract", () => {
  assert.match(homeHeaderSource, /<UtilityMenuControls/);
  assert.equal((homeHeaderSource.match(/aria-haspopup="menu"/g) ?? []).length, 0);
  assert.equal((sharedControls.match(/aria-haspopup="menu"/g) ?? []).length, 1);
  assert.equal((sharedControls.match(/data-utility-menu=\{getMenuId\(menu\)\}/g) ?? []).length, 1);
  assert.equal((sharedControls.match(/role="menuitemradio"/g) ?? []).length, 2);
  assert.equal((sharedControls.match(/aria-checked=/g) ?? []).length, 2);
  assert.equal((sharedControls.match(/onKeyDown=\{handleMenuKeyDown\}/g) ?? []).length, 1);
});

test("mobile Escape closes the menu before the navigation drawer", () => {
  assert.match(
    homeHeaderSource,
    /const mobileNavFocus = useOverlayFocusManagement\([\s\S]*onEscape: closeMobileNav/
  );
  assert.match(
    homeHeaderSource,
    /function updateMobileNavClosed[\s\S]*setOpenMenu\(null\)/
  );
  assert.match(homeHeaderSource, /<UtilityMenuControls/);
});

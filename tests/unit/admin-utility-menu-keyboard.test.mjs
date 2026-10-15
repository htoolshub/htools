import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const sharedControls = await readFile(
  new URL("../../src/components/UtilityMenuControls.tsx", import.meta.url),
  "utf8"
);
const telegramPushSource = await readFile(
  new URL("../../src/components/AdminTelegramPush.tsx", import.meta.url),
  "utf8"
);
const cardSources = await Promise.all([
  "../../src/components/admin-cards/AdminToolCard.tsx",
  "../../src/components/admin-cards/AdminArticleCard.tsx"
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

const utilityMenuSetup = source.slice(
  source.indexOf("useUtilityMenuKeyboard"),
  source.indexOf("function commitAdminCategorySettings")
);

test("admin utility menus use the shared keyboard hook", () => {
  assert.match(
    source,
    /import\s*\{\s*useUtilityMenuKeyboard\s*\}\s*from\s*["']\.\/useUtilityMenuKeyboard["']/
  );
  assert.match(
    utilityMenuSetup,
    /useUtilityMenuKeyboard<\s*["']locale["']\s*\|\s*["']theme["']\s*>\(\s*["']admin["']\s*\)/
  );
  assert.match(utilityMenuSetup, /openMenu:\s*openAdminMenu/);
  assert.match(utilityMenuSetup, /setOpenMenu:\s*setOpenAdminMenu/);
  assert.match(utilityMenuSetup, /closeMenu:\s*closeAdminMenu/);
  assert.match(utilityMenuSetup, /toggleMenu:\s*toggleAdminMenu/);
  assert.match(utilityMenuSetup, /getMenuId:\s*getAdminMenuId/);
  assert.match(
    utilityMenuSetup,
    /handleTriggerKeyDown:\s*handleAdminMenuTriggerKeyDown/
  );
  assert.match(
    utilityMenuSetup,
    /handleMenuKeyDown:\s*handleAdminMenuKeyDown/
  );
});

test("login and sidebar utility menus keep the shared ARIA contract", () => {
  assert.match(source, /<UtilityMenuControls/);
  assert.equal(
    [source, telegramPushSource, ...cardSources].reduce(
      (total, text) => total + (text.match(/aria-haspopup="menu"/g) ?? []).length,
      0
    ),
    5
  );
  assert.equal((sharedControls.match(/aria-haspopup="menu"/g) ?? []).length, 1);
  assert.equal((sharedControls.match(/data-utility-menu=\{getMenuId\(menu\)\}/g) ?? []).length, 1);
  assert.equal((sharedControls.match(/role="menuitemradio"/g) ?? []).length, 2);
  assert.equal((sharedControls.match(/aria-checked=/g) ?? []).length, 2);
  assert.match(sharedControls, /className=\{`icon-button/);
  assert.equal((sharedControls.match(/onKeyDown=\{handleMenuKeyDown\}/g) ?? []).length, 1);
});


test("mobile sidebar closes utility menus separately and clears stale menu state", () => {
  assert.match(
    source,
    /event\.key === "Escape" && !openAdminMenu[\s\S]*closeMobileSidebar\(\)/
  );
  assert.match(
    source,
    /function closeMobileSidebar\(\)[\s\S]*setOpenAdminMenu\(null\)[\s\S]*setMobileSidebarOpen\(false\)/
  );
  assert.equal((source.match(/onClick=\{closeMobileSidebar\}/g) ?? []).length, 2);
});

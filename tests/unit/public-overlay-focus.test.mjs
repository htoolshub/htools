import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8"
);
const homeHeaderSource = source.slice(
  source.indexOf("function HomeHeader"),
  source.indexOf("function SectionTitle")
);

test("search and mobile navigation share overlay focus management", () => {
  assert.equal(
    (homeHeaderSource.match(/useOverlayFocusManagement\(\{/g) ?? []).length,
    2
  );
  assert.match(homeHeaderSource, /containerRef: searchPanelRef/);
  assert.match(homeHeaderSource, /initialFocusRef: searchInputRef/);
  assert.match(homeHeaderSource, /returnFocusRef: searchTriggerRef/);
  assert.match(homeHeaderSource, /containerRef: mobileDrawerRef/);
  assert.match(homeHeaderSource, /initialFocusRef: mobileNavCloseRef/);
  assert.match(homeHeaderSource, /returnFocusRef: mobileMenuTriggerRef/);
});

test("search panel and drawer bind focus handlers to their active panels", () => {
  assert.match(homeHeaderSource, /ref=\{searchTriggerRef\}/);
  assert.match(homeHeaderSource, /ref=\{searchPanelRef\}/);
  assert.match(homeHeaderSource, /onKeyDown=\{searchOverlayFocus\.handleKeyDown\}/);
  assert.match(homeHeaderSource, /ref=\{mobileMenuTriggerRef\}/);
  assert.match(homeHeaderSource, /ref=\{mobileDrawerRef\}/);
  assert.match(homeHeaderSource, /ref=\{mobileNavCloseRef\}/);
  assert.match(homeHeaderSource, /onKeyDown=\{mobileNavFocus\.handleKeyDown\}/);
});

test("mobile drawer exposes modal semantics and disables its closing DOM", () => {
  assert.match(homeHeaderSource, /className="mobile-nav-drawer"/);
  assert.match(homeHeaderSource, /role="dialog"/);
  assert.match(homeHeaderSource, /aria-modal="true"/);
  assert.match(homeHeaderSource, /aria-hidden=\{isMobileNavClosing\}/);
  assert.match(homeHeaderSource, /inert=\{isMobileNavClosing\}/);
  assert.match(homeHeaderSource, /tabIndex=\{-1\}/);
});

test("search and drawer remain mutually exclusive including keyboard shortcut", () => {
  assert.match(
    homeHeaderSource,
    /function openSearch\(\)[\s\S]*closeMobileNavImmediately\(\)[\s\S]*setIsSearchOpen\(true\)/
  );
  assert.match(
    homeHeaderSource,
    /function openMobileNav\(\)[\s\S]*setIsSearchOpen\(false\)[\s\S]*setIsMobileNavOpen\(true\)/
  );
  assert.match(
    homeHeaderSource,
    /\[canOpenGlobalSearch, isMobileNavClosing, isMobileNavOpen\]/
  );
  assert.match(
    homeHeaderSource,
    /function closeMobileNavImmediately\(\)[\s\S]*updateMobileNavClosed\(true\)/
  );
});

test("body scroll remains locked for search and the visible mobile drawer", () => {
  assert.match(
    homeHeaderSource,
    /shouldLockBodyScroll = isSearchOverlayOpen \|\| isMobileNavVisible/
  );
});

test("mobile navigation preserves the sticky public topbar while body scroll is locked", () => {
  assert.match(
    homeHeaderSource,
    /className=\{`home-topbar \$\{[\s\S]*isMobileNavVisible[\s\S]*is-mobile-nav-visible/
  );
  assert.match(homeHeaderSource, /--overlay-scroll-offset/);
});

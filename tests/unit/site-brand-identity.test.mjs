import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sharedSource, publicSource, adminSource, styles] = await Promise.all([
  readFile(new URL("../../src/shared-ui.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/styles.css", import.meta.url), "utf8")
]);

test("one shared site identity owns the configured logo, name, and subtitle", () => {
  assert.match(sharedSource, /export function SiteBrandIdentity/);
  assert.match(sharedSource, /<SiteBrandMark className=\{markClassName\}/);
  assert.match(sharedSource, /getSiteDisplayName\(settings\)/);
  assert.match(sharedSource, /getSiteSubtitle\(settings\)/);
  assert.match(sharedSource, /showSubtitle/);
});

test("public header, mobile drawer, footer, admin sidebar, and login share the identity", () => {
  assert.equal((publicSource.match(/<SiteBrandIdentity/g) ?? []).length, 3);
  assert.equal((adminSource.match(/<SiteBrandIdentity/g) ?? []).length, 2);
  assert.match(adminSource, /className="auth-home-brand"[\s\S]*<SiteBrandIdentity showSubtitle \/>/);
  assert.match(adminSource, /className="admin-brand"[\s\S]*markClassName="compact-mark" showSubtitle/);
  assert.doesNotMatch(adminSource, /auth-mark/);
  assert.doesNotMatch(adminSource, /auth-heading|t\.admin\.description/);
  assert.match(adminSource, /<form className="auth-form"/);
  assert.match(styles, /\.auth-home-brand/);
  assert.match(styles, /\.auth-form\s*\{[\s\S]*border-top:\s*1px solid var\(--border-soft\)/);
});

test("admin tool library uses the same wrench icon as the public tools entry", () => {
  assert.match(
    adminSource,
    /adminView === "tools"[\s\S]*?<Wrench size=\{18\} \/>[\s\S]*?\{t\.admin\.toolLibrary\}/
  );
});

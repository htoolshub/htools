import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const settingsPanelSource = source.slice(
  source.indexOf("function AdminSystemSettingsPanel"),
  source.indexOf("function Dialog")
);
const legalCardSource = await readFile(
  new URL("../../src/components/admin-settings/LegalSettingsCard.tsx", import.meta.url),
  "utf8"
);

test("站点和服务设置在真实卡片内复用通用细线骨架", () => {
  for (const cardClass of [
    "site-identity-card", "home-copy-settings-card", "footer-settings-card",
    "public-source-card", "ai-settings-card", "proxy-settings-card",
    "factory-reset-card", "backup-restore-card"
  ]) {
    assert.match(
      settingsPanelSource,
      new RegExp(`className="source-public-card ${cardClass}" \\{\\.\\.\\.getAdminLoadingProps\\(`)
    );
  }
  assert.doesNotMatch(settingsPanelSource, /<(?:SiteSettingsGroupSkeleton|ProxySettingsCardSkeleton|FactoryResetCardSkeleton|BackupRestoreCardSkeleton|AdminSettingsFieldSkeleton)\b/);
  assert.equal((settingsPanelSource.match(/<LegalSettingsCard\s+busy=\{\w+\}\s+loading=\{siteSettingsLoading\}\s+visible=\{showSiteSettingsSkeleton\}/g) ?? []).length, 3);
  assert.match(legalCardSource, /getAdminLoadingProps\(loading, visible\)/);
  assert.match(legalCardSource, /<AdminSkeletonLines loading=\{loading\} visible=\{visible\} \/>/);
  assert.equal((legalCardSource.match(/<AdminMarkdownEditor\b/g) ?? []).length, 2);
});

test("site identity, home, footer, about, privacy, and terms use independent submit handlers", () => {
  assert.match(settingsPanelSource, /onSubmit=\{saveSiteIdentityForm\}/);
  assert.match(settingsPanelSource, /onSubmit=\{saveAboutPageForm\}/);
  assert.match(settingsPanelSource, /onSubmit=\{saveFooterSettingsForm\}/);
  assert.match(settingsPanelSource, /onSubmit=\{saveHomeHeroForm\}/);
  assert.match(settingsPanelSource, /onSubmit=\{savePrivacyPageForm\}/);
  assert.match(settingsPanelSource, /onSubmit=\{saveTermsPageForm\}/);
  assert.doesNotMatch(settingsPanelSource, /saveSiteForm/);
  assert.doesNotMatch(settingsPanelSource, /siteSettingsBusy/);
});

test("each settings card owns its dirty and busy state", () => {
  assert.match(settingsPanelSource, /siteIdentityBusy \|\| !siteIdentityDirty/);
  assert.match(settingsPanelSource, /busy=\{aboutPageBusy\}/);
  assert.match(settingsPanelSource, /dirty=\{aboutPageDirty\}/);
  assert.match(settingsPanelSource, /footerSettingsBusy \|\| !footerSettingsDirty/);
  assert.match(settingsPanelSource, /homeHeroBusy \|\| !homeHeroDirty/);
  assert.match(settingsPanelSource, /busy=\{privacyPageBusy\}/);
  assert.match(settingsPanelSource, /dirty=\{privacyPageDirty\}/);
  assert.match(settingsPanelSource, /busy=\{termsPageBusy\}/);
  assert.match(settingsPanelSource, /dirty=\{termsPageDirty\}/);
});

test("section saves use PATCH payloads and preserve unrelated drafts", () => {
  assert.match(settingsPanelSource, /section: "identity"/);
  assert.match(settingsPanelSource, /section: "about"/);
  assert.match(settingsPanelSource, /section: "footer"/);
  assert.match(settingsPanelSource, /section: "home"/);
  assert.match(settingsPanelSource, /section: "privacy"/);
  assert.match(settingsPanelSource, /section: "terms"/);
  assert.match(settingsPanelSource, /applySiteSettingsResponse\(settings, "identity"\)/);
  assert.match(settingsPanelSource, /applySiteSettingsResponse\(settings, "about"\)/);
  assert.match(settingsPanelSource, /applySiteSettingsResponse\(settings, "footer"\)/);
  assert.match(settingsPanelSource, /applySiteSettingsResponse\(settings, "home"\)/);
  assert.match(settingsPanelSource, /applySiteSettingsResponse\(settings, "privacy"\)/);
  assert.match(settingsPanelSource, /applySiteSettingsResponse\(settings, "terms"\)/);
  assert.match(settingsPanelSource, /enqueueSiteSettingsMutation/);
});

test("general settings keep the approved card order", () => {
  const siteIndex = settingsPanelSource.indexOf(
    'className="source-public-card site-identity-card"'
  );
  const homeIndex = settingsPanelSource.indexOf(
    'className="source-public-card home-copy-settings-card"'
  );
  const footerIndex = settingsPanelSource.indexOf(
    'className="source-public-card footer-settings-card"'
  );
  const aboutIndex = settingsPanelSource.indexOf('formId="about-settings"');
  const privacyIndex = settingsPanelSource.indexOf('formId="privacy-settings"');
  const termsIndex = settingsPanelSource.indexOf('formId="terms-settings"');

  assert.ok(siteIndex < homeIndex);
  assert.ok(homeIndex < footerIndex);
  assert.ok(footerIndex < aboutIndex);
  assert.ok(aboutIndex < privacyIndex);
  assert.ok(privacyIndex < termsIndex);
});

test("each site settings form reports its own successful update", () => {
  assert.match(settingsPanelSource, /setStatus\(maintenanceText\.aboutUpdated\)/);
  assert.match(settingsPanelSource, /setStatus\(maintenanceText\.footerUpdated\)/);
  assert.match(settingsPanelSource, /setStatus\(maintenanceText\.homeUpdated\)/);
  assert.match(settingsPanelSource, /setStatus\(maintenanceText\.privacyUpdated\)/);
  assert.match(settingsPanelSource, /setStatus\(maintenanceText\.termsUpdated\)/);
});

test("about, privacy, and terms expose matching Chinese and English editors", () => {
  for (const formId of ["about-settings", "privacy-settings", "terms-settings"]) {
    const formIdIndex = settingsPanelSource.indexOf(`formId="${formId}"`);
    const cardStart = settingsPanelSource.lastIndexOf("<LegalSettingsCard", formIdIndex);
    const cardSource = settingsPanelSource.slice(cardStart, formIdIndex + 100);
    assert.match(cardSource, /chineseLabel=\{maintenanceText\.legalChinese\}/);
    assert.match(cardSource, /englishLabel=\{maintenanceText\.legalEnglish\}/);
  }
});

test("footer settings validate social links and columns independently", () => {
  assert.match(settingsPanelSource, /parseFooterJson\([\s\S]*?"social"/);
  assert.match(settingsPanelSource, /parseFooterJson\([\s\S]*?"groups"/);
  assert.match(settingsPanelSource, /footer social links JSON is invalid\./);
  assert.match(settingsPanelSource, /footer groups JSON is invalid\./);
  assert.match(settingsPanelSource, /footerSocialJsonInvalid/);
  assert.match(settingsPanelSource, /footerGroupsJsonInvalid/);
});

test("footer description uses the same single-line control as site identity", () => {
  const footerCard = settingsPanelSource.slice(
    settingsPanelSource.indexOf('className="source-public-card footer-settings-card"'),
    settingsPanelSource.indexOf(
      'aria-labelledby="system-settings-tab-services"'
    )
  );

  assert.match(footerCard, /footerIntroLabel[\s\S]{0,300}<input/);
  assert.doesNotMatch(footerCard, /footerIntroLabel[\s\S]{0,300}<textarea/);
});

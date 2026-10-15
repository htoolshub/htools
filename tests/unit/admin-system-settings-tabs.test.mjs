import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);
const textSource = await readFile(
  new URL("../../src/admin-text.ts", import.meta.url),
  "utf8"
);
const maintenanceSource = await readFile(
  new URL("../../src/admin-maintenance.ts", import.meta.url),
  "utf8"
);
const helpersSource = await readFile(
  new URL("../../src/admin-helpers.ts", import.meta.url),
  "utf8"
);
const stylesSource = await readFile(
  new URL("../../src/styles.css", import.meta.url),
  "utf8"
);
const submitSource = await readFile(
  new URL("../../src/SubmitPage.tsx", import.meta.url),
  "utf8"
);
const settingsSource = adminSource.slice(
  adminSource.indexOf("function getInitialAdminSystemSettingsGroup"),
  adminSource.indexOf("type AdminMaintenanceSection")
);
const githubSettingsSource = await readFile(
  new URL("../../src/components/admin-settings/GitHubSettingsForm.tsx", import.meta.url),
  "utf8"
);
const statusBadgeSource = await readFile(
  new URL("../../src/components/admin-settings/SettingsStatusBadge.tsx", import.meta.url),
  "utf8"
);
const telegramCardSource = await readFile(
  new URL("../../src/components/admin-settings/TelegramSettingsCard.tsx", import.meta.url),
  "utf8"
);
const imageBedCardSource = await readFile(
  new URL("../../src/components/admin-settings/ImageBedSettingsCard.tsx", import.meta.url),
  "utf8"
);
const rssHubCardSource = await readFile(
  new URL("../../src/components/admin-settings/RssHubSettingsCard.tsx", import.meta.url),
  "utf8"
);
const legalCardSource = await readFile(
  new URL("../../src/components/admin-settings/LegalSettingsCard.tsx", import.meta.url),
  "utf8"
);
const dialogComponentSource = await readFile(
  new URL("../../src/components/AdminDialog.tsx", import.meta.url),
  "utf8"
);
const turnstileCardSource = await readFile(
  new URL("../../src/components/admin-settings/TurnstileSettingsCard.tsx", import.meta.url),
  "utf8"
);
const umamiCardSource = await readFile(
  new URL("../../src/components/admin-settings/UmamiSettingsCard.tsx", import.meta.url),
  "utf8"
);
const securityCardSource = await readFile(
  new URL("../../src/components/admin-settings/SecuritySettingsCard.tsx", import.meta.url),
  "utf8"
);
const settingsCardsSource = [
  githubSettingsSource,
  statusBadgeSource,
  telegramCardSource,
  imageBedCardSource,
  rssHubCardSource,
  turnstileCardSource,
  umamiCardSource,
  securityCardSource,
  legalCardSource
].join("\n");

test("system settings expose three persistent accessible tab panels", () => {
  assert.match(adminSource, /id="admin-system-settings-topbar-slot"/);
  assert.match(settingsSource, /createPortal\(settingsTabs, settingsTopbarTarget\)/);
  assert.match(settingsSource, /const \[settingsTopbarTarget, setSettingsTopbarTarget\]/);
  assert.match(settingsSource, /role="tablist"/);
  assert.equal((settingsSource.match(/role="tab"/g) ?? []).length, 1);
  assert.equal((settingsSource.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.match(settingsSource, /aria-controls=\{`system-settings-panel-\$\{group\.id\}`\}/);
  assert.match(settingsSource, /aria-selected=\{selected\}/);
  assert.match(settingsSource, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(
    settingsSource,
    /className=\{`admin-segmented-toggle-option system-settings-tab/
  );
  assert.match(settingsSource, /className="admin-segmented-toggle system-settings-tabs"/);
  assert.doesNotMatch(settingsSource, /<group\.Icon/);
  assert.match(settingsSource, /hidden=\{activeSettingsGroup !== "site"\}/);
  assert.match(settingsSource, /hidden=\{activeSettingsGroup !== "services"\}/);
  assert.match(settingsSource, /hidden=\{activeSettingsGroup !== "management"\}/);
});

test("system settings tabs support keyboard and clean path state", () => {
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
    assert.match(settingsSource, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(helpersSource, /site: "\/admin\/settings\/site"/);
  assert.match(helpersSource, /services: "\/admin\/settings\/services"/);
  assert.match(helpersSource, /management: "\/admin\/settings\/management"/);
  assert.match(settingsSource, /ADMIN_SYSTEM_SETTINGS_GROUP_PATHS\[group\]/);
  assert.match(settingsSource, /window\.history\.pushState/);
  assert.match(settingsSource, /window\.history\.replaceState/);
  assert.match(settingsSource, /window\.addEventListener\("popstate"/);
  assert.doesNotMatch(settingsSource, /searchParams\.(?:get|set)\("group"/);
  assert.doesNotMatch(settingsSource, /htools_admin_system_settings_group/);
});

test("admin routes share localized browser document titles", () => {
  assert.match(adminSource, /function formatAdminDocumentTitle/);
  assert.match(adminSource, /document\.title = formatAdminDocumentTitle/);
  assert.match(adminSource, /activeDocumentTitle/);
  assert.match(adminSource, /getAdminSystemSettingsGroupTitle/);
  assert.match(adminSource, /t\.nav\.admin/);
  assert.match(helpersSource, /function getAdminSystemSettingsGroupFromPath/);
});

test("system settings tabs inherit the shared topbar button typography", () => {
  assert.doesNotMatch(
    stylesSource,
    /\.system-settings-tab\s*\{[^}]*font-(?:size|weight)/g
  );
  assert.doesNotMatch(
    stylesSource,
    /\.system-settings-tab\.is-active\s*\{[^}]*font-weight/g
  );
});

test("Chinese system settings tab labels use four characters", () => {
  assert.match(textSource, /systemGroupGeneral: "站点信息"/);
  assert.match(textSource, /systemGroupIntegrations: "服务设置"/);
  assert.match(textSource, /systemGroupSecurity: "管理设置"/);
});

test("system settings keep text-only actions except the inline icon upload trigger", () => {
  assert.doesNotMatch(settingsSource, /Icon:\s*(?:Settings|Plug|ShieldCheck)/);
  assert.doesNotMatch(
    settingsSource,
    /<(?:Save|RotateCcw|Power|Lock|Download|Trash2|Activity|Database|CircleStop|ArrowUpRight) size=\{(?:14|16)\} \/>/
  );
  assert.match(
    settingsSource,
    /className="icon-button backup-file-picker site-icon-upload-trigger"/
  );
  assert.match(settingsSource, /<Upload size=\{17\} \/>/);
  assert.doesNotMatch(textSource, /siteIconUploadHint:/);
});

test("settings and check action labels stay stable while requests are busy", () => {
  assert.doesNotMatch(
    settingsSource,
    /\{(?:siteSaving|siteResetting|aboutSaving|aboutResetting|footerSaving|footerResetting|sourceSettingsSaving|proxySaving|securitySaving|backupExporting|backupRestoring|factoryResetting|sourceChecking|sourceImporting|sourceExporting|checking|loadingLinks)\s*\?/
  );
  assert.doesNotMatch(githubSettingsSource, /isSaving \? t\.form\.saving/);
});

test("button labels remain stable across admin and public submission requests", () => {
  for (const pattern of [
    /isLoggingIn \? t\.actions\.loggingIn/,
    /isLoadingMoreArticles[\s\S]{0,80}articleText\.loadingMore/,
    /primaryLabel=\{isSaving \? t\.form\.saving/,
    /primaryLabel=\{isArticleSaving \? t\.form\.saving/,
    /primaryLabel=\{isContentSourceSaving \? t\.form\.saving/,
    /isContentPreviewing \? contentText\.previewing/,
    /isLoadingMoreContent \? contentText\.loadingMore/
  ]) {
    assert.doesNotMatch(adminSource, pattern);
  }
  assert.doesNotMatch(submitSource, /isSubmitting[\s\S]{0,80}t\.form\.saving/);
  assert.match(submitSource, /isCheckingUrl \|\| isGitHubMetadataLoading \|\|/);
  assert.match(submitSource, /isSubmitting \|\| duplicateBlocksSubmit/);
});

test("GitHub submission uses the shared status switch and keeps save secondary", () => {
  assert.match(
    githubSettingsSource,
    /<SettingsStatusBadge[\s\S]*?onChange=\{\(\) => void toggleEnabled\(\)\}/
  );
  assert.match(
    githubSettingsSource,
    /disabled=\{isSaving \|\| \(!settings\?\.enabled && !hasSavedSubmissionConfig\)\}/
  );
  assert.match(
    githubSettingsSource,
    /className="ghost-button"\s*disabled=\{isSaving \|\| !isDirty\}\s*type="submit"/
  );
});

test("GitHub submissions can only be enabled from complete saved settings", () => {
  assert.match(githubSettingsSource, /const hasSavedSubmissionConfig = Boolean\(/);
  assert.match(githubSettingsSource, /settings\?\.owner\.trim\(\)/);
  assert.match(githubSettingsSource, /settings\.repo\.trim\(\)/);
  assert.doesNotMatch(githubSettingsSource, /clientId|clientSecret|callbackUrl/);
  assert.match(githubSettingsSource, /form\.labels/);
});

test("GitHub submission toggle saves immediately without submitting edited fields", () => {
  assert.match(
    githubSettingsSource,
    /async function toggleEnabled\(\)[\s\S]*saveGitHubSettings\(\{[\s\S]*enabled: !settings\.enabled,[\s\S]*owner: settings\.owner,[\s\S]*repo: settings\.repo[\s\S]*\}, token\)/
  );
  assert.match(
    githubSettingsSource,
    /setForm\(\(current\) => \(\{ \.\.\.current, enabled: saved\.enabled \}\)\)/
  );
  assert.match(
    githubSettingsSource,
    /onStatus\(saved\.enabled[\s\S]*maintenanceText\.githubSubmissionEnabledMessage[\s\S]*maintenanceText\.githubSubmissionDisabledMessage\)/
  );
});

test("service toggle success messages include the service name", () => {
  for (const message of [
    "GitHub 提交已开启。",
    "GitHub 提交已关闭。",
    "我的订阅源已开启。",
    "我的订阅源已关闭。",
    "Cloudflare Turnstile 已开启。",
    "Cloudflare Turnstile 已关闭。",
    "Telegram 推送已开启。",
    "Telegram 推送已关闭。",
    "Umami 访问统计已开启。",
    "Umami 访问统计已关闭。",
    "代理访问已开启。",
    "代理访问已关闭。",
    "GitHub Submission enabled.",
    "GitHub Submission disabled.",
    "My Subscription Feed enabled.",
    "My Subscription Feed disabled.",
    "Cloudflare Turnstile enabled.",
    "Cloudflare Turnstile disabled.",
    "Telegram Push enabled.",
    "Telegram Push disabled.",
    "Umami analytics enabled.",
    "Umami analytics disabled.",
    "RSSHub enabled.",
    "RSSHub disabled.",
    "Proxy Access enabled.",
    "Proxy Access disabled."
  ]) {
    assert.ok(textSource.includes(message));
  }
});

test("service settings controls expose their related help text", () => {
  assert.match(
    githubSettingsSource,
    /<form\s+aria-describedby="github-settings-description"[\s\S]*<p id="github-settings-description">/
  );
  assert.match(settingsSource, /<p id="public-source-description">/);
  assert.equal(
    (settingsSource.match(/aria-describedby="public-source-description"/g) ?? []).length,
    1
  );
  assert.match(settingsSource, /ariaDescribedBy="public-source-description"/);
  assert.match(turnstileCardSource, /<p id="turnstile-settings-description">/);
  assert.match(turnstileCardSource, /id="turnstile-settings-configuration"/);
  assert.doesNotMatch(
    `${settingsSource}\n${settingsCardsSource}`,
    /(?:turnstile|telegram)NotConfigured/
  );
  assert.match(
    turnstileCardSource,
    /ariaDescribedBy="turnstile-settings-description turnstile-settings-configuration"/
  );
  assert.match(settingsSource, /<p id="proxy-settings-description">/);
  assert.match(settingsSource, /id="proxy-settings-help"/);
  assert.match(
    settingsSource,
    /ariaDescribedBy="proxy-settings-description proxy-settings-help"/
  );
});

test("factory reset uses primary buttons for its entry and confirmation", () => {
  assert.match(
    settingsSource,
    /className="primary-button"[\s\S]{0,180}onClick=\{requestFactoryReset\}/
  );
  assert.match(settingsSource, /function requestFactoryReset\(\)[\s\S]{0,100}setPendingFactoryReset\(true\)/);
  const confirmStart = settingsSource.lastIndexOf(
    "<AdminConfirmDialog",
    settingsSource.indexOf('descriptionId="factory-reset-dialog-description"')
  );
  const factoryResetConfirm = settingsSource.slice(confirmStart, confirmStart + 900);
  assert.match(factoryResetConfirm, /confirmLabel=\{t\.actions\.confirm\}/);
  assert.match(factoryResetConfirm, /onConfirm=\{\(\) => void factoryReset\(\)\}/);
  assert.match(
    dialogComponentSource,
    /function AdminDialogActions\([\s\S]*?className="primary-button"/
  );
  assert.doesNotMatch(stylesSource, /\.factory-reset-button/);
});

test("integration status switches share one accessible component and wording", async () => {
  assert.match(statusBadgeSource, /export function SettingsStatusBadge\(/);
  assert.equal(
    (adminSource.match(/<SettingsStatusBadge\b/g) ?? []).length +
      (settingsCardsSource.match(/<SettingsStatusBadge\b/g) ?? []).length,
    10
  );
  assert.match(statusBadgeSource, /role="switch"/);
  assert.match(statusBadgeSource, /aria-checked=\{enabled\}/);
  assert.match(
    stylesSource,
    /\.settings-status-switch\s*\{[\s\S]*?height:\s*24px;[\s\S]*?min-height:\s*24px;[\s\S]*?align-items:\s*center;/
  );
  assert.match(
    stylesSource,
    /\.settings-status-switch-skeleton\s*\{[\s\S]*?height:\s*24px;/
  );
  assert.match(
    stylesSource,
    /\.source-card-heading\s*\{[\s\S]*?align-items:\s*center;/
  );
  assert.match(
    stylesSource,
    /\.github-settings-heading\s*\{[\s\S]*?align-items:\s*center;/
  );
  assert.doesNotMatch(adminSource, /source-card-status \$\{[^}]*is-enabled/);
  assert.doesNotMatch(stylesSource, /\.source-card-status\.is-enabled/);

  const zhSource = await readFile(
    new URL("../../src/i18n/zh.ts", import.meta.url),
    "utf8"
  );
  assert.match(zhSource, /statusEnabled: "已开启"/);
  assert.match(zhSource, /statusDisabled: "已关闭"/);
});

test("configurable services distinguish not configured from disabled", () => {
  assert.ok(textSource.includes('serviceUnavailable: "\u672a\u914d\u7f6e"'));
  assert.ok(textSource.includes('serviceUnavailable: "Not configured"'));
  assert.doesNotMatch(textSource, /(?:turnstile|telegram)Unavailable:/);
  assert.match(
    githubSettingsSource,
    /disabledLabel=\{hasSavedSubmissionConfig[\s\S]{0,120}maintenanceText\.serviceUnavailable\}/
  );
  assert.match(
    settingsSource,
    /const hasSavedProxyConfig = Boolean\(normalizeProxyBaseUrl\(proxySettings\.baseUrl\)\)/
  );
  assert.match(umamiCardSource, /const hasSavedConfig = hasCompleteUmamiSettings/);
  assert.equal(
    (adminSource.match(/maintenanceText\.serviceUnavailable/g) ?? []).length +
      (settingsCardsSource.match(/maintenanceText\.serviceUnavailable/g) ?? []).length,
    7
  );
});

test("GitHub status badge reflects only the persisted server setting", () => {
  assert.match(
    githubSettingsSource,
    /<SettingsStatusBadge[\s\S]{0,320}enabled=\{settings\?\.enabled \?\? false\}/
  );
  assert.doesNotMatch(
    githubSettingsSource,
    /<SettingsStatusBadge[\s\S]{0,180}enabled=\{form\.enabled\}/
  );
});

test("system settings track unsaved drafts without blocking navigation", () => {
  assert.match(settingsSource, /githubSettingsDirty/);
  assert.match(settingsSource, /proxySettingsDirty/);
  assert.match(settingsSource, /securitySettingsDirty/);
  assert.match(adminSource, /requestBackupRestore/);
  assert.match(settingsSource, /setBackupFileName\(""\)/);
  assert.match(settingsSource, /setBackupPayload\(null\)/);
  assert.doesNotMatch(settingsSource, /window\.addEventListener\("beforeunload"/);
  assert.doesNotMatch(adminSource, /pendingAdminView|pendingLogout/);
  assert.doesNotMatch(settingsSource, /data-dirty=|group\.dirty/);
  assert.doesNotMatch(stylesSource, /system-settings-tab\[data-dirty/);
});

test("system settings cards use the approved balanced two-column layout", () => {
  assert.ok(
    settingsSource.indexOf('className="source-public-card public-source-card"') <
      settingsSource.indexOf('className="source-public-card github-submission-card"')
  );
  assert.doesNotMatch(
    stylesSource,
    /\.system-settings-primary \.footer-settings-card[\s\S]{0,100}grid-column: 1 \/ -1/
  );
  assert.doesNotMatch(
    stylesSource,
    /\.factory-reset-card[\s\S]{0,100}grid-column: 1 \/ -1/
  );
  assert.match(settingsSource, /integration-settings-stack/);
  assert.match(settingsSource, /integration-settings-proxy/);
  assert.match(stylesSource, /integration-settings-stack[\s\S]*display: grid/);
  assert.match(stylesSource, /integration-settings-proxy[\s\S]*grid-column: 2/);
  assert.match(
    settingsSource,
    /<ImageBedSettingsCard[\s\S]*<\/div>\s*<div className="integration-settings-proxy">/
  );
  assert.doesNotMatch(stylesSource, /proxy-settings-card[\s\S]{0,100}span 2/);
  assert.match(settingsSource, /formId="about-settings"/);
  assert.match(settingsSource, /formId="privacy-settings"/);
  assert.match(settingsSource, /formId="terms-settings"/);
  assert.doesNotMatch(stylesSource, /\.about-settings-card/);
});

test("management settings keep the backup card independent from the left stack", () => {
  assert.match(settingsSource, /security-settings-stack/);
  assert.match(settingsSource, /security-settings-backup/);
  assert.match(stylesSource, /security-settings-stack[\s\S]*display: grid/);
  assert.match(stylesSource, /security-settings-backup[\s\S]*grid-column: 2/);
  assert.match(stylesSource, /backup-restore-card[\s\S]*order: 2/);
  assert.match(stylesSource, /factory-reset-card[\s\S]*order: 3/);
});

test("draft-aware save buttons disable until their forms change", () => {
  assert.match(githubSettingsSource, /disabled=\{isSaving \|\| !isDirty\}/);
  assert.match(settingsSource, /disabled=\{proxySaving \|\| !proxySettingsDirty\}/);
  assert.match(umamiCardSource, /disabled=\{saving \|\| !isDirty\}/);
  assert.match(securityCardSource, /disabled=\{saving \|\| !isDirty\}/);
  assert.doesNotMatch(
    githubSettingsSource,
    /\[onStatus, t\.githubSettings\.notLoaded, token\]/
  );
  assert.match(githubSettingsSource, /settingsError/);
  assert.match(githubSettingsSource, /setSettingsReloadKey/);
  assert.match(githubSettingsSource, /maintenanceText\.systemRetry/);
});

test("Umami saved configuration and enable state are handled independently", () => {
  assert.match(umamiCardSource, /const savingRef = useRef\(false\)/);
  assert.match(
    umamiCardSource,
    /function save\([\s\S]{0,420}enabled: settings\?\.enabled \?\? false[\s\S]{0,240}true/
  );
  assert.match(
    umamiCardSource,
    /function toggleEnabled[\s\S]{0,260}const enabled = !settings\.enabled[\s\S]{0,240}false/
  );
  assert.match(
    umamiCardSource,
    /!settings\?\.enabled && !hasSavedConfig/
  );
  assert.match(umamiCardSource, /className="source-public-card umami-settings-card"/);
  assert.match(textSource, /umamiTitle: "Umami 访问统计"/);
  assert.match(textSource, /umamiTitle: "Umami Analytics"/);
});

test("proxy enable state and editable settings are saved independently", () => {
  assert.match(settingsSource, /const proxySavingRef = useRef\(false\)/);
  assert.match(
    settingsSource,
    /if \(proxySavingRef\.current\) \{\s*return;\s*\}/
  );
  assert.match(settingsSource, /proxySavingRef\.current = true/);
  assert.match(settingsSource, /finally \{\s*proxySavingRef\.current = false/);
  assert.match(settingsSource, /const proxyEnabled = proxySettings\.enabled/);
  assert.doesNotMatch(
    settingsSource,
    /const proxySettingsDirty =\s*proxyForm\.enabled !== proxySettings\.enabled/
  );
  assert.match(
    settingsSource,
    /function saveProxyForm[\s\S]{0,320}enabled: proxySettings\.enabled[\s\S]{0,200}baseUrl: proxyForm\.baseUrl[\s\S]{0,200}true/
  );
  assert.match(
    settingsSource,
    /function toggleProxy[\s\S]{0,320}enabled: !proxySettings\.enabled[\s\S]{0,200}baseUrl: proxySettings\.baseUrl[\s\S]{0,240}false/
  );
  assert.match(
    settingsSource,
    /if \(syncFormAfterSave\) \{\s*setProxyForm\(normalizedSettings\);\s*\}/
  );
  assert.match(
    settingsSource,
    /disabled=\{\s*proxySaving \|\|\s*\(!proxyEnabled && !hasSavedProxyConfig\)\s*\}/
  );
});

test("proxy warning uses plain text without a leading rule", () => {
  const warningRule = stylesSource.match(/\.proxy-warning-note\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(warningRule, /border-left/);
  assert.doesNotMatch(warningRule, /padding-left/);
});

test("Chinese check and import actions use stable four-character labels", async () => {
  for (const label of [
    "检测订阅",
    "导入订阅",
    "导出订阅",
    "跳过重复",
    "覆盖更新"
  ]) {
    const escapedLabel = [...label]
      .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join("");
    assert.ok(textSource.includes(escapedLabel));
  }

  const zhSource = await readFile(
    new URL("../../src/i18n/zh.ts", import.meta.url),
    "utf8"
  );
  for (const label of [
    "开始检测",
    "停止检测",
    "刷新链接",
    "清空结果",
    "导出结果"
  ]) {
    assert.match(zhSource, new RegExp(label));
  }
  assert.doesNotMatch(textSource, /source(?:Checking|Importing|Exporting):/);
  assert.doesNotMatch(zhSource, /\b(?:checking|reloading):/);
});

test("service cards use the shared status switch without legacy action labels", () => {
  assert.match(textSource, /publicTitle: "我的订阅源"/);
  for (const key of [
    "publicEnable",
    "publicDisable",
    "turnstileEnable",
    "turnstileDisable",
    "telegramEnable",
    "telegramDisable",
    "umamiEnable",
    "umamiDisable",
    "proxyEnable",
    "proxyDisable",
    "converted"
  ]) {
    assert.doesNotMatch(textSource, new RegExp(`\\b${key}:`));
  }
  assert.doesNotMatch(settingsSource, /maintenanceText\.publicOpen\b/);
  assert.doesNotMatch(settingsSource, /maintenanceText\.publicCopy\b/);
  assert.doesNotMatch(settingsSource, /copyPublicSource/);
});

test("shared translations omit superseded admin page copy", async () => {
  const [zhSource, enSource, typeSource] = await Promise.all([
    readFile(new URL("../../src/i18n/zh.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/en.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/type.ts", import.meta.url), "utf8")
  ]);
  for (const source of [zhSource, enSource, typeSource]) {
    const adminCopy = source.slice(source.indexOf("admin:"), source.indexOf("linkCheck:"));
    const linkCheckCopy = source.slice(source.indexOf("linkCheck:"), source.indexOf("form:"));
    const githubCopy = source.slice(source.indexOf("githubSettings:"), source.indexOf("status:"));
    assert.doesNotMatch(adminCopy, /\b(?:refresh|tableTool):/);
    assert.doesNotMatch(linkCheckCopy, /\b(?:eyebrow|title|description):/);
    assert.doesNotMatch(githubCopy, /\b(?:title|description|enabled|disabled|saveFailed):/);
  }
});

test("settings cards load source and security independently", () => {
  assert.match(settingsSource, /loadSourceSettingsCard/);
  assert.match(securityCardSource, /async function loadSettings\(/);
  assert.match(settingsSource, /sourceSettingsError/);
  assert.match(securityCardSource, /const \[loadError, setLoadError\]/);
  assert.doesNotMatch(
    settingsSource,
    /if \(sourceSettingsLoading\)[\s\S]*AdminSystemSettingsSkeleton/
  );
});

test("site and management settings associate controls with their help text", () => {
  const managementSources = `${settingsSource}\n${securityCardSource}`;

  for (const id of [
    "site-identity-description",
    "site-icon-help",
    "home-copy-settings-description",
    "footer-settings-description",
    "footer-json-help",
    "security-settings-description",
    "factory-reset-description",
    "factory-reset-warning",
    "backup-settings-description",
    "backup-settings-help"
  ]) {
    assert.match(managementSources, new RegExp(`id=["']${id}["']`));
  }

  for (const description of [
    "site-identity-description",
    "site-icon-help",
    "home-copy-settings-description",
    "footer-settings-description footer-json-help",
    "security-settings-description",
    "factory-reset-description factory-reset-warning",
    "backup-settings-description backup-settings-help"
  ]) {
    assert.match(
      managementSources,
      new RegExp(`aria-describedby=["']${description}["']`)
    );
  }

  assert.match(
    settingsSource,
    /aria-describedby="site-icon-help site-icon-upload-status admin-operation-status"\s+aria-label=\{maintenanceText\.siteIconUpload\}/
  );
  assert.match(settingsSource, /formId="about-settings"/);
  assert.match(legalCardSource, /const descriptionId = `\$\{formId\}-description`/);
  assert.match(legalCardSource, /id=\{descriptionId\}/);
  assert.match(legalCardSource, /aria-describedby=\{descriptionId\}/);
});

test("admin operation results use the existing visible status as a live region", () => {
  assert.match(
    adminSource,
    /aria-atomic="true"\s+aria-live="polite"\s+className="admin-status"[\s\S]{0,100}role="status"/
  );
  assert.doesNotMatch(adminSource, /className="(?:settings|security|backup)-[^" ]*status-live"/);
});

test("confirmation dialogs associate their shared title and visible description", () => {
  assert.match(dialogComponentSource, /description\?: ReactNode/);
  assert.match(dialogComponentSource, /descriptionId\?: string/);
  assert.match(dialogComponentSource, /aria-describedby=\{resolvedDescriptionId\}/);
  assert.match(dialogComponentSource, /aria-labelledby=\{titleId\}/);
  assert.match(dialogComponentSource, /<h2 id=\{titleId\}>\{title\}<\/h2>/);

  assert.match(
    dialogComponentSource,
    /function AdminConfirmDialog\([\s\S]*?description=\{description\}/
  );
  assert.match(
    dialogComponentSource,
    /<p className="dialog-description" id=\{resolvedDescriptionId\}>/
  );

  for (const id of [
    "content-convert-dialog-description",
    "tool-editor-dialog-description",
    "article-editor-dialog-description",
    "content-source-dialog-description",
    "telegram-message-dialog-description",
    "category-action-dialog-description",
    "delete-tool-dialog-description",
    "delete-article-dialog-description",
    "delete-content-source-dialog-description",
    "unsaved-settings-dialog-description",
    "backup-restore-dialog-description",
    "factory-reset-dialog-description"
  ]) {
    assert.match(adminSource, new RegExp(`descriptionId=["']${id}["']`));
  }

  for (const source of [adminSource, dialogComponentSource]) {
    assert.doesNotMatch(source, /admin-confirm-dialog-description|content-convert-description|telegram-message-description/);
  }
});

test("settings validation marks and focuses the first invalid field", () => {
  assert.match(adminSource, /id="admin-operation-status"/);
  assert.match(settingsSource, /setFooterInvalidField\(field\)/);
  assert.match(settingsSource, /data-footer-json="social"/);
  assert.match(settingsSource, /data-footer-json="groups"/);
  assert.match(settingsSource, /aria-invalid=\{footerInvalidField === "social"\}/);
  assert.match(settingsSource, /aria-invalid=\{footerInvalidField === "groups"\}/);
  assert.match(settingsSource, /querySelector<HTMLTextAreaElement>[\s\S]{0,100}\.focus\(\)/);
  assert.match(securityCardSource, /reject\("current"/);
  assert.match(securityCardSource, /reject\("new"/);
  assert.match(securityCardSource, /reject\("confirm"/);
  assert.match(securityCardSource, /data-security-field="current"/);
  assert.match(securityCardSource, /data-security-field="new"/);
  assert.match(securityCardSource, /data-security-field="confirm"/);
  assert.match(securityCardSource, /querySelector<HTMLInputElement>[\s\S]{0,100}\.focus\(\)/);
});

test("settings file pickers expose success and invalid states without changing their layout", () => {
  assert.match(settingsSource, /id="site-icon-upload-status"/);
  assert.match(settingsSource, /id="backup-file-status"/);
  assert.match(settingsSource, /aria-live="polite" className="visually-hidden"/);
  assert.match(settingsSource, /aria-invalid=\{siteIconFileInvalid\}/);
  assert.match(settingsSource, /aria-invalid=\{backupFileInvalid\}/);
  assert.match(settingsSource, /setSiteIconFileInvalid\(true\)/);
  assert.match(settingsSource, /setBackupFileInvalid\(true\)/);
  assert.match(settingsSource, /site-icon-help site-icon-upload-status admin-operation-status/);
  assert.match(settingsSource, /backup-settings-description backup-settings-help backup-file-status admin-operation-status/);
});

test("backup restore preflight requires the current format and reports actual data counts", () => {
  assert.match(maintenanceSource, /SUPPORTED_BACKUP_VERSION = "4"/);
  assert.match(maintenanceSource, /payload\.version !== SUPPORTED_BACKUP_VERSION/);
  assert.match(maintenanceSource, /"telegramMessages"/);
  assert.match(maintenanceSource, /BACKUP_DATA_FIELDS\.some\(\(field\) => !Array\.isArray\(data\[field\]\)\)/);
  assert.match(maintenanceSource, /counts: readBackupCounts\(data\)/);
  assert.match(maintenanceSource, /telegramMessages: readBackupCount\(data\.telegramMessages\)/);
  assert.doesNotMatch(maintenanceSource, /readBackupCounts\(payload\.counts/);
  assert.match(settingsSource, /maintenanceText\.backupRestoreConfirm\(backupPayload\.counts\)/);
  assert.match(textSource, /counts\.telegramMessages/);
  assert.match(textSource, /counts\.settings/);
});

test("backup selection rejects files over the shared ten megabyte limit before reading", () => {
  assert.match(maintenanceSource, /MAX_BACKUP_FILE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(maintenanceSource, /file\.size > MAX_BACKUP_FILE_BYTES/);
  assert.match(settingsSource, /validateBackupFileSize\(file, maintenanceText\);\s+const payload = JSON\.parse\(await file\.text\(\)\)/);
  assert.match(textSource, /backupTooLarge: "备份文件请控制在 10MB 以内。"/);
  assert.match(textSource, /backupTooLarge: "Keep the backup file under 10MB."/);
});

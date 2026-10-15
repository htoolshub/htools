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
const stylesSource = await readFile(
  new URL("../../src/styles.css", import.meta.url),
  "utf8"
);
const maintenanceUtilitySource = await readFile(
  new URL("../../src/admin-maintenance.ts", import.meta.url),
  "utf8"
);
const helpersSource = await readFile(
  new URL("../../src/admin-helpers.ts", import.meta.url),
  "utf8"
);
const maintenanceSource = adminSource.slice(
  adminSource.indexOf("type AdminMaintenanceSection"),
  adminSource.indexOf("function getLinkCheckResultText")
);
const linkCheckSkeletonSource = await readFile(
  new URL("../../src/components/admin-skeletons/LinkCheckSkeleton.tsx", import.meta.url),
  "utf8"
);

test("import/export and link check are separate settings navigation entries", () => {
  const settingsNavigation = adminSource.slice(
    adminSource.indexOf('<span className="admin-sidebar-section">{t.admin.settings}</span>'),
    adminSource.indexOf('<div className="admin-sidebar-bottom">')
  );

  assert.match(
    settingsNavigation,
    /selectAdminView\("import-export"\)[\s\S]*?<ArrowRightLeft size=\{18\} \/>[\s\S]*?maintenanceText\.importExportTab/
  );
  assert.match(
    settingsNavigation,
    /selectAdminView\("link-check"\)[\s\S]*?<ShieldCheck size=\{18\} \/>[\s\S]*?maintenanceText\.linkCheckTab/
  );
  assert.match(
    settingsNavigation,
    /selectAdminView\("import-export"\)[\s\S]*?selectAdminView\("link-check"\)[\s\S]*?selectAdminView\("system"\)/
  );
  assert.match(
    adminSource,
    /function AdminSortButton[\s\S]*?<ArrowDownUp size=\{16\} \/>/
  );
});

test("maintenance views have independent admin paths and direct rendering", () => {
  assert.match(
    helpersSource,
    /\| "import-export"[\s\S]*?\| "link-check"/
  );
  assert.match(helpersSource, /"import-export": "import-export"/);
  assert.match(helpersSource, /"link-check": "check"/);
  assert.match(helpersSource, /system: "settings\/site"/);
  assert.match(helpersSource, /"\/admin\/settings\/services"/);
  assert.match(helpersSource, /"\/admin\/settings\/management"/);
  assert.match(
    adminSource,
    /adminView === "import-export" \|\| adminView === "link-check"[\s\S]*?<AdminLinkCheckPanel[\s\S]*?section=\{adminView\}/
  );
  assert.match(maintenanceSource, /section === "import-export" \? \(/);
});

test("obsolete in-page maintenance navigation is removed", () => {
  assert.doesNotMatch(adminSource, /admin-maintenance-topbar-slot/);
  assert.doesNotMatch(adminSource, /admin-maintenance-tab/);
  assert.doesNotMatch(adminSource, /htools_admin_maintenance_section/);
  assert.doesNotMatch(adminSource, /selectMaintenanceSection/);
  assert.doesNotMatch(adminSource, /activeSection/);
  assert.doesNotMatch(stylesSource, /admin-maintenance-topbar-slot/);
  assert.doesNotMatch(stylesSource, /admin-maintenance-tabs/);
  assert.doesNotMatch(helpersSource, /\| "check"|check: "check"/);
});

test("import and export use separate responsive cards", () => {
  assert.match(textSource, /importExportTab: "导入导出"/);
  assert.match(textSource, /linkCheckTab: "链接检测"/);
  assert.match(textSource, /sourceTitle: "导入"/);
  assert.match(textSource, /sourceExportTitle: "导出"/);
  assert.match(maintenanceSource, /className="source-import-main source-export-card"/);
  assert.match(
    stylesSource,
    /\.source-import-panel\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 920px\)[\s\S]*?\.source-import-panel\s*\{\s*grid-template-columns: 1fr;/
  );
  assert.doesNotMatch(
    stylesSource,
    /\.admin-maintenance-panel:not\(\[hidden\]\),\s*\.admin-maintenance-link-panel/
  );
  assert.match(
    maintenanceSource,
    /className="source-report-grid source-export-summary"[\s\S]*?sourceExportCount[\s\S]*?tools\.length[\s\S]*?sourceExportFormat[\s\S]*?<strong>JSON<\/strong>[\s\S]*?sourceExportScopeAll/
  );
  assert.match(
    maintenanceSource,
    /className="primary-button"[\s\S]*?onClick=\{\(\) => void exportSource\(\)\}[\s\S]*?sourceExport/
  );
  assert.match(
    linkCheckSkeletonSource,
    /<AdminStatsSkeleton[\s\S]*?className="source-report-grid source-export-summary source-report-grid-skeleton"[\s\S]*?sourceExportCount[\s\S]*?sourceExportFormat[\s\S]*?sourceExportScope/
  );
  assert.match(
    stylesSource,
    /\.source-export-summary\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/
  );
});

test("source preview is stable before detection and uses shared text hierarchy", () => {
  assert.match(
    maintenanceSource,
    /const displayedSourcePreview = sourcePreview \?\? \{[\s\S]*?total: 0,[\s\S]*?willSkip: 0[\s\S]*?\};/
  );
  assert.match(
    maintenanceSource,
    /<div className="source-report-grid" aria-live="polite">[\s\S]*?displayedSourcePreview\.total[\s\S]*?displayedSourcePreview\.willSkip/
  );
  assert.doesNotMatch(
    maintenanceSource,
    /\{sourcePreview \? \(\s*<div className="source-report-grid"/
  );
  assert.doesNotMatch(adminSource, /sourceCheckedAt|source-message subtle/);
  assert.doesNotMatch(stylesSource, /\.source-message/);
  assert.match(
    linkCheckSkeletonSource,
    /className="source-report-grid source-report-grid-skeleton"[\s\S]*?sourceTotal[\s\S]*?sourceValid[\s\S]*?sourceDuplicate[\s\S]*?sourceWillSkip/
  );
  assert.match(
    stylesSource,
    /\.source-mode-row small\s*\{[\s\S]*?color: var\(--text\);[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 400;[\s\S]*?line-height: 1\.4;/
  );
  assert.match(
    stylesSource,
    /\.source-report-grid strong,\s*\.link-check-stats strong\s*\{[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 500;[\s\S]*?line-height: 1\.4;/
  );
});

test("imports accept URL and local htools.json through one preview pipeline", () => {
  assert.match(maintenanceUtilitySource, /export async function readToolSourceFile/);
  assert.match(maintenanceUtilitySource, /MAX_TOOL_SOURCE_FILE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(maintenanceSource, /const \[sourceFile, setSourceFile\] = useState<File \| null>\(null\)/);
  assert.match(maintenanceSource, /async function readSelectedSource/);
  assert.match(maintenanceSource, /readToolSourceFile\(sourceFile, maintenanceText\)/);
  assert.match(maintenanceSource, /className="source-mode-row source-file-field"/);
  assert.match(maintenanceSource, /accept="application\/json,\.json"/);
  assert.match(maintenanceSource, /maintenanceText\.sourceFileChoose/);
  assert.match(maintenanceSource, /maintenanceText\.sourceFileRemove/);
  assert.match(maintenanceSource, /maintenanceText\.sourceChecked\(getSourceOriginLabel\(\), preview\.total\)/);
  assert.match(maintenanceSource, /maintenanceText\.sourceImportSummary\(getSourceOriginLabel\(\), result\)/);
  assert.match(textSource, /sourceUrlOrigin: "\\u8ba2\\u9605\\u6e90 URL"/);
  assert.match(textSource, /sourceFileOrigin: \(name: string\)/);
  assert.ok(textSource.includes('sourceFileTooLarge: "\\u8ba2\\u9605\\u6e90\\u6587\\u4ef6'));
  assert.match(textSource, /sourceFileTooLarge: "Keep the subscription source file under 10MB\."/);
});

test("link-check skeleton preserves the initial empty result structure", () => {
  assert.match(
    linkCheckSkeletonSource,
    /section === "import-export"[\s\S]*?className="admin-maintenance-panel"[\s\S]*?className="source-import-panel"/
  );
  assert.match(
    linkCheckSkeletonSource,
    /className="admin-maintenance-panel admin-maintenance-link-panel"/
  );
  assert.match(
    linkCheckSkeletonSource,
    /className="link-check-empty-state admin-link-empty-skeleton"[\s\S]*?className="skeleton-shimmer skeleton-line is-medium"/
  );
  assert.match(stylesSource, /\.link-check-empty-state\s*\{[\s\S]*?min-height: 112px;/);
});

test("link-check results isolate large updates without changing the table layout", () => {
  assert.match(maintenanceSource, /aria-busy=\{checking\}[\s\S]*?className="link-check-table-wrap"/);
  assert.match(stylesSource, /\.link-check-table-wrap\s*\{[\s\S]*?contain: layout paint;/);
});

test("exports use dated filenames and report the downloaded tool count", () => {
  assert.match(
    maintenanceUtilitySource,
    /export function createDatedExportFilename[\s\S]*?return `htools-\$\{kind\}-\$\{stamp\}\.\$\{extension\}`;/
  );
  assert.match(
    adminSource,
    /createDatedExportFilename\("tools", "json"\)[\s\S]*?sourceExported\(source\.length\)/
  );
  assert.match(adminSource, /createDatedExportFilename\("backup", "json"\)/);
  assert.match(adminSource, /createDatedExportFilename\("link-check", "csv"\)/);
  assert.match(
    textSource,
    /sourceExported: \(count: number\) => `导出完成：共 \$\{count\} 个工具，文件已下载。`/
  );
  assert.match(
    textSource,
    /Export complete: \$\{count\} \$\{count === 1 \? "tool" : "tools"\}; the file has been downloaded\./
  );
});

test("backup file validation reports invalid and oversized files directly", () => {
  assert.match(
    adminSource,
    /error instanceof Error && error\.message === maintenanceText\.backupTooLarge[\s\S]*?maintenanceText\.backupTooLarge[\s\S]*?maintenanceText\.backupInvalid/
  );
});

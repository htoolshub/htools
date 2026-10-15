import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const [adminSource, legalCardSource, componentSource, helperSource, styles, telegramSource, zhSource, enSource] =
  await Promise.all([
    readFile(new URL("../../src/AdminApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/admin-settings/LegalSettingsCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/AdminMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/markdown-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/telegram.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/zh.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/i18n/en.ts", import.meta.url), "utf8")
  ]);

test("articles, legal pages, and Telegram reuse one Markdown editor", () => {
  assert.match(adminSource, /<AdminMarkdownEditor[\s\S]*?article-markdown-editor/);
  assert.equal(
    (adminSource.match(/<AdminMarkdownEditor\b/g) ?? []).length +
      (legalCardSource.match(/<AdminMarkdownEditor\b/g) ?? []).length,
    5
  );
  assert.match(legalCardSource, /className="source-url-field legal-markdown-editor"/);
  assert.match(adminSource, /className="telegram-message-body-field"/);
});

test("editor modes share one draft while each editor keeps an independent mode", () => {
  assert.match(helperSource, /MARKDOWN_EDITOR_MODES = \["edit", "preview"\]/);
  assert.match(componentSource, /useState<MarkdownEditorMode>\("edit"\)/);
  assert.match(componentSource, /controlledMode \?\? internalMode/);
  assert.match(componentSource, /onModeChange\?\.\(nextMode\)/);
  assert.match(componentSource, /value=\{value\}/);
  assert.match(componentSource, /onChange\(event\.target\.value\)/);
  assert.doesNotMatch(componentSource, /localStorage/);
  assert.doesNotMatch(helperSource, /htools_admin_markdown_editor_mode|readMarkdownEditorMode/);
  assert.doesNotMatch(componentSource, /admin-api|fetch\(|D1|telegram_messages/);
});

test("shared editor uses segmented modes, compact actions, and sanitized preview", () => {
  assert.match(componentSource, /admin-segmented-toggle admin-markdown-editor-mode/);
  assert.match(componentSource, /modeAside/);
  assert.match(componentSource, /ghost-button admin-markdown-tool/);
  assert.match(componentSource, /<MarkdownContent/);
  assert.match(componentSource, /mode === "edit"/);
  assert.match(styles, /\.admin-markdown-toolbar\s*\{[\s\S]*?gap:\s*6px/);
  assert.match(styles, /\.admin-workspace \.ghost-button\.admin-markdown-tool\s*\{[\s\S]*?height:\s*30px/);
  assert.doesNotMatch(componentSource, /headerAction|is-markdown-source/);
  assert.doesNotMatch(styles, /\.admin-markdown-editor textarea\.is-markdown-source/);
});

test("preview preserves the measured editing area height, including after refresh", () => {
  assert.match(componentSource, /const editPanelRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(componentSource, /new ResizeObserver\(updateHeight\)/);
  assert.match(
    componentSource,
    /mode === "preview" && editPanelHeight === 0/
  );
  assert.match(
    componentSource,
    /const showEditPanel = mode === "edit" \|\| isMeasuringPreviewHeight/
  );
  assert.match(componentSource, /visibility: "hidden"/);
  assert.match(componentSource, /height: `\$\{editPanelHeight\}px`/);
  assert.match(componentSource, /const mode = previewOnly \? "preview"/);
  assert.doesNotMatch(styles, /\.admin-markdown-editor-preview\s*\{[^}]*max-height:/);
  assert.match(styles, /\.admin-markdown-editor-edit\s*\{[\s\S]*?gap:\s*8px/);
});

test("legacy Telegram-only Markdown editor code is removed", () => {
  assert.doesNotMatch(telegramSource, /formatTelegramMarkdownSelection|TELEGRAM_MARKDOWN_ACTIONS/);
  assert.doesNotMatch(styles, /\.telegram-markdown-(?:toolbar|tool)/);
  assert.doesNotMatch(adminSource, /telegramBodyTextareaRef|applyTelegramMarkdownFormat/);
});

test("both locales expose the complete shared editor copy", () => {
  assert.match(zhSource, /edit:\s*"编辑内容"/);
  assert.match(zhSource, /preview:\s*"浏览内容"/);
  assert.match(enSource, /edit:\s*"Edit content"/);
  assert.match(enSource, /preview:\s*"View content"/);
  for (const source of [zhSource, enSource]) {
    assert.match(source, /markdownEditor:\s*\{/);
    for (const key of ["edit", "preview", "heading", "table", "link"]) {
      assert.match(source, new RegExp(`${key}:`));
    }
    assert.doesNotMatch(source, /assist:\s*"|source:\s*"/);
  }
});

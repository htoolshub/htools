import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Locale, Messages } from "../i18n";
import {
  MARKDOWN_EDITOR_ACTIONS,
  MARKDOWN_EDITOR_MODES,
  formatMarkdownSelection,
  type MarkdownEditorMode
} from "../markdown-editor";
import type { ProxySettings } from "../types";
import { ArticleBodySkeleton } from "./ArticleDetailContent";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export default function AdminMarkdownEditor({
  actions = MARKDOWN_EDITOR_ACTIONS,
  className = "",
  disabled = false,
  id,
  label,
  locale,
  modeAside,
  maxLength,
  mode: controlledMode,
  onChange,
  onModeChange,
  placeholder,
  preview,
  previewClassName = "",
  previewLocale,
  previewOnly = false,
  proxySettings,
  required = false,
  rows = 12,
  text,
  textareaClassName = "",
  value
}: {
  actions?: ReadonlyArray<(typeof MARKDOWN_EDITOR_ACTIONS)[number]>;
  className?: string;
  disabled?: boolean;
  id: string;
  modeAside?: ReactNode;
  label: string;
  locale: Locale;
  maxLength?: number;
  mode?: MarkdownEditorMode;
  onChange: (value: string) => void;
  onModeChange?: (mode: MarkdownEditorMode) => void;
  placeholder?: string;
  preview?: ReactNode;
  previewClassName?: string;
  previewLocale?: Locale;
  previewOnly?: boolean;
  proxySettings?: ProxySettings;
  required?: boolean;
  rows?: number;
  text: Messages["markdownEditor"];
  textareaClassName?: string;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const [editPanelHeight, setEditPanelHeight] = useState(0);
  const [internalMode, setInternalMode] = useState<MarkdownEditorMode>("edit");
  const mode = previewOnly ? "preview" : controlledMode ?? internalMode;
  const isMeasuringPreviewHeight =
    mode === "preview" && editPanelHeight === 0;
  const showEditPanel = mode === "edit" || isMeasuringPreviewHeight;

  useLayoutEffect(() => {
    if (!showEditPanel) return;
    const panel = editPanelRef.current;
    if (!panel) return;

    const updateHeight = () => {
      const nextHeight = panel.offsetHeight;
      if (nextHeight > 0) {
        setEditPanelHeight((currentHeight) =>
          currentHeight === nextHeight ? currentHeight : nextHeight
        );
      }
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [showEditPanel]);

  useEffect(() => {
    if (!previewOnly && required && mode === "preview" && !value.trim()) {
      setInternalMode("edit");
      onModeChange?.("edit");
    }
  }, [mode, onModeChange, previewOnly, required, value]);

  function selectMode(nextMode: MarkdownEditorMode) {
    if (nextMode === "preview" && required && !value.trim()) return;
    setInternalMode(nextMode);
    onModeChange?.(nextMode);
    if (nextMode !== "preview") {
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    }
  }

  function applyFormat(action: (typeof MARKDOWN_EDITOR_ACTIONS)[number]) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const edit = formatMarkdownSelection(
      value,
      textarea.selectionStart,
      textarea.selectionEnd,
      action,
      locale
    );
    onChange(edit.value);
    window.requestAnimationFrame(() => {
      const currentTextarea = textareaRef.current;
      if (!currentTextarea) return;
      currentTextarea.focus({ preventScroll: true });
      currentTextarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  return (
    <div className={`admin-markdown-editor ${className}`.trim()}>
      <div className="admin-markdown-editor-heading">
        {previewOnly ? <span>{label}</span> : <label htmlFor={id}>{label}</label>}
      </div>
      {!previewOnly ? (
        <div className="admin-markdown-mode-row">
          <div
            aria-label={text.modeLabel}
            className="admin-segmented-toggle admin-markdown-editor-mode"
            role="group"
          >
            {MARKDOWN_EDITOR_MODES.map((option) => (
              <button aria-pressed={mode === option}
                className={`admin-segmented-toggle-option ${mode === option ? "is-active" : ""}`.trim()}
                disabled={option === "preview" && required && !value.trim()}
                key={option}
                type="button"
                onClick={() => selectMode(option)}
              >
                {text.modes[option]}
              </button>
            ))}
          </div>
          {modeAside}
        </div>
      ) : null}
      <div className="admin-markdown-editor-input-row">
        {showEditPanel ? (
          <div
            aria-hidden={isMeasuringPreviewHeight || undefined}
            className="admin-markdown-editor-edit"
            ref={editPanelRef}
            style={isMeasuringPreviewHeight ? { visibility: "hidden" } : undefined}
          >
            <div
              aria-label={text.toolbarLabel}
              className="admin-markdown-toolbar"
              role="toolbar"
            >
              {actions.map((action) => {
                const actionLabel = text.actions[action];
                return (
                  <button aria-label={actionLabel}
                    className="ghost-button admin-markdown-tool"
                    disabled={disabled}
                    key={action}
                    title={actionLabel}
                    type="button"
                    onClick={() => applyFormat(action)}
                    onPointerDown={(event) => event.preventDefault()}
                  >
                    {actionLabel}
                  </button>
                  );
                })}
            </div>
            <textarea
              className={textareaClassName}
              disabled={disabled}
              id={id}
              maxLength={maxLength}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              ref={textareaRef}
              required={required}
              rows={rows}
              value={value}
            />
          </div>
        ) : (
          <section
            aria-label={text.preview}
            className={`admin-markdown-editor-preview ${previewClassName}`.trim()}
            style={editPanelHeight > 0 ? { height: `${editPanelHeight}px` } : undefined}
          >
            <Suspense fallback={<ArticleBodySkeleton />}>
              {preview ?? (
                value.trim() ? (
                  <MarkdownContent
                    content={value}
                    locale={previewLocale ?? locale}
                    proxySettings={proxySettings}
                  />
                ) : (
                  <p className="admin-markdown-editor-empty">{text.previewEmpty}</p>
                )
              )}
            </Suspense>
          </section>
        )}
      </div>
    </div>
  );
}

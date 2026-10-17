import type { FormEvent } from "react";
import AdminMarkdownEditor from "../AdminMarkdownEditor";
import { AdminSkeletonLines, getAdminLoadingProps } from "../admin-skeletons";
import type { Locale, Messages } from "../../i18n";
import type { ProxySettings } from "../../types";

export function LegalSettingsCard({
  busy,
  content,
  description,
  dirty,
  englishLabel,
  formId,
  loading = false,
  locale,
  onChange,
  onReset,
  onSubmit,
  proxySettings,
  resetLabel,
  saveLabel,
  text,
  title,
  chineseLabel,
  visible = true
}: {
  busy: boolean;
  content: { zh: string; en: string };
  description: string;
  dirty: boolean;
  englishLabel: string;
  formId: string;
  loading?: boolean;
  locale: Locale;
  onChange: (locale: Locale, value: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  proxySettings: ProxySettings;
  resetLabel: string;
  saveLabel: string;
  text: Messages["markdownEditor"];
  title: string;
  chineseLabel: string;
  visible?: boolean;
}) {
  const descriptionId = `${formId}-description`;

  return (
    <article className="source-public-card legal-settings-card" {...getAdminLoadingProps(loading, visible)}>
      <div>
        <h3>{title}</h3>
        <p id={descriptionId}>{description}</p>
      </div>
      <form
        aria-describedby={descriptionId}
        className="legal-settings-form"
        onSubmit={onSubmit}
      >
        <AdminMarkdownEditor
          className="source-url-field legal-markdown-editor"
          disabled={busy}
          id={`${formId}-zh-markdown`}
          label={chineseLabel}
          locale={locale}
          onChange={(value) => onChange("zh", value)}
          previewLocale="zh"
          proxySettings={proxySettings}
          rows={12}
          text={text}
          textareaClassName="about-settings-textarea legal-settings-textarea"
          value={content.zh}
        />
        <AdminMarkdownEditor
          className="source-url-field legal-markdown-editor"
          disabled={busy}
          id={`${formId}-en-markdown`}
          label={englishLabel}
          locale={locale}
          onChange={(value) => onChange("en", value)}
          previewLocale="en"
          proxySettings={proxySettings}
          rows={12}
          text={text}
          textareaClassName="about-settings-textarea legal-settings-textarea"
          value={content.en}
        />
        <div className="source-public-actions">
          <button className="primary-button" disabled={busy || !dirty} type="submit">
            {saveLabel}
          </button>
          <button className="ghost-button settings-reset-button"
            disabled={busy}
            type="button"
            onClick={onReset}
          >
            {resetLabel}
          </button>
        </div>
      </form>
      <AdminSkeletonLines loading={loading} visible={visible} />
    </article>
  );
}


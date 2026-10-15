import { useEffect, useRef, useState } from "react";
import { AlignLeft, Tags, Type } from "lucide-react";
import { generateAdminAi } from "../admin-api";
import type { AdminAiResult, AdminAiTask } from "../types";
import type { Locale } from "../i18n";
import AdminFieldAssistButton from "./AdminFieldAssistButton";

export default function AdminAiAction({
  available,
  disabled = false,
  disabledTitle,
  enabled,
  input,
  label,
  locale,
  onError,
  onResult,
  task,
  token
}: {
  available: boolean;
  disabled?: boolean;
  disabledTitle?: string;
  enabled: boolean;
  input: Record<string, unknown>;
  label: string;
  locale: Locale;
  onError: (error: unknown) => void;
  onResult: (result: AdminAiResult) => void;
  task: AdminAiTask;
  token: string;
}) {
  const requestRef = useRef<symbol | null>(null);
  const [loading, setLoading] = useState(false);
  const unavailable = !available || !enabled;
  const title = !enabled && disabledTitle ? disabledTitle : label;
  const Icon = task.endsWith("_tags")
    ? Tags
    : task === "tool_name" || task === "article_title" || task === "telegram_title"
      ? Type
      : AlignLeft;
  const mobileLabel = task.endsWith("_tags")
    ? locale === "zh" ? "\u6807\u7b7e" : "Tags"
    : task.endsWith("_summary")
      ? locale === "zh" ? "\u6458\u8981" : "Summary"
      : task.endsWith("_description")
        ? locale === "zh" ? "\u7b80\u4ecb" : "Desc"
        : task.endsWith("_name")
          ? locale === "zh" ? "\u540d\u79f0" : "Name"
          : locale === "zh" ? "\u6807\u9898" : "Title";

  useEffect(() => () => {
    requestRef.current = null;
  }, []);

  if (!available) return null;

  async function run() {
    if (disabled || unavailable || requestRef.current) return;
    const request = Symbol();
    requestRef.current = request;
    setLoading(true);
    try {
      const result = await generateAdminAi(task, input, locale, token);
      if (requestRef.current === request) onResult(result);
    } catch (error) {
      if (requestRef.current === request) onError(error);
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <AdminFieldAssistButton
      busy={loading}
      className="admin-ai-action-button"
      disabled={disabled}
      icon={<Icon size={16} />}
      label={label}
      mobileLabel={mobileLabel}
      onClick={() => void run()}
      onUnavailable={() => onError(Object.assign(
        new Error("Workers AI is disabled."),
        { code: "AI_DISABLED" }
      ))}
      unavailable={unavailable}
      unavailableTitle={title}
    />
  );
}

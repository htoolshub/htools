import { CheckCircle2, Circle, SquarePen, Trash2 } from "lucide-react";
import { formatAdminDate } from "../../admin-helpers";
import { cleanArticleDisplayText, getArticleDisplayTitle, type getArticleText } from "../../article-helpers";
import { CompactTagRow } from "../../shared-ui";
import type { getTelegramText } from "../../telegram";
import type { ArticleSummary } from "../../types";
import { useAdminCardActionMenu } from "../../useAdminCardActionMenu";
import { AdminTelegramPushButton } from "../AdminTelegramPushButton";
import { AdminCardActionMenu } from "../AdminCardActionMenu";
import type { Messages } from "../../i18n";

export function AdminArticleCard({
  article,
  articleText,
  isBusy,
  onBrowse,
  onDelete,
  onEdit,
  onTelegram,
  onTogglePublished,
  t,
  telegramEnabled,
  telegramText
}: {
  article: ArticleSummary;
  articleText: ReturnType<typeof getArticleText>;
  isBusy: boolean;
  onBrowse: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTelegram: () => void;
  onTogglePublished: () => void;
  t: Messages;
  telegramEnabled: boolean;
  telegramText: ReturnType<typeof getTelegramText>;
}) {
  const actions = useAdminCardActionMenu(`article:${article.id}`);
  const displayDate = formatAdminDate(
    article.published_at ?? article.updated_at ?? article.created_at
  );
  const displayTitle = getArticleDisplayTitle(article);

  return (
    <article className="admin-tool-card admin-article-card">
      <div className="admin-tool-card-head">
        <div className="admin-tool-title">
          <div className="admin-tool-title-row">
            <h2>{displayTitle}</h2>
          </div>
          <div className="admin-tool-title-meta">
            {displayDate ? <span>{displayDate}</span> : null}
            <span>
              {article.published
                ? articleText.statusPublished
                : articleText.statusDraft}
            </span>
          </div>
        </div>
        <div className="admin-tool-card-actions" ref={actions.rootRef}>
          {telegramEnabled ? (
            <AdminTelegramPushButton
              disabled={isBusy}
              label={`${telegramText.action}: ${displayTitle}`}
              onClick={() => {
                actions.close();
                onTelegram();
              }}
            />
          ) : null}
          <button className={`icon-button admin-article-publish-button ${
              article.published ? "is-active" : ""
            }`}
            type="button"
            aria-label={
              article.published
                ? articleText.statusPublished
                : articleText.publishedLabel
            }
            aria-pressed={article.published}
            disabled={isBusy}
            onClick={() => {
              actions.close();
              onTogglePublished();
            }}
          >
            {article.published ? (
              <CheckCircle2 size={16} />
            ) : (
              <Circle size={16} />
            )}
          </button>
          <AdminCardActionMenu
            actions={actions}
            label={t.actions.menu(displayTitle)}
            triggerDisabled={isBusy}
            items={[
              {
                key: "edit",
                label: articleText.editArticle,
                shortLabel: articleText.editAction,
                icon: <SquarePen size={18} />,
                disabled: isBusy,
                onSelect: onEdit
              },
              {
                key: "delete",
                label: articleText.deleteArticle,
                shortLabel: articleText.deleteAction,
                icon: <Trash2 size={16} />,
                disabled: isBusy,
                danger: true,
                onSelect: onDelete
              }
            ]}
          />
        </div>
      </div>

      <p className="admin-tool-description">{cleanArticleDisplayText(article.summary)}</p>

      <div className="admin-tool-links">
        <div className="admin-tool-link-row" title={articleText.browseArticle}>
          <button
            className="admin-tool-link-text telegram-push-view-link"
            type="button"
            onClick={onBrowse}
          >
            {articleText.browseArticle}
          </button>
        </div>
      </div>

      <div className="admin-tool-card-footer">
        <CompactTagRow fallbackCategory={article.category} tags={article.tags} />
      </div>
    </article>
  );
}

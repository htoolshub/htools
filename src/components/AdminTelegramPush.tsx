import { CheckCircle2, ChevronDown, Circle, SquarePen, Trash2 } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { formatAdminDate } from "../admin-helpers";
import { cleanArticleDisplayText } from "../article-helpers";
import type { Locale, Messages } from "../i18n";
import { proxifyUrl } from "../proxy";
import { CompactTagRow, SkeletonVisibility } from "../shared-ui";
import { escapeTelegramPreviewHashtags, getTelegramText, type TelegramPushResource } from "../telegram";
import { getToolInitials } from "../tool-helpers";
import type { ProxySettings, TelegramPushRecord } from "../types";
import { useAdminCardActionMenu } from "../useAdminCardActionMenu";
import { AdminEmptyState, AdminInitialLoadError } from "./AdminPanelStates";
import { AdminResourceCardSkeletonGrid } from "./admin-skeletons";
import { ArticleBodySkeleton } from "./ArticleDetailContent";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

type TelegramManagementText = ReturnType<typeof getTelegramText>["management"];

export function AdminTelegramPushPanel({
  hasActiveFilter,
  hasMore,
  isLoading,
  isLoadingMore,
  loadError,
  onClearFilters,
  onCreate,
  onDelete,
  onEdit,
  onLoadMore,
  onOpenSettings,
  onPush,
  onPushedStatus,
  onRetry,
  onView,
  records,
  serviceEnabled,
  settingsLoading,
  showSkeletons,
  t,
  text,
}: {
  hasActiveFilter: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadError: string | null;
  onClearFilters: () => void;
  onCreate: () => void;
  onDelete: (record: TelegramPushRecord) => void;
  onEdit: (record: TelegramPushRecord) => void;
  onLoadMore: () => void;
  onOpenSettings: () => void;
  onPush: (record: TelegramPushRecord) => void;
  onPushedStatus: () => void;
  onRetry: () => void;
  onView: (record: TelegramPushRecord) => void;
  records: TelegramPushRecord[];
  serviceEnabled: boolean;
  settingsLoading: boolean;
  showSkeletons: boolean;
  t: Messages;
  text: TelegramManagementText;
}) {
  const serviceUnavailable = !settingsLoading && !serviceEnabled;

  return (
    <>
      {serviceUnavailable && records.length > 0 ? (
        <p className="telegram-push-service-note">{text.serviceDisabled}</p>
      ) : null}

      {isLoading && records.length === 0 ? (
        <SkeletonVisibility visible={showSkeletons}>
          <AdminResourceCardSkeletonGrid ariaLabel={text.title} />
        </SkeletonVisibility>
      ) : loadError && records.length === 0 ? (
        <AdminInitialLoadError message={loadError} onRetry={onRetry} t={t} />
      ) : records.length ? (
        <>
          <section className="admin-tool-grid" aria-label={text.title}>
            {records.map((record) => (
              <TelegramPushRecordCard
                key={record.id}
                onDelete={() => onDelete(record)}
                onEdit={() => onEdit(record)}
                onPush={() => onPush(record)}
                onPushedStatus={onPushedStatus}
                onView={() => onView(record)}
                record={record}
                serviceEnabled={serviceEnabled}
                text={text}
              />
            ))}
          </section>
          {hasMore ? (
            <div className="content-flow-load-more">
              <button className="ghost-button" disabled={isLoadingMore}
                type="button"
                onClick={onLoadMore}
              >
                {text.loadMore}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <AdminEmptyState
          action={
            serviceUnavailable
              ? { label: text.serviceDisabledAction, onClick: onOpenSettings }
              : hasActiveFilter
                ? {
                    label: t.actions.clearFilters,
                    onClick: onClearFilters,
                    tone: "ghost"
                  }
                : { label: text.addPush, onClick: onCreate }
          }
          description={
            serviceUnavailable
              ? text.serviceDisabledDescription
              : hasActiveFilter
                ? text.noMatchDescription
                : text.emptyDescription
          }
          title={
            serviceUnavailable
              ? text.serviceDisabledTitle
              : hasActiveFilter
                ? text.noMatchTitle
                : text.emptyTitle
          }
        />
      )}
    </>
  );
}

function TelegramPushRecordCard({
  onDelete,
  onEdit,
  onPush,
  onPushedStatus,
  onView,
  record,
  serviceEnabled,
  text
}: {
  onDelete: () => void;
  onEdit: () => void;
  onPush: () => void;
  onPushedStatus: () => void;
  onView: () => void;
  record: TelegramPushRecord;
  serviceEnabled: boolean;
  text: TelegramManagementText;
}) {
  const actions = useAdminCardActionMenu(`telegram-push:${record.id}`);
  const pushed = record.syncStatus !== "not_pushed";
  const displayDate = formatAdminDate(record.sentAt || record.updatedAt);
  const summary = cleanArticleDisplayText(
    record.resource?.description || record.messageMarkdown
  );
  const tags = record.resource?.tags ?? [];
  const category = record.resource?.category ?? "";

  return (
    <article className="admin-tool-card admin-article-card">
      <div className="admin-tool-card-head">
        <div className="admin-tool-title">
          <div className="admin-tool-title-row">
            <h2>{record.title}</h2>
          </div>
          <div className="admin-tool-title-meta">
            {displayDate ? <span>{displayDate}</span> : null}
          </div>
        </div>
        <div className="admin-tool-card-actions" ref={actions.rootRef}>
          <button aria-label={pushed ? text.statusPushed : text.pushAction}
            aria-pressed={pushed}
            className={`icon-button admin-article-publish-button ${
              pushed ? "is-active" : ""
            }`}
            disabled={!pushed && !serviceEnabled}
            title={pushed ? text.statusPushed : text.pushAction}
            type="button"
            onClick={() => {
              actions.close();
              if (pushed) {
                onPushedStatus();
              } else {
                onPush();
              }
            }}
          >
            {pushed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
          </button>
          <button aria-expanded={actions.open}
            aria-haspopup="menu"
            aria-label={`${record.title} actions`}
            className={`icon-button admin-tool-menu-trigger ${
              actions.open ? "is-active" : ""
            }`}
            ref={actions.triggerRef}
            type="button"
            onClick={() => actions.setOpen((current) => !current)}
            onKeyDown={actions.handleTriggerKeyDown}
          >
            <ChevronDown size={17} />
          </button>
          {actions.open ? (
            <div
              className="admin-tool-action-menu"
              onKeyDown={actions.handleMenuKeyDown}
              role="menu"
            >
              {record.resource ? (
                <button disabled={!serviceEnabled}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    actions.close();
                    onEdit();
                  }}
                >
                  <SquarePen size={18} />
                  <span className="admin-action-label-full">{text.editAction}</span>
                  <span className="admin-action-label-short">{text.editActionShort}</span>
                </button>
              ) : null}
              <button className="danger"
                role="menuitem"
                type="button"
                onClick={() => {
                  actions.close();
                  onDelete();
                }}
              >
                <Trash2 size={16} />
                <span className="admin-action-label-full">{text.deleteAction}</span>
                <span className="admin-action-label-short">{text.deleteActionShort}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <p className="admin-tool-description">{summary}</p>
      <div className="admin-tool-links">
        <div className="admin-tool-link-row" title={text.viewAction}>
          <button className="admin-tool-link-text telegram-push-view-link"
            type="button"
            onClick={onView}
          >
            {text.viewAction}
          </button>
        </div>
      </div>
      <div className="admin-tool-card-footer">
        <CompactTagRow fallbackCategory={category} tags={tags} />
      </div>
    </article>
  );
}
export function TelegramMessagePreview({
  content,
  mediaEnabled,
  mediaUrl,
  locale,
  proxySettings,
  resource
}: {
  content: string;
  mediaEnabled: boolean;
  mediaUrl: string;
  locale: Locale;
  proxySettings: ProxySettings;
  resource: TelegramPushResource;
}) {
  const source = proxifyUrl(mediaUrl, proxySettings, {
    resourceType: "image"
  });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [source]);
  return (
    <div className={`telegram-channel-preview-message ${mediaEnabled ? "has-photo" : ""}`.trim()}>
      {mediaEnabled ? (
        <div className="telegram-channel-photo-message">
          <div className="telegram-channel-photo-image">
            {!source || imageFailed ? (
              <span className="telegram-channel-photo-fallback">
                <strong>{getToolInitials(resource.title)}</strong>
              </span>
            ) : (
              <>
                {!imageLoaded ? (
                  <span
                    className="skeleton-shimmer telegram-channel-photo-loading"
                    aria-hidden="true"
                  />
                ) : null}
                <img
                  alt=""
                  className={imageLoaded ? "is-loaded" : ""}
                  decoding="async"
                  loading="eager"
                  onError={() => setImageFailed(true)}
                  onLoad={() => setImageLoaded(true)}
                  src={source}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<ArticleBodySkeleton />}>
        <MarkdownContent
          content={escapeTelegramPreviewHashtags(content)}
          locale={locale}
          proxySettings={proxySettings}
        />
      </Suspense>
    </div>
  );
}

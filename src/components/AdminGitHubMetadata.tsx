import { Github } from "lucide-react";
import { formatGitHubCount, formatGitHubUpdatedAt } from "../admin-display";
import type { GitHubToolMetadata } from "../types";
import AdminDetailPlaceholder from "./AdminDetailPlaceholder";
import AdminFieldAssistButton from "./AdminFieldAssistButton";
import { AdminSkeletonLines, getAdminLoadingProps } from "./admin-skeletons";

type AdminGitHubMetadataDetailText = {
  empty: string;
  failed: string;
  forks: string;
  language: string;
  license: string;
  loading: string;
  stars: string;
  title: string;
  updatedAt: string;
};

export function AdminGitHubMetadataButton({
  disabled = false,
  label,
  mobileLabel,
  onClick,
  onUnavailable,
  unavailable = false,
  unavailableTitle
}: {
  disabled?: boolean;
  label: string;
  mobileLabel: string;
  onClick: () => void;
  onUnavailable?: () => void;
  unavailable?: boolean;
  unavailableTitle?: string;
}) {
  return (
    <AdminFieldAssistButton
      className="tool-github-metadata-button"
      disabled={disabled}
      icon={<Github size={16} />}
      label={label}
      mobileLabel={mobileLabel}
      onClick={onClick}
      onUnavailable={onUnavailable}
      unavailable={unavailable}
      unavailableTitle={unavailableTitle}
    />
  );
}

export function AdminGitHubMetadataCard({
  canLoad,
  detailText,
  failed,
  loading,
  metadata,
  previewLoading
}: {
  canLoad: boolean;
  detailText: AdminGitHubMetadataDetailText;
  failed: boolean;
  loading: boolean;
  metadata: GitHubToolMetadata | null;
  previewLoading: boolean;
}) {
  if (!canLoad && !metadata) return null;

  const isLoading = previewLoading || loading;
  const showDetails = Boolean(metadata) || isLoading;
  const detailItems = [
    { label: detailText.stars, value: metadata ? formatGitHubCount(metadata.stars) : "" },
    { label: detailText.forks, value: metadata ? formatGitHubCount(metadata.forks) : "" },
    { label: detailText.language, value: metadata ? metadata.language || "-" : "" },
    { label: detailText.license, value: metadata ? metadata.license || "-" : "" },
    { label: detailText.updatedAt, value: metadata ? formatGitHubUpdatedAt(metadata.updatedAt) || "-" : "" }
  ];

  return (
    <div
      className={`tool-form-field tool-github-detail-field ${showDetails ? "" : "is-placeholder"}`.trim()}
    >
      <span className="tool-form-label">{detailText.title}</span>
      <section className="tool-github-detail-card" {...getAdminLoadingProps(isLoading)}>
        {showDetails ? (
          <>
            <div className="tool-github-detail-repo">
              <Github size={16} />
              <span>{metadata?.fullName ?? ""}</span>
            </div>
            <div className="tool-github-detail-grid">
              {detailItems.map((item) => (
                <div className="tool-github-detail-item" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <AdminDetailPlaceholder
            icon={<Github size={16} />}
          >
            {failed ? detailText.failed : detailText.empty}
          </AdminDetailPlaceholder>
        )}
        <AdminSkeletonLines loading={isLoading} />
      </section>
    </div>
  );
}

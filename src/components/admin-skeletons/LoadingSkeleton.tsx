export function getAdminLoadingProps(loading: boolean, visible = true) {
  return {
    "aria-busy": loading || undefined,
    "data-admin-loading": loading ? (visible ? "visible" : "pending") : undefined,
    inert: loading || undefined
  };
}

export function AdminSkeletonLines({
  loading,
  visible = true,
  compact = false
}: {
  loading: boolean;
  visible?: boolean;
  compact?: boolean;
}) {
  if (!loading) return null;

  return (
    <div
      aria-hidden="true"
      className={`admin-loading-lines${compact ? " is-compact" : ""}${visible ? "" : " is-pending"}`}
    >
      <span className="skeleton-shimmer skeleton-line is-medium" />
      <span className="skeleton-shimmer skeleton-line" />
      {!compact ? (
        <>
          <span className="skeleton-shimmer skeleton-line is-long" />
          <span className="skeleton-shimmer skeleton-line is-short" />
        </>
      ) : null}
    </div>
  );
}

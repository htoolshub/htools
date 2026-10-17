export function AdminResourceCardSkeletonGrid({ ariaLabel }: { ariaLabel: string }) {
  return (
    <section className="admin-tool-grid" aria-label={ariaLabel}>
      {Array.from({ length: 8 }).map((_, index) => (
        <AdminResourceCardSkeleton key={index} />
      ))}
    </section>
  );
}

export function AdminResourceCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="admin-tool-card admin-resource-card-skeleton"
    >
      <div className="admin-tool-title">
        <span className="skeleton-shimmer skeleton-line is-medium" />
      </div>
      <p className="admin-tool-description">
        <span className="skeleton-shimmer skeleton-line" />
      </p>
      <div className="admin-tool-links">
        <span className="skeleton-shimmer skeleton-line is-long" />
      </div>
      <div className="admin-tool-card-footer">
        <div className="tag-row">
          <span className="skeleton-shimmer skeleton-line is-short" />
        </div>
      </div>
    </article>
  );
}

import { ArticleDetailContentSkeleton } from "../ArticleDetailContent";
import type { getContentFlowText } from "../../admin-text";

export function ContentFlowSkeleton({
  contentText
}: {
  contentText: ReturnType<typeof getContentFlowText>;
}) {
  return (
    <section
      className="content-flow-layout content-flow-skeleton"
      aria-hidden="true"
    >
      <aside className="content-flow-rail">
        <div className="content-flow-section-head">
          <h2>{contentText.title}</h2>
        </div>

        <div className="content-source-list">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="content-source-group" key={index}>
              <span className="content-source-group-chevron" />
              <span className="skeleton-shimmer skeleton-line is-medium" />
            </div>
          ))}
        </div>
      </aside>

      <div className="content-flow-main">
        <div className="content-source-toolbar">
          <span className="skeleton-shimmer skeleton-line is-short" />
        </div>
        <div className="content-flow-main-scroll">
          <div className="content-item-list">
            {Array.from({ length: 4 }).map((_, index) => (
              <article className="content-item-card has-source-icon" key={index}>
                <div className="content-item-select">
                  <span className="content-item-title-row">
                    <strong><span className="skeleton-shimmer skeleton-line is-long" /></strong>
                    <time><span className="skeleton-shimmer skeleton-line is-long" /></time>
                  </span>
                  <span className="content-item-summary">
                    <span className="skeleton-shimmer skeleton-line is-long" />
                    <span className="skeleton-shimmer skeleton-line is-medium" />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      <aside className="content-flow-reader">
        <div className="content-reader-toolbar">
          <span className="skeleton-shimmer skeleton-line is-short" />
        </div>
        <div className="content-flow-reader-scroll">
          <ArticleDetailContentSkeleton />
        </div>
      </aside>
    </section>
  );
}

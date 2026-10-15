import { ChevronLeft } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { cleanArticleDisplayText, getArticleDisplayTitle, getArticleText, stripLeadingArticleDuplicates } from "../article-helpers";
import { formatAdminDate } from "../admin-helpers";
import { proxifyUrl } from "../proxy";
import { CompactTagRow, SkeletonLayoutMask } from "../shared-ui";
import type { Locale } from "../i18n";
import type { Article, ProxySettings } from "../types";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

type ArticleBackLink = {
  href: string;
  label: string;
};

export default function ArticleDetailContent({
  article,
  backLink,
  locale,
  proxySettings
}: {
  article: Article;
  backLink?: ArticleBackLink;
  locale: Locale;
  proxySettings: ProxySettings;
}) {
  const articleText = getArticleText(locale);
  const displayTitle = getArticleDisplayTitle(article);
  const displaySummary = cleanArticleDisplayText(article.summary);
  const displayDate = formatAdminDate(article.published_at ?? article.updated_at);
  const bodyContent = stripLeadingArticleDuplicates(
    article.content,
    displayTitle || article.title,
    displaySummary || article.summary,
    article.coverImage
  );

  return (
    <article className="article-detail-card">
      {backLink ? (
        <a className="ghost-button article-back-link" href={backLink.href}>
          <ChevronLeft size={16} />
          {backLink.label}
        </a>
      ) : null}

      <header className="article-detail-head">
        <div className="article-detail-meta">
          {article.category ? <span>{article.category}</span> : null}
          {displayDate ? (
            <span>{articleText.publishedOn(displayDate)}</span>
          ) : null}
        </div>
        <h1>{displayTitle}</h1>
        <p>{displaySummary}</p>
        <CompactTagRow fallbackCategory={article.category} tags={article.tags} />
      </header>

      <ArticleDetailCover proxySettings={proxySettings} src={article.coverImage} />

      <Suspense fallback={<ArticleBodySkeleton />}>
        <MarkdownContent
          content={bodyContent}
          locale={locale}
          proxySettings={proxySettings}
        />
      </Suspense>
    </article>
  );
}

export function ArticleDetailContentSkeleton({
  backLink,
  locale
}: {
  backLink?: ArticleBackLink;
  locale: Locale;
}) {
  const articleText = getArticleText(locale);

  return (
    <section className="article-detail-card article-detail-loading">
      {backLink ? (
        <SkeletonLayoutMask>
          <a className="ghost-button article-back-link" href={backLink.href}>
            <ChevronLeft size={16} />{backLink.label}
          </a>
        </SkeletonLayoutMask>
      ) : null}
      <SkeletonLayoutMask className="article-detail-head article-detail-head-skeleton">
        <div className="article-detail-meta">
          <span>Category</span>
          <span>{articleText.publishedOn("2026-07-18")}</span>
        </div>
        <h1>Article detail title placeholder</h1>
        <p>Article detail summary follows the final responsive typography.</p>
        <CompactTagRow tags={["Article", "Category", "Guide"]} />
      </SkeletonLayoutMask>
      <div className="article-detail-cover-frame article-cover-skeleton" aria-hidden="true" />
      <ArticleBodySkeleton />
    </section>
  );
}

function ArticleDetailCover({
  proxySettings,
  src
}: {
  proxySettings: ProxySettings;
  src: string;
}) {
  const proxiedSrc = proxifyUrl(src, proxySettings, { resourceType: "image" });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [proxiedSrc]);

  useEffect(() => {
    const image = imageRef.current;

    if (image?.complete && image.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [proxiedSrc]);

  if (!proxiedSrc || failed) {
    return null;
  }

  return (
    <figure
      className={`article-detail-cover-frame ${loaded ? "is-loaded" : ""}`}
      aria-hidden="true"
    >
      <img
        alt=""
        className="article-detail-cover"
        decoding="async"
        fetchPriority="high"
        loading="eager"
        ref={imageRef}
        src={proxiedSrc}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
      />
    </figure>
  );
}

export function ArticleBodySkeleton() {
  return (
    <SkeletonLayoutMask className="markdown-content article-body-skeleton">
      <h2>Article section heading</h2>
      <p>Article paragraph content follows the final Markdown typography and width.</p>
      <p>Additional paragraph content keeps the same spacing and responsive wrapping.</p>
      <h3>Article subsection heading</h3>
      <ul><li>Article list item</li><li>Article list item</li></ul>
    </SkeletonLayoutMask>
  );
}

import { ChevronLeft } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { getArticleDisplayTitle, getArticleText, stripLeadingArticleDuplicates } from "../article-helpers";
import { formatAdminDate } from "../admin-helpers";
import { proxifyUrl } from "../proxy";
import { CompactTagRow } from "../shared-ui";
import type { Locale } from "../i18n";
import type { Article, ProxySettings } from "../types";

const MarkdownContent = lazy(() => import("./MarkdownContent"));
const ArticleSummary = lazy(() => import("./MarkdownContent").then((module) => ({
  default: module.ArticleSummary
})));

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
  const displayDate = formatAdminDate(article.published_at ?? article.updated_at);
  const bodyContent = stripLeadingArticleDuplicates(
    article.content,
    displayTitle || article.title,
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
        <Suspense fallback={null}>
          <ArticleSummary content={bodyContent} summary={article.summary} />
        </Suspense>
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
  backLink
}: {
  backLink?: ArticleBackLink;
}) {
  return (
    <section className="article-detail-card article-detail-loading">
      {backLink ? (
        <a className="ghost-button article-back-link" href={backLink.href}>
          <ChevronLeft size={16} />{backLink.label}
        </a>
      ) : null}
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
    <div className="article-body-skeleton" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="article-body-skeleton-paragraph" key={index}>
          <span className="skeleton-shimmer skeleton-line" />
          <span className="skeleton-shimmer skeleton-line is-long" />
          <span className={`skeleton-shimmer skeleton-line ${index === 1 ? "is-short" : "is-medium"}`} />
        </div>
      ))}
    </div>
  );
}

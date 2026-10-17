import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8"
);
const markdownSource = await readFile(
  new URL("../../src/components/MarkdownContent.tsx", import.meta.url),
  "utf8"
);
const articleDetailSource = await readFile(
  new URL("../../src/components/ArticleDetailContent.tsx", import.meta.url),
  "utf8"
);
const siteHelpersSource = await readFile(
  new URL("../../src/site-helpers.ts", import.meta.url),
  "utf8"
);
const utilityMenuSource = await readFile(
  new URL("../../src/components/UtilityMenuControls.tsx", import.meta.url),
  "utf8"
);

test("homepage hero always resolves copy from the active locale", () => {
  assert.match(appSource, /getLocalizedHomeHeroContent\(siteSettings, locale, t\)/);
  assert.match(appSource, /useSiteSettings\(\)/);
  assert.match(appSource, /onLocaleChange=\{onLocaleChange\}/);
  assert.match(utilityMenuSource, /onLocaleChange\(option\.code\)/);
});

test("homepage hero keeps the original secondary action styling with the submit destination", () => {
  assert.match(
    appSource,
    /<PublicGlowAction href="\/tools">[\s\S]*?t\.home\.exploreAll[\s\S]*?<\/PublicGlowAction>/
  );
  assert.match(
    appSource,
    /className="ghost-button hero-ghost" href="\/submit">[\s\S]*?t\.actions\.submitTool[\s\S]*?<\/a>/
  );
  const submitAction = appSource.match(
    /<a className="ghost-button hero-ghost" href="\/submit">([\s\S]*?)<\/a>/
  )?.[1];
  assert.doesNotMatch(submitAction ?? "", /ArrowUpRight/);
});

test("homepage article action uses article-specific wording", () => {
  assert.match(appSource, /<PublicGlowAction href="\/articles">[\s\S]*?t\.home\.moreArticles/);
  assert.doesNotMatch(appSource, /t\.home\.morePosts/);
});

test("public tool and article tags use the shared category fallback", () => {
  assert.doesNotMatch(appSource, /function getToolDisplayTags/);
  assert.equal(
    (appSource.match(/fallbackCategory=\{tool\.category\}/g) ?? []).length,
    3
  );
  assert.equal(
    (appSource.match(/fallbackCategory=\{article\.category\}/g) ?? []).length +
      (articleDetailSource.match(/fallbackCategory=\{article\.category\}/g) ?? []).length,
    3
  );
});

test("公开文章卡片骨架保留真实内容区并只显示通用细线", () => {
  const skeleton = appSource.slice(
    appSource.indexOf("function ArticleItemSkeleton()"),
    appSource.indexOf("function AboutPage(")
  );
  assert.match(skeleton, /className="article-item article-item-skeleton" aria-hidden="true"/);
  for (const className of ["article-date", "tag-row-shell", "tag-row"]) {
    assert.match(skeleton, new RegExp(`className="${className}"`));
  }
  assert.match(skeleton, /<h3><span className="skeleton-shimmer skeleton-line/);
  assert.match(skeleton, /<p><span className="skeleton-shimmer skeleton-line/);
  assert.doesNotMatch(skeleton, /SkeletonLayoutMask|CompactTagRow|Clock3|placeholder|<img|<button|<a\s/);
  assert.equal((appSource.match(/<ArticleItemSkeleton\b/g) ?? []).length, 2);
});

test("关于和法律页面的加载共用通用正文骨架", () => {
  const skeleton = appSource.slice(
    appSource.indexOf("function AboutContentSkeleton()"),
    appSource.indexOf("function LegalPage(")
  );
  assert.match(skeleton, /return <ArticleBodySkeleton \/>/);
  assert.doesNotMatch(skeleton, /content|\.split\(|SkeletonLayoutMask/);
  assert.equal((appSource.match(/<AboutContentSkeleton \/>/g) ?? []).length, 4);
  assert.doesNotMatch(appSource, /<AboutContentSkeleton content=/);
});

test("locale selection persists globally and markdown controls follow document language", () => {
  assert.match(appSource, /localStorage\.setItem\("htools_locale", locale\)/);
  assert.match(markdownSource, /document\.documentElement\.lang/);
  assert.match(markdownSource, /startsWith\("zh"\)/);
});

test("markdown controls accept the active locale directly from each page", () => {
  assert.match(markdownSource, /locale\?: Locale/);
  assert.match(markdownSource, /getMarkdownCodeBlockLabels\(locale\)/);
  assert.match(articleDetailSource, /<MarkdownContent[\s\S]*locale=\{locale\}/);
  assert.match(appSource, /localStorage\.setItem\("htools_locale", locale\)/);
});

test("public routes synchronize localized document metadata through one helper", () => {
  assert.match(appSource, /syncDocumentMetadata\(\{/);
  assert.match(appSource, /t\.publicMeta\.aboutDescription/);
  assert.match(appSource, /t\.publicMeta\.privacyDescription/);
  assert.match(appSource, /t\.publicMeta\.termsDescription/);
  assert.doesNotMatch(appSource, /document\.title\s*=/);
  assert.match(siteHelpersSource, /export function syncDocumentMetadata/);
  assert.match(siteHelpersSource, /syncMetadataTag\("name", "description"/);
  assert.match(siteHelpersSource, /syncMetadataTag\("property", "og:title"/);
  assert.match(siteHelpersSource, /syncMetadataTag\("name", "twitter:title"/);
});

test("article detail metadata covers loading, success, and missing states", () => {
  assert.match(
    appSource,
    /if \(isLoading\) \{[\s\S]*t\.articlesPage\.description[\s\S]*if \(article\) \{/
  );
  assert.match(appSource, /description: articleDisplaySummary \|\| t\.articlesPage\.description/);
  assert.match(appSource, /type: "article"/);
  assert.match(appSource, /image: article\.coverImage/);
  assert.match(appSource, /imageAlt: articleDisplayTitle/);
  assert.match(appSource, /articleText\.notFoundDescription/);
});

test("public metadata keeps canonical URLs clean and removes stale share images", () => {
  assert.match(siteHelpersSource, /url\.search = ""/);
  assert.match(siteHelpersSource, /url\.hash = ""/);
  assert.match(siteHelpersSource, /link\[rel="canonical"\]/);
  assert.match(siteHelpersSource, /syncMetadataTag\("property", "og:url", canonicalUrl\)/);
  assert.match(siteHelpersSource, /"summary_large_image" : "summary"/);
  assert.match(siteHelpersSource, /syncMetadataTag\("property", "og:image"/);
  assert.match(siteHelpersSource, /removeMetadataTag\("property", "og:image"\)/);
  assert.match(siteHelpersSource, /removeMetadataTag\("name", "twitter:image"\)/);
});

test("homepage and article detail synchronize one reusable JSON-LD script", () => {
  assert.match(siteHelpersSource, /export function createWebsiteStructuredData/);
  assert.match(siteHelpersSource, /export function createArticleStructuredData/);
  assert.match(siteHelpersSource, /"@type": "WebSite"/);
  assert.match(siteHelpersSource, /"@type": "Article"/);
  assert.match(siteHelpersSource, /data-htools-structured-data/);
  assert.match(siteHelpersSource, /existingScripts\.forEach\(\(script\) => script\.remove\(\)\)/);
  assert.match(siteHelpersSource, /JSON\.stringify\(structuredData\)\.replace/);
  assert.match(appSource, /structuredData:[\s\S]*createWebsiteStructuredData/);
  assert.match(
    appSource,
    /structuredData:[\s\S]*isPreviewDocument[\s\S]*createArticleStructuredData/
  );
  assert.match(
    appSource,
    /publishedAt:[\s\S]*article\.published_at \?\?[\s\S]*article\.publishedAt/
  );
  assert.match(
    appSource,
    /modifiedAt:[\s\S]*article\.updated_at/
  );
});

import { ArrowUpRight, Wand2 } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { SiteSettings } from "./types";
import { getSiteDisplayName, getSiteSubtitle } from "./site-helpers";
import { getEffectiveTags } from "../shared/effective-tags";

export const SiteSettingsContext = createContext<SiteSettings | undefined>(undefined);

export function useSiteSettings() {
  const settings = useContext(SiteSettingsContext);

  if (!settings) {
    throw new Error("SiteSettingsContext is not available.");
  }

  return settings;
}

export function PublicGlowAction({
  children,
  className = "",
  disabled = false,
  href,
  onClick,
  showArrow = true,
  type = "button"
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  showArrow?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
}) {
  const content = (
    <>
      <span>{children}</span>
      {showArrow ? <ArrowUpRight aria-hidden="true" size={17} /> : null}
    </>
  );
  const actionClassName = `primary-button public-glow-action ${className}`.trim();

  if (href) {
    return (
      <a
        aria-disabled={disabled || undefined}
        className={actionClassName}
        href={disabled ? undefined : href}
        onClick={onClick as MouseEventHandler<HTMLAnchorElement> | undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={actionClassName}
      disabled={disabled}
      type={type}
      onClick={onClick as MouseEventHandler<HTMLButtonElement> | undefined}
    >
      {content}
    </button>
  );
}

export function isSiteIconDataUrl(value: string) {
  return /^data:image\/(?:png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon);base64,/i.test(
    value.trim()
  );
}

export function addSiteIconRetryParam(value: string, retryToken: number) {
  if (!retryToken || isSiteIconDataUrl(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    url.searchParams.set("htools_icon_retry", String(retryToken));
    return url.toString();
  } catch {
    return value;
  }
}

export function SiteBrandMark({
  className = "",
  iconSize = 25,
  strokeWidth = 2.2
}: {
  className?: string;
  iconSize?: number;
  strokeWidth?: number;
}) {
  const settings = useSiteSettings();
  const iconUrl = settings.iconUrl.trim();
  const [imageFailed, setImageFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const iconSrc = useMemo(
    () => addSiteIconRetryParam(iconUrl, retryToken),
    [iconUrl, retryToken]
  );

  useEffect(() => {
    setImageFailed(false);
    setRetryToken(0);
  }, [iconUrl]);

  function handleImageError() {
    if (!retryToken && !isSiteIconDataUrl(iconUrl)) {
      setRetryToken(Date.now());
      return;
    }

    setImageFailed(true);
  }

  return (
    <span
      className={`brand-mark ${className} ${
        iconUrl && !imageFailed ? "has-site-icon" : ""
      }`.trim()}
    >
      {iconUrl && !imageFailed ? (
        <img
          className="site-brand-icon"
          src={iconSrc}
          alt=""
          onError={handleImageError}
        />
      ) : (
        <Wand2 size={iconSize} strokeWidth={strokeWidth} />
      )}
    </span>
  );
}

export function SiteBrandIdentity({
  markClassName = "",
  showSubtitle = false
}: {
  markClassName?: string;
  showSubtitle?: boolean;
}) {
  const settings = useSiteSettings();
  const siteName = getSiteDisplayName(settings);

  return (
    <>
      <SiteBrandMark className={markClassName} />
      {showSubtitle ? (
        <span>
          <strong>{siteName}</strong>
          <small>{getSiteSubtitle(settings)}</small>
        </span>
      ) : (
        <span>{siteName}</span>
      )}
    </>
  );
}

export function SkeletonVisibility({
  children,
  visible
}: {
  children: ReactNode;
  visible: boolean;
}) {
  if (!visible) return null;
  return <>{children}</>;
}

export function CompactTagRow({
  fallbackCategory = "",
  tags,
  visibleCount: maxVisibleCount
}: {
  fallbackCategory?: string;
  tags: string[];
  visibleCount?: number;
}) {
  const displayTags = useMemo(
    () => getEffectiveTags(tags, fallbackCategory),
    [fallbackCategory, tags]
  );
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(displayTags.length);
  const visibleLimit = maxVisibleCount ?? fitCount;
  const visibleTags = displayTags.slice(0, Math.min(visibleLimit, displayTags.length));
  const hiddenCount = Math.max(displayTags.length - visibleTags.length, 0);

  useEffect(() => {
    if (maxVisibleCount !== undefined) {
      return;
    }

    const row = rowRef.current;
    const measure = measureRef.current;

    if (!row || !measure) {
      return;
    }

    const rowElement = row;
    const measureElement = measure;

    function updateFitCount() {
      const availableWidth = Math.floor(rowElement.clientWidth);

      if (availableWidth <= 0) {
        return;
      }

      const gap = Number.parseFloat(getComputedStyle(measureElement).columnGap || "0") || 0;
      const tagWidths = Array.from(
        measureElement.querySelectorAll<HTMLElement>("[data-tag-measure]")
      ).map((element) => Math.ceil(element.getBoundingClientRect().width));
      const moreWidths = new Map(
        Array.from(measureElement.querySelectorAll<HTMLElement>("[data-more-count]")).map(
          (element) => [
            Number(element.dataset.moreCount),
            Math.ceil(element.getBoundingClientRect().width)
          ]
        )
      );

      let nextFitCount = 0;

      for (let count = displayTags.length; count >= 0; count -= 1) {
        const hidden = displayTags.length - count;
        const tagsWidth = tagWidths
          .slice(0, count)
          .reduce((total, width, index) => total + width + (index > 0 ? gap : 0), 0);
        const moreWidth = hidden > 0 ? moreWidths.get(hidden) ?? 0 : 0;
        const totalWidth = tagsWidth + moreWidth + (count > 0 && hidden > 0 ? gap : 0);

        if (totalWidth <= availableWidth + 1) {
          nextFitCount = count;
          break;
        }
      }

      setFitCount((current) => (current === nextFitCount ? current : nextFitCount));
    }

    updateFitCount();

    const resizeObserver = new ResizeObserver(updateFitCount);
    resizeObserver.observe(rowElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [displayTags, maxVisibleCount]);

  return (
    <div className="tag-row-shell">
      <div className="tag-row" ref={rowRef}>
        {visibleTags.map((tag, index) => {
          const displayTag = tag.trim().replace(/^#+/, "");

          return (
            <span className="tag" key={`${displayTag}-${index}`}>
              {displayTag}
            </span>
          );
        })}
        {hiddenCount > 0 ? <span className="tag tag-more">+{hiddenCount}</span> : null}
      </div>
      {maxVisibleCount === undefined ? (
        <div className="tag-row tag-row-measure" ref={measureRef} aria-hidden="true">
          {displayTags.map((tag, index) => {
            const displayTag = tag.trim().replace(/^#+/, "");

            return (
              <span className="tag" data-tag-measure="" key={`${displayTag}-${index}`}>
                {displayTag}
              </span>
            );
          })}
          {displayTags.map((_, index) => {
            const count = displayTags.length - index;

            return (
              <span
                className="tag tag-more"
                data-more-count={count}
                key={`more-${count}`}
              >
                +{count}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

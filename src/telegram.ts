import {
  createArticleBrowseHref,
  getContentItemPreviewImage
} from "./admin-display";
import { ADMIN_RESOURCE_FIELD_EXAMPLES } from "./admin-field-examples";
import { getArticleDisplayTitle } from "./article-helpers";
import { createToolPreviewSource } from "./tool-helpers";
import type {
  ArticleSummary,
  ContentItemSummary,
  TelegramPushResource,
  Tool
} from "./types";
import type { Locale } from "./i18n";
import { getEffectiveTags } from "../shared/effective-tags";

export type { TelegramPushResource } from "./types";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const TELEGRAM_PHOTO_CAPTION_LIMIT = 1024;
const TELEGRAM_SECTION_SEPARATOR = "\n\n";

type TelegramBodyFieldPatch = {
  title?: string;
  description?: string;
  url?: string;
  demoUrl?: string;
  tags?: string[];
  resourceType?: TelegramPushResource["type"];
};

export type TelegramBodyFields = {
  title: string;
  description: string;
  url: string;
  demoUrl: string;
  tags: string[];
};

function readTelegramBodyTitle(markdown: string) {
  const firstLine = markdown.split("\n").find((line) => line.trim()) ?? "";
  return firstLine
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*([\s\S]*)\*\*$/, "$1")
    .trim();
}

export function createTelegramCustomBodyExample(locale: "zh" | "en") {
  const examples = ADMIN_RESOURCE_FIELD_EXAMPLES[locale];
  const labels = locale === "zh"
    ? { title: "在这里写推送标题", project: "项目地址", demo: "演示地址" }
    : { title: "Write the push title here", project: "Project", demo: "Demo" };
  const tags = examples.tags
    .split(/\s*[,，、;；]\s*/)
    .map(toTelegramHashtag)
    .filter(Boolean)
    .join(" ");

  return [
    `**${labels.title}**`,
    "",
    `> ${examples.description.replace(/^例如[:：]\s*|^Example:\s*/i, "")}`,
    "",
    `${labels.project}：[${examples.url}](${examples.url})`,
    "",
    `${labels.demo}：[${examples.demoUrl}](${examples.demoUrl})`,
    "",
    tags
  ].join("\n");
}

export function syncTelegramBodyField(
  markdown: string,
  patch: TelegramBodyFieldPatch,
  footerMarkdown: string,
  locale: "zh" | "en"
) {
  const footer = footerMarkdown.trim();
  let body = markdown.trim();
  if (footer && body.endsWith(footer)) {
    body = body.slice(0, body.length - footer.length).trim();
  }

  let lines = body ? body.split("\n") : [];
  if (Object.prototype.hasOwnProperty.call(patch, "title")) {
    lines = replaceTelegramTitleLines(lines, patch.title ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "description")) {
    lines = replaceTelegramDescriptionLines(lines, patch.description ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "url")) {
    const label = locale === "zh"
      ? patch.resourceType === "article" ? "文章地址" : "项目地址"
      : patch.resourceType === "article"
        ? "Article"
        : "Project";
    lines = replaceTelegramLabeledLine(
      lines,
      /^(项目地址|文章地址|本站浏览|Project|Article|Site View|Repository)[：:]/i,
      createTelegramUrlLine(
        label,
        patch.resourceType === "content" ? "" : patch.url ?? ""
      ),
      /^(演示地址|原文地址|Demo|Original)[：:]/i
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "demoUrl")) {
    const label = locale === "zh"
      ? patch.resourceType === "content" ? "原文地址" : "演示地址"
      : patch.resourceType === "content" ? "Original" : "Demo";
    lines = replaceTelegramLabeledLine(
      lines,
      /^(演示地址|原文地址|Demo|Original)[：:]/i,
      createTelegramUrlLine(label, patch.demoUrl ?? ""),
      /^#[^\s#]+(?:\s+#[^\s#]+)*$/
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "tags")) {
    const hashtags = (patch.tags ?? [])
      .map(toTelegramHashtag)
      .filter(Boolean)
      .join(" ");
    lines = replaceTelegramLabeledLine(
      lines,
      /^#[^\s#]+(?:\s+#[^\s#]+)*$/,
      hashtags
    );
  }

  body = normalizeTelegramBodyLines(lines);
  return [body, footer].filter(Boolean).join(TELEGRAM_SECTION_SEPARATOR);
}

export function readTelegramBodyFields(
  markdown: string,
  footerMarkdown: string,
  locale: "zh" | "en",
  ignoreExamples = false
): TelegramBodyFields {
  const footer = footerMarkdown.trim();
  let body = markdown.trim();
  if (footer && body.endsWith(footer)) {
    body = body.slice(0, body.length - footer.length).trim();
  }

  const lines = body.split("\n");
  const titleLine = lines.find((line) => line.trim())?.trim() ?? "";
  const title = /^\*\*[^*]+\*\*$/.test(titleLine) || /^#{1,6}\s+/.test(titleLine)
    ? readTelegramBodyTitle(titleLine)
    : "";
  const descriptionLines: string[] = [];
  let readingDescription = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>/.test(trimmed)) {
      readingDescription = true;
      descriptionLines.push(trimmed.replace(/^>\s?/, ""));
    } else if (readingDescription) {
      break;
    }
  }

  const url = readTelegramLabeledUrl(
    lines,
    /^(项目地址|文章地址|本站浏览|Project|Article|Site View|Repository)[：:]/i
  );
  const demoUrl = readTelegramLabeledUrl(
    lines,
    /^(演示地址|原文地址|Demo|Original)[：:]/i
  );
  const hashtagLine = lines.find((line) =>
    /^#[^\s#]+(?:\s+#[^\s#]+)*$/.test(line.trim())
  )?.trim() ?? "";
  const tags = hashtagLine
    ? hashtagLine.split(/\s+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean)
    : [];
  const fields = {
    title,
    description: descriptionLines.join("\n").trim(),
    url,
    demoUrl,
    tags
  };

  if (!ignoreExamples) return fields;

  const examples = ADMIN_RESOURCE_FIELD_EXAMPLES[locale];
  const exampleTitle = locale === "zh"
    ? "在这里写推送标题"
    : "Write the push title here";
  const exampleDescription = examples.description.replace(
    /^例如[:：]\s*|^Example:\s*/i,
    ""
  );
  const exampleTags = examples.tags
    .split(/\s*[,，、;；]\s*/)
    .filter(Boolean);

  return {
    title: fields.title === exampleTitle ? "" : fields.title,
    description: fields.description === exampleDescription ? "" : fields.description,
    url: fields.url === examples.url ? "" : fields.url,
    demoUrl: fields.demoUrl === examples.demoUrl ? "" : fields.demoUrl,
    tags: fields.tags.length === exampleTags.length &&
      fields.tags.every((tag, index) => tag === exampleTags[index])
      ? []
      : fields.tags
  };
}

function replaceTelegramTitleLines(lines: string[], title: string) {
  const next = [...lines];
  const index = next.findIndex((line) => line.trim());
  if (!title.trim()) {
    if (index >= 0 && (/^\*\*[^*]+\*\*$/.test(next[index].trim()) || /^#{1,6}\s+/.test(next[index].trim()))) {
      next.splice(index, 1);
    }
    return next;
  }
  const heading = `**${title.trim()}**`;
  if (index === -1) return heading ? [heading] : [];
  next[index] = heading;
  return next;
}

function replaceTelegramDescriptionLines(lines: string[], description: string) {
  const next = [...lines];
  const titleIndex = next.findIndex((line) => line.trim());
  let start = titleIndex + 1;
  while (start < next.length && !next[start].trim()) start += 1;
  let end = start;
  while (end < next.length && /^>/.test(next[end].trim())) end += 1;
  const quoteLines = description.trim() ? toTelegramQuoteBlock(description).split("\n") : [];

  if (start < next.length && /^>/.test(next[start].trim())) {
    next.splice(start, end - start, ...quoteLines);
  } else if (quoteLines.length) {
    next.splice(start, 0, ...quoteLines, "");
  }
  return next;
}

function replaceTelegramLabeledLine(
  lines: string[],
  matcher: RegExp,
  replacement: string,
  beforeMatcher?: RegExp
) {
  const next = [...lines];
  const index = next.findIndex((line) => matcher.test(line.trim()));
  if (index >= 0) {
    if (replacement) next[index] = replacement;
    else next.splice(index, 1);
    return next;
  }
  if (!replacement) return next;

  const beforeIndex = beforeMatcher
    ? next.findIndex((line) => beforeMatcher.test(line.trim()))
    : -1;
  const insertIndex = beforeIndex >= 0 ? beforeIndex : next.length;
  next.splice(insertIndex, 0, replacement, "");
  return next;
}

function createTelegramUrlLine(label: string, url: string) {
  const normalized = url.trim();
  return normalized ? `${label}：[${normalized}](${normalized})` : "";
}

function readTelegramLabeledUrl(lines: string[], matcher: RegExp) {
  const line = lines.find((candidate) => matcher.test(candidate.trim()))?.trim() ?? "";
  const markdownLink = line.match(/\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownLink?.[1]) return markdownLink[1];
  return line.match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;，。；]+$/, "") ?? "";
}

function normalizeTelegramBodyLines(lines: string[]) {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTelegramFooterMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(
      /(^|[\s｜|])([^\[\]\n()｜|]+?)\s*\((https?:\/\/[^)\s]+)\)/g,
      (_, prefix: string, label: string, url: string) =>
        `${prefix}[${label.trim()}](${url})`
    )
    .replace(/\s*｜\s*/g, " ｜ ")
    .trim();
}

export function createTelegramToolResource(tool: Tool): TelegramPushResource {
  return {
    type: "tool",
    id: tool.id,
    title: tool.name,
    description: tool.description,
    url: tool.url,
    demoUrl: tool.demoUrl,
    image: createToolPreviewSource(tool),
    category: "",
    tags: getEffectiveTags(tool.tags, tool.category)
  };
}

export function createTelegramArticleResource(
  article: ArticleSummary,
  origin: string
): TelegramPushResource {
  return {
    type: "article",
    id: article.id,
    title: article.title,
    description: article.summary,
    url: article.published
      ? resolveTelegramResourceUrl(createArticleBrowseHref(article.slug, true), origin)
      : "",
    demoUrl: "",
    image: resolveTelegramResourceUrl(article.coverImage, origin),
    category: "",
    tags: getEffectiveTags(article.tags, article.category)
  };
}

export function createTelegramContentResource(
  item: ContentItemSummary,
  origin: string
): TelegramPushResource {
  return {
    type: "content",
    id: item.id,
    title: getArticleDisplayTitle(item),
    description: item.summary,
    url: "",
    demoUrl: resolveTelegramResourceUrl(item.url, origin),
    image: resolveTelegramResourceUrl(getContentItemPreviewImage(item), origin),
    category: "",
    tags: getEffectiveTags(item.tags, item.category)
  };
}

export function createDefaultTelegramBody(resource: TelegramPushResource) {
  const description = escapeTelegramText(resource.description);
  const title = escapeTelegramText(resource.title);
  return description
    ? `**${title}**${TELEGRAM_SECTION_SEPARATOR}${toTelegramQuoteBlock(description)}`
    : `**${title}**`;
}

function toTelegramQuoteBlock(value: string) {
  return value
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trim()}` : ">"))
    .join("\n");
}

export function buildTelegramPreviewMarkdown(
  resource: TelegramPushResource,
  bodyMarkdown: string,
  footerMarkdown: string,
  locale: "zh" | "en"
) {
  const labels = locale === "zh"
    ? {
        article: "文章地址",
        project: "项目地址",
        demo: "演示地址",
        original: "原文地址"
      }
    : {
        article: "Article",
        project: "Project",
        demo: "Demo",
        original: "Original"
      };
  const editableBody = bodyMarkdown.trim();
  const tags = resource.type === "custom"
    ? ""
    : resource.tags.map(toTelegramHashtag).filter(Boolean).join(" ");
  const linkLabel = resource.type === "article" ? labels.article : labels.project;
  const demoLabel = resource.type === "content" ? labels.original : labels.demo;
  const resourceUrl = resource.type === "content" ? "" : resource.url;

  return [
    editableBody,
    resourceUrl ? `${linkLabel}：[${resourceUrl}](${resourceUrl})` : "",
    resource.demoUrl ? `${demoLabel}：[${resource.demoUrl}](${resource.demoUrl})` : "",
    tags,
    footerMarkdown.trim()
  ].filter(Boolean).join(TELEGRAM_SECTION_SEPARATOR);
}

export function createTelegramResourceMediaUrl(resource: TelegramPushResource) {
  if (resource.type === "article" || resource.type === "content") return resource.image;
  if (resource.image) return resource.image;
  return resource.url
    ? `https://image.thum.io/get/width/1200/crop/720/${resource.url}`
    : "";
}

export function countTelegramMessageCharacters(value: string) {
  return Array.from(value).length;
}

export function escapeTelegramPreviewHashtags(value: string) {
  return value.replace(
    /(^|\n)([ \t]*)(#[^\s#]+(?:[ \t]+#[^\s#]+)*)(?=\n|$)/g,
    (_match, lineStart: string, indentation: string, hashtags: string) =>
      `${lineStart}${indentation}\\${hashtags}`
  );
}

export function getTelegramText(locale: Locale) {
  return locale === "zh"
    ? {
      action: "消息推送",
      title: "Telegram 推送",
      management: {
        nav: "消息推送",
        title: "消息推送",
        addPush: "添加推送",
        searchPlaceholder: "搜索推送",
        typeTool: "工具库",
        typeArticle: "文章管理",
        typeContent: "订阅内容",
        statusPushed: "已推送",
        statusUncertain: "送达待确认",
        pushedNotice: "此消息已推送，无法恢复为草稿；如需修改，请使用“编辑推送”。",
        pushAction: "推送到 Telegram",
        pushConfirmTitle: "推送到 Telegram？",
        pushConfirmDescription: "发出后仍可以继续编辑内容并更新到同一条消息，但无法退回草稿状态。",
        resourceDeleted: "来源已删除",
        emptyTitle: "还没有推送",
        emptyDescription: "自己写一条消息推送到 Telegram，或者从工具库、文章管理、订阅内容卡片推送",
        noMatchTitle: "没有匹配的推送",
        noMatchDescription: "换个类型或搜索词再试。",
        loadMore: "加载更多",
        viewAction: "浏览推送",
        editAction: "编辑推送",
        editActionShort: "编辑",
        deleteAction: "删除推送",
        deleteActionShort: "删除",
        deleteTitle: "删除这条推送记录吗？",
        deleteDescription: "只移除本站的推送记录，Telegram 上已经发送的消息不会被删除，需要撤回请到 Telegram 中操作。",
        deleted: "推送记录已删除。",
        serviceDisabled: "Telegram 推送当前已关闭，开启后才能编辑消息。",
        serviceDisabledTitle: "Telegram 推送未开启",
        serviceDisabledDescription: "在系统设置里配置并开启 Telegram 推送后，就能在这里撰写消息，也能从工具库、文章管理、订阅内容卡片推送。",
        serviceDisabledAction: "去系统设置"
      },
        quickPush: {
          description: "选择直接推送到 Telegram，或者先存为草稿，稍后在「消息推送」里编辑内容再发。",
          alreadyPushed: "这条内容已经推送过了，去「消息推送」里编辑或更新消息。",
          deliveryUncertain: "上次推送是否送达仍待确认，请到「消息推送」里保存内容或处理重试。",
          modeLabel: "推送方式",
          sendLabel: "直接推送",
          draftLabel: "存为草稿",
          sendAction: "消息推送",
          draftAction: "保存草稿",
          goManage: "消息推送"
        },
        description: "编辑当前内容的 Telegram 推送信息，固定消息尾巴由系统自动附加。",
        customDescription: "自己写一条推送发到 Telegram，不绑定工具、文章或订阅内容；固定消息尾巴由系统自动附加。",
        customTitleLabel: "推送标题",
        categoryLabel: "推送分类",
        defaultCategoryLabel: (source: string) => `${source}（默认）`,
        syncSource: "同步来源",
        syncSourceHint: "同步关联工具、文章或订阅内容的最新信息，当前编辑内容将被覆盖。",
        syncSourceConfirmTitle: "同步来源？",
        syncSourceConfirmDescription: "将用关联内容的最新信息覆盖当前推送标题、简介、链接、标签、正文和图片地址。",
        contentOriginalUrlLabel: "原文地址",
        contentOriginalUrlPlaceholder: "https://example.com/article",
        articleUrlPlaceholder: "https://example.com/articles/article-name",
        bodyPlaceholder: "在这里编写 Telegram Markdown 正文",
        targetChanged: "Telegram 发送目标已经改变，点击更新推送可确认是否推送到新目标。",
        resendDeletedTitle: "原消息已不存在",
        resendDeletedDescription:
          "原 Telegram 消息已不存在，这条推送已回到未推送状态。是否立即推送一条新消息？",
        resendTargetChangedTitle: "发送目标已改变",
        resendTargetChangedDescription:
          "发送目标已改变，原消息保留在旧会话，这条推送已回到未推送状态。是否向新目标推送一条新消息？",
        resendAction: "重新推送",
        resendSkipped: "当前内容未推送到当前目标。",
        bodyLabel: "Markdown 正文",
        previewTitle: "消息预览",
        mediaEnabled: "已开启",
        mediaDisabled: "已关闭",
        mediaUrlLabel: "预览图",
        mediaUrlPlaceholder: "https://example.com/preview.png",
        mediaHelp: "开启后使用当前内容的预览图，可替换为其他公开图片地址。",
        mediaInvalid: "发送图片时请填写有效的图片地址",
        save: "保存内容",
        send: "消息推送",
        update: "更新推送",
        saved: "Telegram 推送内容已保存。",
        draftSavedUncertain: "草稿已保存，上次推送是否送达仍待确认。",
        savedUncertain: "内容已保存，上次推送是否送达仍待确认。",
        deliveryUncertain: "上次推送是否送达仍待确认。可以先保存内容；再次推送前，请先检查 Telegram 目标会话。",
        sent: "已推送到 Telegram。",
        updated: "Telegram 推送已更新。",
        pushPending: "正在推送，请稍候。",
        uncertainRetryTitle: "确认重新推送？",
        uncertainRetryDescription: "暂时无法确认是否送达，请先检查 Telegram 目标会话。确认未收到后再重试，继续可能产生重复消息。",
        uncertainRetryPending: "正在重新推送，请稍候。",
        uncertainRetryFailed: "本次重试仍无法确认是否送达，请先检查 Telegram 目标会话。确认未收到后再重试，继续可能产生重复消息。",
        uncertainRetryCancel: "暂不重试",
        uncertainRetryAction: "确认重试",
        loading: "正在加载消息预览。",
        tooLong: "完整消息超过 Telegram 的 4096 字符限制。",
        photoCaptionTooLong: "图片消息文字超过 Telegram 的 1024 字符限制。"
      }
    : {
        action: "Message Push",
        title: "Telegram Push",
        management: {
          nav: "Message Push",
          title: "Message Push",
          addPush: "Add Push",
          searchPlaceholder: "Search pushes",
          typeTool: "Tool Library",
          typeArticle: "Articles",
          typeContent: "Subscription Content",
          statusPushed: "Pushed",
          statusUncertain: "Delivery unconfirmed",
          pushedNotice: "This message has already been pushed and cannot return to draft. Use Edit Push to make changes.",
          pushAction: "Push to Telegram",
          pushConfirmTitle: "Push to Telegram?",
          pushConfirmDescription: "After sending you can still edit the content and update the same message, but it cannot go back to draft.",
          resourceDeleted: "Source deleted",
          emptyTitle: "No pushes yet",
          emptyDescription: "Write a message and push it to Telegram, or push from a Tool Library, Articles, or Subscription Content card.",
          noMatchTitle: "No matching pushes",
          noMatchDescription: "Try another type or search term.",
          loadMore: "Load More",
          viewAction: "View Push",
          editAction: "Edit Push",
          editActionShort: "Edit",
          deleteAction: "Delete Push",
          deleteActionShort: "Delete",
          deleteTitle: "Delete this push record?",
          deleteDescription: "This only removes the local push record. The message already sent to Telegram is kept — delete it in Telegram if you need to withdraw it.",
          deleted: "Push record deleted.",
          serviceDisabled: "Telegram pushing is disabled. Enable it before editing messages.",
          serviceDisabledTitle: "Telegram pushing is off",
          serviceDisabledDescription: "Configure and enable Telegram pushing in System Settings to write messages here and push from Tool Library, Articles, or Subscription Content cards.",
          serviceDisabledAction: "Open System Settings"
        },
        quickPush: {
          description: "Push to Telegram now, or save a draft and edit it later in Message Push.",
          alreadyPushed: "This item has already been pushed. Edit or update it in Message Push.",
          deliveryUncertain: "The previous delivery is still unconfirmed. Open Message Push to save changes or handle the retry.",
          modeLabel: "Push mode",
          sendLabel: "Push now",
          draftLabel: "Save draft",
          sendAction: "Push Message",
          draftAction: "Save Draft",
          goManage: "Message Push"
        },
        description: "Edit the current Telegram message; the fixed message footer is appended automatically.",
        customDescription: "Write a standalone Telegram push that is not tied to a tool, article, or content item. The fixed message footer is appended automatically.",
        customTitleLabel: "Push title",
        categoryLabel: "Push category",
        defaultCategoryLabel: (source: string) => `${source} (default)`,
        syncSource: "Sync Source",
        syncSourceHint: "Sync the latest information from the linked tool, article, or content item. Your current edits will be overwritten.",
        syncSourceConfirmTitle: "Sync source?",
        syncSourceConfirmDescription: "Replace the current push title, description, links, tags, body, and image URL with the latest linked content.",
        contentOriginalUrlLabel: "Original URL",
        contentOriginalUrlPlaceholder: "https://example.com/article",
        articleUrlPlaceholder: "https://example.com/articles/article-name",
        bodyPlaceholder: "Write the Telegram Markdown content here",
        targetChanged: "The Telegram target has changed. Use Update Push to confirm sending to the new target.",
        resendDeletedTitle: "Original message is gone",
        resendDeletedDescription:
          "The original Telegram message no longer exists, so this push is back to not pushed. Push a new message now?",
        resendTargetChangedTitle: "Delivery target changed",
        resendTargetChangedDescription:
          "The delivery target changed and the original message stays in the previous chat, so this push is back to not pushed. Push a new message to the new target?",
        resendAction: "Push again",
        resendSkipped: "The current content is not pushed to the current target.",
        bodyLabel: "Markdown content",
        previewTitle: "Message preview",
        mediaEnabled: "Enabled",
        mediaDisabled: "Disabled",
        mediaUrlLabel: "Preview image",
        mediaUrlPlaceholder: "https://example.com/preview.png",
        mediaHelp: "When enabled, uses the current item's preview image; replace it with another public image URL if needed.",
        mediaInvalid: "Enter a valid image URL when image sending is enabled.",
        save: "Save Content",
        send: "Push Message",
        update: "Update Push",
        saved: "Telegram push content saved.",
        draftSavedUncertain: "Draft saved. The previous delivery is still unconfirmed.",
        savedUncertain: "Content saved. The previous delivery is still unconfirmed.",
        deliveryUncertain: "The previous delivery is still unconfirmed. You can save your changes; check the target Telegram chat before retrying.",
        sent: "Pushed to the Telegram chat.",
        updated: "Telegram push updated.",
        pushPending: "Sending the message. Please wait.",
        uncertainRetryTitle: "Retry this push?",
        uncertainRetryDescription: "Delivery could not be confirmed. Check the target Telegram chat and retry only if the message was not received. Continuing may create a duplicate.",
        uncertainRetryPending: "Retrying the push. Please wait.",
        uncertainRetryFailed: "Delivery still could not be confirmed after this retry. Check the target Telegram chat and retry only if the message was not received. Continuing may create a duplicate.",
        uncertainRetryCancel: "Not Now",
        uncertainRetryAction: "Confirm Retry",
        loading: "Loading message preview.",
        tooLong: "The complete message exceeds Telegram's 4096-character limit.",
        photoCaptionTooLong: "The photo caption exceeds Telegram's 1024-character limit."
      };
}

function toTelegramHashtag(value: string) {
  const normalized = value.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]+/gu, "_");
  return normalized ? `#${normalized.replace(/^_+|_+$/g, "")}` : "";
}

function resolveTelegramResourceUrl(value: string, origin: string) {
  if (!value.trim()) return "";
  try {
    return new URL(value, origin).toString();
  } catch {
    return "";
  }
}

function escapeTelegramText(value: string) {
  return value.trim().replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
}

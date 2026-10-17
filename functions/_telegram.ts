import {
  InvalidRequestError,
  UpstreamServiceError,
  createSearchTerms,
  getDatabase,
  jsonError,
  type ArticleRow,
  type ContentItemRow,
  type Env,
  type ToolRow
} from "./_shared";
import { getEffectiveTags } from "../shared/effective-tags";

const TELEGRAM_SETTINGS_KEY = "telegram_settings";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_MAX_PHOTO_CAPTION_LENGTH = 1024;
const TELEGRAM_MAX_FOOTER_LENGTH = 1000;
const TELEGRAM_MAX_BODY_LENGTH = 4096;
const TELEGRAM_SECTION_SEPARATOR = "\n\n";
const TELEGRAM_MESSAGE_TOO_LONG_ERROR =
  `Telegram message exceeds the ${TELEGRAM_MAX_MESSAGE_LENGTH} character limit.`;
const TELEGRAM_PHOTO_CAPTION_TOO_LONG_ERROR =
  `Telegram photo caption exceeds the ${TELEGRAM_MAX_PHOTO_CAPTION_LENGTH} character limit.`;
const TELEGRAM_NOT_CONFIGURED_ERROR = "Telegram configuration is incomplete.";
const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;
const TELEGRAM_TEST_TIMEOUT_ERROR = "Telegram connection test timed out.";
const TELEGRAM_RETRY_DELAY_MS = 200;
const TELEGRAM_SAFE_RETRY_METHODS = new Set([
  "getMe",
  "getChat",
  "getChatMember",
  "editMessageText",
  "editMessageMedia",
  "deleteMessage"
]);
const TELEGRAM_PUSH_LOCK_TTL_MS = 30_000;
const TELEGRAM_REPLACEMENT_LOCK_TTL_MS = 60_000;
const TELEGRAM_PUSH_UNCERTAIN_TTL_MS = 60_000;
const TELEGRAM_PUSH_IN_PROGRESS_ERROR = "Telegram message operation is already in progress.";
const TELEGRAM_PUSH_UNCERTAIN_ERROR = "Telegram push result is uncertain.";

class TelegramRequestError extends UpstreamServiceError {
  constructor(message: string, readonly outcome: "known" | "uncertain") {
    super(message);
    this.name = "TelegramRequestError";
  }
}

export type TelegramSettings = {
  available: boolean;
  enabled: boolean;
  target: string;
  footerMarkdown: string;
};

export type TelegramConnection = {
  botName: string;
  botUsername: string;
  chatId: string;
  chatTitle: string;
  chatType: string;
  canSend: boolean;
};

export type TelegramResourceType = "tool" | "article" | "content" | "custom";
type TelegramPushOperation = "save" | "send" | "update" | "delete";

type TelegramPushLockRow = {
  operation: TelegramPushOperation;
  state: "active" | "uncertain";
  expires_at: string;
};

type TelegramPushLockContext = {
  markExternalRequestCompleted: () => void;
  markExternalRequestStarted: (replacement?: boolean) => Promise<void>;
};

export type TelegramMessageRow = {
  id: string;
  resource_type: TelegramResourceType;
  resource_id: string;
  custom_title: string;
  resource_data: string;
  category: string;
  chat_id: string;
  target_ref: string;
  message_id: string;
  message_markdown: string;
  media_enabled: number;
  media_url: string;
  last_pushed_hash: string;
  last_pushed_media_enabled: number | null;
  sent_at: string;
  updated_at: string;
};

export type TelegramMessageSyncStatus =
  | "not_pushed"
  | "pending"
  | "synced";

export type TelegramMessageState = {
  exists: boolean;
  deliveryUncertain: boolean;
  targetChanged: boolean;
  syncStatus: TelegramMessageSyncStatus;
  bodyMarkdown: string;
  mediaEnabled: boolean;
  mediaUrl: string;
  defaultBodyMarkdown: string;
  defaultMediaUrl: string;
  resource: TelegramResource;
  resourceExists: boolean;
  /**
   * Set when the stored push could not be edited in place: the admin deleted the
   * message inside Telegram, or the delivery target changed. The record is reset to
   * "not pushed" so the admin can decide whether to send a fresh message.
   */
  remoteMessageMissing?: "deleted" | "target-changed";
};

type TelegramMessagePayload = {
  bodyMarkdown?: unknown;
  mediaEnabled?: unknown;
  mediaUrl?: unknown;
  locale?: unknown;
  title?: unknown;
  resource?: unknown;
  category?: unknown;
  confirmUncertainRetry?: unknown;
};

export type TelegramSourceState = {
  resource: TelegramResource;
  bodyMarkdown: string;
  mediaUrl: string;
};

export type TelegramResource = {
  type: TelegramResourceType;
  id: string;
  title: string;
  description: string;
  url: string;
  demoUrl: string;
  image: string;
  category: string;
  tags: string[];
};

export type TelegramPushListRecord = {
  id: string;
  deliveryUncertain: boolean;
  resourceType: TelegramResourceType;
  resourceId: string;
  title: string;
  resourceExists: boolean;
  resource: TelegramResource | null;
  messageMarkdown: string;
  mediaEnabled: boolean;
  mediaUrl: string;
  syncStatus: "not_pushed" | "pending" | "synced";
  sentAt: string;
  updatedAt: string;
};

type TelegramPushListRow = TelegramMessageRow & {
  delivery_uncertain: number;
  resource_exists: number;
  sort_key: string;
};

export type TelegramPushCategoryOptions = string[];

export type TelegramPushSortMode = "latest" | "oldest";

type TelegramPushCursor = {
  sort: TelegramPushSortMode;
  sortKey: string;
  id: string;
};

type TelegramApiResponse<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  type?: string;
  permissions?: { can_send_messages?: boolean };
};

type TelegramChatMember = {
  status?: string;
  can_post_messages?: boolean;
  can_send_messages?: boolean;
};

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
};

type TelegramTextPayload = {
  text: string;
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
};

type TelegramPhotoPayload = {
  photo: string;
  caption: string;
  parse_mode: "HTML";
};

type TelegramEditPhotoPayload = {
  chat_id: string;
  message_id: number;
  media: {
    type: "photo";
    media: string;
    caption: string;
    parse_mode: "HTML";
  };
};

export async function getTelegramSettings(env: Env): Promise<TelegramSettings> {
  const db = await getDatabase(env);
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(TELEGRAM_SETTINGS_KEY)
    .first<{ value: string }>();

  if (!row?.value) {
    const target = getTelegramEnvironmentTarget(env);
    return {
      available: hasTelegramConfiguration(env, target),
      enabled: false,
      target,
      footerMarkdown: ""
    };
  }

  try {
    const parsed = JSON.parse(row.value) as {
      enabled?: unknown;
      target?: unknown;
      footerMarkdown?: unknown;
    };
    const target = Object.prototype.hasOwnProperty.call(parsed, "target")
      ? normalizeTelegramTarget(parsed.target)
      : getTelegramEnvironmentTarget(env);
    const available = hasTelegramConfiguration(env, target);
    return {
      available,
      enabled: available && parsed.enabled === true,
      target,
      footerMarkdown: normalizeFooterMarkdown(parsed.footerMarkdown)
    };
  } catch {
    const target = getTelegramEnvironmentTarget(env);
    return {
      available: hasTelegramConfiguration(env, target),
      enabled: false,
      target,
      footerMarkdown: ""
    };
  }
}

export function writeTelegramErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (message === TELEGRAM_TEST_TIMEOUT_ERROR) {
    return jsonError(message, "TELEGRAM_TEST_TIMEOUT", { status: 504 });
  }
  if (message === TELEGRAM_PUSH_IN_PROGRESS_ERROR) {
    return jsonError(message, "TELEGRAM_PUSH_IN_PROGRESS", { status: 409 });
  }
  if (message === TELEGRAM_PUSH_UNCERTAIN_ERROR) {
    return jsonError(message, "TELEGRAM_PUSH_UNCERTAIN", { status: 409 });
  }
  if (isTelegramMessageMissingError(message)) {
    return jsonError(message, "TELEGRAM_MESSAGE_NOT_FOUND", { status: 404 });
  }
  if (isTelegramTargetUnavailableError(message)) {
    return jsonError(message, "TELEGRAM_TARGET_UNAVAILABLE", { status: 400 });
  }
  if (isTelegramPermissionError(message)) {
    return jsonError(message, "TELEGRAM_PERMISSION_DENIED", { status: 403 });
  }
  if (message === TELEGRAM_NOT_CONFIGURED_ERROR) {
    return jsonError(message, "TELEGRAM_NOT_CONFIGURED", { status: 400 });
  }
  if (message === "Telegram pushing is disabled.") {
    return jsonError(message, "TELEGRAM_DISABLED", { status: 400 });
  }
  if (
    message === "Telegram message record was not found." ||
    message === "Telegram message no longer exists."
  ) {
    return jsonError(message, "TELEGRAM_MESSAGE_NOT_FOUND", { status: 404 });
  }
  if (message === "This content has already been pushed to Telegram.") {
    return jsonError(message, "TELEGRAM_MESSAGE_EXISTS", { status: 409 });
  }
  if (message === "Telegram target has changed.") {
    return jsonError(message, "TELEGRAM_TARGET_CHANGED", { status: 409 });
  }
  if (message === "Tool not found." || message === "Article not found.") {
    return jsonError(message, "NOT_FOUND", { status: 404 });
  }
  if (
    message === TELEGRAM_MESSAGE_TOO_LONG_ERROR ||
    message === TELEGRAM_PHOTO_CAPTION_TOO_LONG_ERROR ||
    message.includes("message body is too long") ||
    message.includes("message footer is too long")
  ) {
    return jsonError(message, "TELEGRAM_MESSAGE_TOO_LONG", { status: 400 });
  }
  if (error instanceof UpstreamServiceError || message.startsWith("Telegram API:")) {
    return jsonError(message, "TELEGRAM_UNAVAILABLE", { status: 502 });
  }
  if (error instanceof InvalidRequestError) {
    return jsonError(message, "INVALID_REQUEST", { status: 400 });
  }
  return jsonError(fallback, "SERVER_ERROR", { status: 500 });
}

function isTelegramMessageMissingError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized === "telegram message no longer exists." ||
    normalized.includes("message to edit not found") ||
    normalized.includes("message to delete not found") ||
    normalized.includes("message_id_invalid")
  );
}

function isTelegramTargetUnavailableError(message: string) {
  const normalized = message.toLowerCase();
  return [
    "chat not found",
    "chat_id_invalid",
    "bot is not a member",
    "bot was kicked",
    "bot was blocked"
  ].some((fragment) => normalized.includes(fragment));
}

function isTelegramPermissionError(message: string) {
  const normalized = message.toLowerCase();
  return [
    "cannot post",
    "cannot send",
    "not enough rights",
    "can't be edited",
    "cannot be edited",
    "forbidden"
  ].some((fragment) => normalized.includes(fragment));
}

export async function saveTelegramSettings(
  env: Env,
  payload: { enabled?: unknown; target?: unknown; footerMarkdown?: unknown }
) {
  const db = await getDatabase(env);
  const enabled = payload.enabled === true;
  const target = normalizeTelegramTarget(payload.target);
  const footerMarkdown = normalizeFooterMarkdown(payload.footerMarkdown);

  if (enabled && !hasTelegramConfiguration(env, target)) {
    throw new InvalidRequestError(TELEGRAM_NOT_CONFIGURED_ERROR);
  }

  const settings = { enabled, target, footerMarkdown };
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  )
    .bind(TELEGRAM_SETTINGS_KEY, JSON.stringify(settings))
    .run();

  return getTelegramSettings(env);
}

export async function testTelegramConnection(env: Env, requestedTarget?: unknown) {
  const settings = await getTelegramSettings(env);
  const target = requestedTarget === undefined
    ? settings.target
    : normalizeTelegramTarget(requestedTarget);
  if (!getTelegramToken(env) || !target) {
    throw new InvalidRequestError(TELEGRAM_NOT_CONFIGURED_ERROR);
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TELEGRAM_REQUEST_TIMEOUT_MS);

  try {
    return await resolveTelegramConnection(env, target, controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new UpstreamServiceError(TELEGRAM_TEST_TIMEOUT_ERROR);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isTelegramRequestOutcomeUncertain(error: unknown) {
  return error instanceof TelegramRequestError && error.outcome === "uncertain";
}

async function acquireTelegramPushLock(
  db: D1Database,
  resourceType: TelegramResourceType,
  resourceId: string,
  operation: TelegramPushOperation,
  takeOverUncertain: boolean
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + TELEGRAM_PUSH_LOCK_TTL_MS).toISOString();
  const token = crypto.randomUUID();
  const result = await db.prepare(
    `INSERT INTO telegram_push_locks
       (resource_type, resource_id, operation, lock_token, state, expires_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(resource_type, resource_id) DO UPDATE SET
       operation = excluded.operation,
       lock_token = excluded.lock_token,
       state = 'active',
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at
      WHERE (telegram_push_locks.expires_at <= ? AND telegram_push_locks.operation <> 'send')
          OR ((? = 1 OR excluded.operation = 'delete')
              AND (telegram_push_locks.state = 'uncertain' OR telegram_push_locks.expires_at <= ?))
          OR (excluded.operation = 'update' AND telegram_push_locks.operation = 'update'
              AND telegram_push_locks.state = 'uncertain')`
  )
    .bind(
      resourceType,
      resourceId,
      operation,
      token,
      expiresAt,
      nowIso,
      nowIso,
      takeOverUncertain ? 1 : 0,
      nowIso
    )
    .run();

  if (Number(result.meta?.changes ?? 0) > 0) return token;

  const existing = await db.prepare(
    `SELECT operation, state, expires_at
     FROM telegram_push_locks
     WHERE resource_type = ? AND resource_id = ?`
  )
    .bind(resourceType, resourceId)
    .first<TelegramPushLockRow>();
  throw new InvalidRequestError(
    existing?.state === "uncertain" || (existing?.operation === "send" && existing.expires_at <= nowIso)
      ? TELEGRAM_PUSH_UNCERTAIN_ERROR
      : TELEGRAM_PUSH_IN_PROGRESS_ERROR
  );
}

async function markTelegramPushLockUncertain(
  db: D1Database,
  resourceType: TelegramResourceType,
  resourceId: string,
  token: string
) {
  const now = new Date();
  await db.prepare(
    `UPDATE telegram_push_locks
     SET state = 'uncertain', expires_at = ?, updated_at = ?
     WHERE resource_type = ? AND resource_id = ? AND lock_token = ?`
  )
    .bind(
      new Date(now.getTime() + TELEGRAM_PUSH_UNCERTAIN_TTL_MS).toISOString(),
      now.toISOString(),
      resourceType,
      resourceId,
      token
    )
    .run();
}

async function releaseTelegramPushLock(
  db: D1Database,
  resourceType: TelegramResourceType,
  resourceId: string,
  token: string
) {
  await db.prepare(
    `DELETE FROM telegram_push_locks
     WHERE resource_type = ? AND resource_id = ? AND lock_token = ?`
  )
    .bind(resourceType, resourceId, token)
    .run();
}

async function withTelegramPushLock<T>(
  db: D1Database,
  resourceType: TelegramResourceType,
  resourceId: string,
  operation: TelegramPushOperation,
  action: (context: TelegramPushLockContext) => Promise<T>,
  takeOverUncertain = false
) {
  const token = await acquireTelegramPushLock(
    db,
    resourceType,
    resourceId,
    operation,
    takeOverUncertain
  );
  let externalRequestStarted = false;
  let externalRequestCompleted = false;
  let preserveLock = false;

  try {
    return await action({
      markExternalRequestCompleted: () => {
        externalRequestCompleted = true;
      },
      markExternalRequestStarted: async (replacement = false) => {
        if (replacement) {
          // 替换包含发送、删除及失败补偿；先持久化发送标记，超时后不能当作原地编辑重试。
          const expiresAt = new Date(Date.now() + TELEGRAM_REPLACEMENT_LOCK_TTL_MS).toISOString();
          const result = await db.prepare(
            `UPDATE telegram_push_locks SET operation = 'send', expires_at = ?
             WHERE resource_type = ? AND resource_id = ? AND lock_token = ?`
          ).bind(expiresAt, resourceType, resourceId, token).run();
          if (Number(result.meta?.changes ?? 0) === 0) {
            throw new InvalidRequestError(TELEGRAM_PUSH_IN_PROGRESS_ERROR);
          }
        }
        externalRequestStarted = true;
      }
    });
  } catch (error) {
    if (
      externalRequestCompleted ||
      (externalRequestStarted && isTelegramRequestOutcomeUncertain(error))
    ) {
      preserveLock = true;
      try {
        await markTelegramPushLockUncertain(db, resourceType, resourceId, token);
      } catch {
        // 发送标记即使续期失败也要求过期后确认；原地编辑按原有租约安全重试。
      }
      throw new InvalidRequestError(TELEGRAM_PUSH_UNCERTAIN_ERROR);
    }
    throw error;
  } finally {
    if (!preserveLock) {
      try {
        await releaseTelegramPushLock(db, resourceType, resourceId, token);
      } catch {
        // 清理失败时，过期的发送锁仍需确认；其余操作在租约过期后可重试。
      }
    }
  }
}

export function readTelegramResourceType(value: unknown): TelegramResourceType {
  if (
    value === "tool" ||
    value === "article" ||
    value === "content" ||
    value === "custom"
  ) return value;
  throw new InvalidRequestError("Telegram resource type is invalid.");
}

export async function listTelegramPushRecords(
  env: Env,
  origin: string,
  options: {
    cursor?: string | null;
    limit?: number;
    query?: string;
    resourceType?: TelegramResourceType | null;
    category?: string | null;
    sort?: TelegramPushSortMode;
  } = {}
) {
  const db = await getDatabase(env);
  const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)));
  const query = (options.query ?? "").trim().slice(0, 100);
  const terms = query ? createSearchTerms(query) : null;
  const sort: TelegramPushSortMode = options.sort === "oldest" ? "oldest" : "latest";
  const cursor = readTelegramPushCursor(options.cursor ?? null, sort);
  const baseConditions: string[] = ["1 = 1"];
  const baseParams: Array<string | number> = [];

  if (options.resourceType) {
    baseConditions.push("m.resource_type = ?");
    baseParams.push(options.resourceType);
  }
  const category = (options.category ?? "").trim().slice(0, 48);
  if (category) {
    baseConditions.push("m.category = ?");
    baseParams.push(category);
  }
  if (terms) {
    baseConditions.push(
      `(COALESCE(NULLIF(m.custom_title, ''), CASE WHEN json_valid(m.resource_data) THEN json_extract(m.resource_data, '$.title') ELSE '' END, '') LIKE ? ESCAPE '\\' OR
        m.resource_data LIKE ? ESCAPE '\\' OR
        m.message_markdown LIKE ? ESCAPE '\\')`
    );
    baseParams.push(terms.likePattern, terms.likePattern, terms.likePattern);
  }

  const sortExpression = "m.updated_at";
  const pageConditions = [...baseConditions];
  const pageParams = [...baseParams];
  if (cursor) {
    if (sort === "oldest") {
      pageConditions.push(
        `(${sortExpression} > ? OR (${sortExpression} = ? AND m.id > ?))`
      );
    } else {
      pageConditions.push(
        `(${sortExpression} < ? OR (${sortExpression} = ? AND m.id < ?))`
      );
    }
    pageParams.push(cursor.sortKey, cursor.sortKey, cursor.id);
  }

  const orderClause = sort === "oldest"
    ? "sort_key ASC, m.id ASC"
    : "sort_key DESC, m.id DESC";
  const pageResult = await db.prepare(
    `SELECT m.*,
            CASE
              WHEN m.resource_type = 'custom' THEN 1
              WHEN m.resource_type = 'tool' THEN EXISTS(SELECT 1 FROM tools WHERE id = m.resource_id)
              WHEN m.resource_type = 'article' THEN EXISTS(SELECT 1 FROM articles WHERE id = m.resource_id)
              WHEN m.resource_type = 'content' THEN EXISTS(SELECT 1 FROM content_items WHERE id = m.resource_id)
              ELSE 0
            END AS resource_exists,
            EXISTS(SELECT 1 FROM telegram_push_locks AS lock
                    WHERE lock.resource_type = m.resource_type AND lock.resource_id = m.resource_id
                      AND lock.operation = 'send'
                      AND (lock.state = 'uncertain' OR lock.expires_at <= ?)) AS delivery_uncertain,
            ${sortExpression} AS sort_key
     FROM telegram_messages AS m
     WHERE ${pageConditions.join(" AND ")}
     ORDER BY ${orderClause}
     LIMIT ?`
  )
    .bind(new Date().toISOString(), ...pageParams, limit + 1)
    .all<TelegramPushListRow>();
  const hasMore = pageResult.results.length > limit;
  const rows = pageResult.results.slice(0, limit);
  const settings = await getTelegramSettings(env);
  const [records, categoryOptions] = await Promise.all([
    Promise.all(
      rows.map((row) => toTelegramPushListRecord(row, origin, settings.footerMarkdown))
    ),
    db.prepare(
      `SELECT DISTINCT category
       FROM telegram_messages
       WHERE TRIM(category) <> ''
       ORDER BY category ASC`
    ).all<{ category: string }>()
  ]);
  const lastRow = rows.at(-1);

  return {
    records,
    categoryOptions: categoryOptions.results.map((row) => row.category),
    limit,
    hasMore,
    nextCursor: hasMore && lastRow
      ? createTelegramPushCursor({ sort, sortKey: lastRow.sort_key ?? "", id: lastRow.id })
      : null
  };
}

export async function getTelegramMessageState(
  env: Env,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  locale: "zh" | "en" = "zh"
): Promise<TelegramMessageState> {
  const settings = await requireEnabledTelegramSettings(env);
  const db = await getDatabase(env);
  const row = await db.prepare(
    `SELECT * FROM telegram_messages
     WHERE resource_type = ? AND resource_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  )
    .bind(resourceType, resourceId)
    .first<TelegramMessageRow>();
  const deliveryUncertain = await db.prepare(
    `SELECT 1 AS found FROM telegram_push_locks
     WHERE resource_type = ? AND resource_id = ? AND operation = 'send'
       AND (state = 'uncertain' OR expires_at <= ?)`
  ).bind(resourceType, resourceId, new Date().toISOString()).first();
  const resource = await loadStoredOrCurrentTelegramResource(
    db,
    resourceType,
    resourceId,
    origin,
    row
  );
  const defaultBody = buildTelegramMessageMarkdown(
    resource,
    createDefaultTelegramBody(resource),
    settings.footerMarkdown,
    locale
  );
  const defaultMediaUrl = createDefaultTelegramMediaUrl(resource);

  return toTelegramMessageState(
    row,
    defaultBody,
    defaultMediaUrl,
    settings.target,
    resource,
    await telegramResourceExists(db, resourceType, resourceId),
    Boolean(deliveryUncertain)
  );
}

export async function getTelegramSourceState(
  env: Env,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  locale: "zh" | "en" = "zh"
): Promise<TelegramSourceState> {
  if (resourceType === "custom") {
    throw new InvalidRequestError("Custom Telegram messages have no linked source.");
  }
  const db = await getDatabase(env);
  const settings = await getTelegramSettings(env);
  const resource = await loadTelegramResource(db, resourceType, resourceId, origin);
  return {
    resource,
    bodyMarkdown: buildTelegramMessageMarkdown(
      resource,
      createDefaultTelegramBody(resource),
      settings.footerMarkdown,
      locale
    ),
    mediaUrl: createDefaultTelegramMediaUrl(resource)
  };
}

export async function saveTelegramMessage(
  env: Env,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  payload: TelegramMessagePayload,
  locale: "zh" | "en" = "zh"
) {
  await requireEnabledTelegramSettings(env);
  const db = await getDatabase(env);
  try {
    return await withTelegramPushLock(db, resourceType, resourceId, "save", () =>
      saveTelegramMessageUnlocked(env, db, resourceType, resourceId, origin, payload, locale)
    );
  } catch (error) {
    if (!(error instanceof InvalidRequestError) || error.message !== TELEGRAM_PUSH_UNCERTAIN_ERROR) throw error;
    const lock = await db.prepare(
      `SELECT lock_token FROM telegram_push_locks
       WHERE resource_type = ? AND resource_id = ?
         AND (state = 'uncertain' OR (operation = 'send' AND expires_at <= ?))`
    ).bind(resourceType, resourceId, new Date().toISOString()).first<{ lock_token: string }>();
    if (!lock) throw new InvalidRequestError(TELEGRAM_PUSH_IN_PROGRESS_ERROR);
    return saveTelegramMessageUnlocked(
      env, db, resourceType, resourceId, origin, payload, locale, lock.lock_token
    );
  }
}

async function saveTelegramMessageUnlocked(
  env: Env,
  db: D1Database,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  payload: TelegramMessagePayload,
  locale: "zh" | "en",
  uncertainLockToken?: string
) {
  const existing = await db.prepare(
    `SELECT * FROM telegram_messages
     WHERE resource_type = ? AND resource_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  )
    .bind(resourceType, resourceId)
    .first<TelegramMessageRow>();
  let resource = await loadStoredOrCurrentTelegramResource(
    db, resourceType, resourceId, origin, existing
  );
  resource = normalizeTelegramPayloadResource(payload.resource, resource);
  const customTitle = resolveTelegramCustomTitle(resource, payload);
  const messageMarkdown = normalizeBodyMarkdown(payload.bodyMarkdown);
  const defaultMediaUrl = createDefaultTelegramMediaUrl(resource);
  const media = normalizeTelegramMedia(payload, defaultMediaUrl, false);
  const category = typeof payload.category === "string"
    ? payload.category.trim().slice(0, 48)
    : resource.category;
  const resourceData = serializeTelegramResource(resource);
  const now = new Date().toISOString();
  // 未知发送仍保留原锁；把原锁校验与草稿写入放在同一 SQL 中，防止重推或删除接管后写入。
  const lockCondition = uncertainLockToken
    ? `EXISTS(SELECT 1 FROM telegram_push_locks
              WHERE resource_type = ? AND resource_id = ? AND lock_token = ?
                AND (state = 'uncertain' OR (operation = 'send' AND expires_at <= ?)))`
    : "1 = 1";
  const lockParams = uncertainLockToken ? [resourceType, resourceId, uncertainLockToken, now] : [];
  let result: D1Result;

  if (existing) {
    // 未知发送共用原锁，保存时还需核对读取的内容；时间戳可能相同，不能单独作为版本。
    const snapshotCondition = uncertainLockToken
      ? `AND custom_title = ? AND resource_data = ? AND category = ? AND message_markdown = ?
         AND media_enabled = ? AND media_url = ? AND updated_at = ?`
      : "";
    result = await db.prepare(
      `UPDATE telegram_messages
       SET custom_title = ?, resource_data = ?, category = ?, message_markdown = ?, media_enabled = ?,
           media_url = ?, updated_at = ?
       WHERE id = ? AND ${lockCondition} ${snapshotCondition}`
    )
      .bind(
        customTitle,
        resourceData,
        category,
        messageMarkdown,
        media.enabled ? 1 : 0,
        media.url,
        now,
        existing.id,
        ...lockParams,
        ...(uncertainLockToken ? [
          existing.custom_title, existing.resource_data, existing.category, existing.message_markdown,
          existing.media_enabled, existing.media_url, existing.updated_at
        ] : [])
      )
      .run();
  } else {
    result = await db.prepare(
      `INSERT INTO telegram_messages
        (id, resource_type, resource_id, custom_title, resource_data, category, chat_id, target_ref,
         message_id, message_markdown, media_enabled,
         media_url, sent_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, '', ?
       WHERE ${lockCondition}
         AND NOT EXISTS(SELECT 1 FROM telegram_messages WHERE resource_type = ? AND resource_id = ?)`
    )
      .bind(
        crypto.randomUUID(),
        resource.type,
        resource.id,
        customTitle,
        resourceData,
        category,
        messageMarkdown,
        media.enabled ? 1 : 0,
        media.url,
        now,
        ...lockParams,
        resourceType,
        resourceId
      )
      .run();
  }

  if (Number(result.meta?.changes ?? 0) === 0) {
    throw new InvalidRequestError(TELEGRAM_PUSH_IN_PROGRESS_ERROR);
  }

  return getTelegramMessageState(
    env,
    resource.type,
    resource.id,
    origin,
    locale
  );
}

export async function sendTelegramMessage(
  env: Env,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  payload: TelegramMessagePayload
) {
  const settings = await requireEnabledTelegramSettings(env);
  const db = await getDatabase(env);
  return withTelegramPushLock(
    db,
    resourceType,
    resourceId,
    "send",
    (lock) => sendTelegramMessageUnlocked(
      env, db, settings, resourceType, resourceId, origin, payload, lock
    ),
    payload.confirmUncertainRetry === true
  );
}

async function sendTelegramMessageUnlocked(
  env: Env,
  db: D1Database,
  settings: TelegramSettings,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  payload: TelegramMessagePayload,
  lock: TelegramPushLockContext
) {
  const existing = await db.prepare(
    `SELECT * FROM telegram_messages
     WHERE resource_type = ? AND resource_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  )
    .bind(resourceType, resourceId)
    .first<TelegramMessageRow>();
  let resource = await loadStoredOrCurrentTelegramResource(
    db, resourceType, resourceId, origin, existing
  );
  resource = normalizeTelegramPayloadResource(payload.resource, resource);
  const customTitle = resolveTelegramCustomTitle(resource, payload);
  if (existing?.message_id) {
    throw new InvalidRequestError("This content has already been pushed to Telegram.");
  }

  const messageMarkdown = normalizeBodyMarkdown(payload.bodyMarkdown);
  const defaultBody = buildTelegramMessageMarkdown(
    resource,
    createDefaultTelegramBody(resource),
    settings.footerMarkdown,
    payload.locale === "en" ? "en" : "zh"
  );
  const media = normalizeTelegramMedia(
    payload,
    createDefaultTelegramMediaUrl(resource),
    false
  );
  const category = typeof payload.category === "string"
    ? payload.category.trim().slice(0, 48)
    : resource.category;
  const resourceData = serializeTelegramResource(resource);
  const pushedHash = await createTelegramMessageFingerprint(
    messageMarkdown,
    media.enabled,
    media.url
  );
  const targetRef = settings.target;
  await lock.markExternalRequestStarted();
  const message = await sendTelegramRemoteMessage(
    env,
    targetRef,
    messageMarkdown,
    media
  );
  lock.markExternalRequestCompleted();
  const now = new Date().toISOString();
  const chatId = String(message.chat.id);

  if (existing) {
    await db.prepare(
      `UPDATE telegram_messages
       SET custom_title = ?, resource_data = ?, category = ?, chat_id = ?, target_ref = ?, message_id = ?,
           message_markdown = ?, media_enabled = ?, media_url = ?,
           last_pushed_hash = ?, sent_at = ?, updated_at = ?, last_pushed_media_enabled = ?
       WHERE id = ?`
    )
      .bind(
        customTitle,
        resourceData,
        category,
        chatId,
        targetRef,
        String(message.message_id),
        messageMarkdown,
        media.enabled ? 1 : 0,
        media.url,
        pushedHash,
        now,
        now,
        media.enabled ? 1 : 0,
        existing.id
      )
      .run();
  } else {
    await db.prepare(
      `INSERT INTO telegram_messages
        (id, resource_type, resource_id, custom_title, resource_data, category, chat_id, target_ref,
         message_id, message_markdown, media_enabled,
         media_url, last_pushed_hash, sent_at, updated_at, last_pushed_media_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        resource.type,
        resource.id,
        customTitle,
        resourceData,
        category,
        chatId,
        targetRef,
        String(message.message_id),
        messageMarkdown,
        media.enabled ? 1 : 0,
        media.url,
        pushedHash,
        now,
        now,
        media.enabled ? 1 : 0
      )
      .run();
  }

  const row = await db.prepare(
    `SELECT * FROM telegram_messages
     WHERE resource_type = ? AND resource_id = ? AND chat_id = ?`
  )
    .bind(resourceType, resourceId, chatId)
    .first<TelegramMessageRow>();

  return toTelegramMessageState(
    row,
    defaultBody,
    createDefaultTelegramMediaUrl(resource),
    targetRef,
    resource,
    await telegramResourceExists(db, resourceType, resourceId)
  );
}

export async function updateTelegramMessage(
  env: Env,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  payload: TelegramMessagePayload
) {
  const settings = await requireEnabledTelegramSettings(env);
  const db = await getDatabase(env);
  return withTelegramPushLock(
    db,
    resourceType,
    resourceId,
    "update",
    (lock) => updateTelegramMessageUnlocked(
      env, db, settings, resourceType, resourceId, origin, payload, lock
    ),
    payload.confirmUncertainRetry === true
  );
}

async function updateTelegramMessageUnlocked(
  env: Env,
  db: D1Database,
  settings: TelegramSettings,
  resourceType: TelegramResourceType,
  resourceId: string,
  origin: string,
  payload: TelegramMessagePayload,
  lock: TelegramPushLockContext
) {
  const existing = await db.prepare(
    `SELECT * FROM telegram_messages
     WHERE resource_type = ? AND resource_id = ? AND message_id <> ''
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  )
    .bind(resourceType, resourceId)
    .first<TelegramMessageRow>();
  if (!existing) {
    throw new InvalidRequestError("Telegram message record was not found.");
  }
  let resource = await loadStoredOrCurrentTelegramResource(
    db, resourceType, resourceId, origin, existing
  );
  resource = normalizeTelegramPayloadResource(payload.resource, resource);
  const customTitle = resolveTelegramCustomTitle(resource, payload);
  const targetRef = settings.target;
  const targetChanged = hasTelegramTargetChanged(existing, targetRef);

  const messageMarkdown = normalizeBodyMarkdown(payload.bodyMarkdown);
  const defaultBody = buildTelegramMessageMarkdown(
    resource,
    createDefaultTelegramBody(resource),
    settings.footerMarkdown,
    payload.locale === "en" ? "en" : "zh"
  );
  const defaultMediaUrl = createDefaultTelegramMediaUrl(resource);
  const currentMediaEnabled = (existing.last_pushed_media_enabled ?? existing.media_enabled) === 1;
  const currentMediaUrl = getTelegramMediaUrl(existing.media_url) || defaultMediaUrl;
  const media = normalizeTelegramMedia(
    payload,
    currentMediaUrl,
    existing.media_enabled === 1
  );
  const category = typeof payload.category === "string"
    ? payload.category.trim().slice(0, 48)
    : resource.category;
  const resourceData = serializeTelegramResource(resource);
  const pushedHash = await createTelegramMessageFingerprint(
    messageMarkdown,
    media.enabled,
    media.url
  );
  let remoteMessage: TelegramMessage | null = null;
  let remoteMessageMissing: "deleted" | "target-changed" | null = null;
  if (targetChanged) {
    // ponytail: the stored message lives in a chat we no longer publish to, so editing
    // it is impossible. Keep the admin's edits, drop the stale remote link, and let the
    // UI ask whether a fresh message should go out to the new target.
    remoteMessageMissing = "target-changed";
  } else {
    await lock.markExternalRequestStarted();
    const replaceMessage = async () => {
      await lock.markExternalRequestStarted(true);
      return replaceTelegramRemoteMessage(env, existing, messageMarkdown, media);
    };
    try {
      remoteMessage = currentMediaEnabled === media.enabled
        ? await editTelegramRemoteMessage(
          env,
          existing,
          messageMarkdown,
          media
        )
        : await replaceMessage();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (
        existing.last_pushed_media_enabled == null && !media.enabled &&
        message.includes("there is no text in the message to edit")
      ) {
        // 旧版保存草稿可能已覆盖远端类型，只在 Telegram 明确拒绝文字编辑后修复。
        remoteMessage = await replaceMessage();
      } else if (isTelegramMessageMissingError(message)) {
        // ponytail: the admin deleted the message inside Telegram. Deleting can be
        // deliberate, so never re-send automatically — reset the record to "not pushed"
        // and let the admin confirm.
        remoteMessageMissing = "deleted";
      } else if (message.includes("message is not modified")) {
        remoteMessage = null;
      } else {
        throw error;
      }
    }
    lock.markExternalRequestCompleted();
  }

  const now = new Date().toISOString();
  // ponytail: when the remote message is unreachable the record must forget its old
  // Telegram identity, otherwise the next update would keep failing against a message
  // that no longer exists (or lives in the previous target).
  const nextChatId = remoteMessageMissing
    ? ""
    : remoteMessage
      ? String(remoteMessage.chat.id)
      : existing.chat_id;
  const nextMessageId = remoteMessageMissing
    ? ""
    : remoteMessage
      ? String(remoteMessage.message_id)
      : existing.message_id;
  await db.prepare(
    `UPDATE telegram_messages
     SET custom_title = ?, resource_data = ?, category = ?, chat_id = ?, target_ref = ?, message_id = ?, message_markdown = ?,
         media_enabled = ?, media_url = ?,
         last_pushed_hash = ?, sent_at = CASE WHEN ? = 1 THEN '' ELSE sent_at END, updated_at = ?,
         last_pushed_media_enabled = ?
     WHERE id = ?`
  )
    .bind(
      customTitle,
      resourceData,
      category,
      nextChatId,
      remoteMessageMissing ? "" : targetRef,
      nextMessageId,
      messageMarkdown,
      media.enabled ? 1 : 0,
      media.url,
      remoteMessageMissing ? "" : pushedHash,
      remoteMessageMissing ? 1 : 0,
      now,
      remoteMessageMissing ? null : media.enabled ? 1 : 0,
      existing.id
    )
    .run();

  const row = await db.prepare("SELECT * FROM telegram_messages WHERE id = ?")
    .bind(existing.id)
    .first<TelegramMessageRow>();
  const state = await toTelegramMessageState(
    row,
    defaultBody,
    defaultMediaUrl,
    targetRef,
    resource,
    await telegramResourceExists(db, resourceType, resourceId)
  );
  return remoteMessageMissing ? { ...state, remoteMessageMissing } : state;
}

export async function deleteTelegramPush(
  env: Env,
  resourceType: TelegramResourceType,
  resourceId: string,
  recordId?: string
) {
  const db = await getDatabase(env);
  const normalizedRecordId = recordId?.trim() ?? "";
  if (normalizedRecordId.length > 256) {
    throw new InvalidRequestError("Telegram message record is invalid.");
  }
  return withTelegramPushLock(db, resourceType, resourceId, "delete", () =>
    deleteTelegramPushUnlocked(db, resourceType, resourceId, normalizedRecordId)
  );
}

export async function deleteTelegramPushCategory(
  db: D1Database,
  filter: { category?: string; resourceType?: TelegramResourceType } = {}
) {
  const condition = filter.resourceType ? "resource_type = ?" : filter.category ? "category = ?" : "1 = 1";
  const params = filter.resourceType ? [filter.resourceType] : filter.category ? [filter.category] : [];
  const selectedResources = `SELECT resource_type, resource_id FROM telegram_messages WHERE ${condition}`;
  const activeLocks = `SELECT 1 FROM telegram_push_locks
    WHERE state = 'active' AND expires_at > ?
      AND (resource_type, resource_id) IN (${selectedResources})`;
  const now = new Date().toISOString();
  // 检查与删除在同一事务内执行；任一匹配消息仍在推送时，整批保留。
  const [blocked, , deleted] = await db.batch<{ total: number }>([
    db.prepare(`SELECT COUNT(*) AS total FROM (${activeLocks})`).bind(now, ...params),
    db.prepare(`DELETE FROM telegram_push_locks
      WHERE (resource_type, resource_id) IN (${selectedResources})
        AND NOT EXISTS (${activeLocks})`).bind(...params, now, ...params),
    db.prepare(`DELETE FROM telegram_messages
      WHERE ${condition} AND NOT EXISTS (${activeLocks})`).bind(...params, now, ...params)
  ]);
  if (Number(blocked.results[0]?.total ?? 0) > 0) {
    throw new InvalidRequestError(TELEGRAM_PUSH_IN_PROGRESS_ERROR);
  }
  return Number(deleted.meta?.changes ?? 0);
}

async function deleteTelegramPushUnlocked(
  db: D1Database,
  resourceType: TelegramResourceType,
  resourceId: string,
  normalizedRecordId: string
) {
  const existing = normalizedRecordId
    ? await db.prepare(
        `SELECT * FROM telegram_messages
         WHERE id = ? AND resource_type = ? AND resource_id = ?
         LIMIT 1`
      )
        .bind(normalizedRecordId, resourceType, resourceId)
        .first<TelegramMessageRow>()
    : await db.prepare(
        `SELECT * FROM telegram_messages
         WHERE resource_type = ? AND resource_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`
      )
        .bind(resourceType, resourceId)
        .first<TelegramMessageRow>();

  if (!existing) {
    throw new InvalidRequestError("Telegram message record was not found.");
  }

  await db.prepare("DELETE FROM telegram_messages WHERE id = ?")
    .bind(existing.id)
    .run();

  return {
    deleted: true as const,
    id: existing.id
  };
}

export function buildTelegramMessageMarkdown(
  resource: TelegramResource,
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
    : resource.tags
      .map(toTelegramHashtag)
      .filter(Boolean)
      .join(" ");
  const linkLabel = resource.type === "article" ? labels.article : labels.project;
  const demoLabel = resource.type === "content" ? labels.original : labels.demo;
  const resourceUrl = resource.type === "content" ? "" : resource.url;
  const sections = [
    editableBody,
    resourceUrl ? `${linkLabel}：[${resourceUrl}](${resourceUrl})` : "",
    resource.demoUrl ? `${demoLabel}：[${resource.demoUrl}](${resource.demoUrl})` : "",
    tags,
    footerMarkdown.trim()
  ].filter(Boolean);
  const message = sections.join(TELEGRAM_SECTION_SEPARATOR);

  if (Array.from(message).length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    throw new InvalidRequestError(TELEGRAM_MESSAGE_TOO_LONG_ERROR);
  }
  return message;
}

export function createTelegramSendPayload(markdown: string): TelegramTextPayload {
  const text = renderTelegramHtml(markdown);

  if (Array.from(text).length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    throw new InvalidRequestError("Telegram message exceeds the 4096 character limit.");
  }

  return {
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true }
  };
}

export function createTelegramPhotoPayload(
  markdown: string,
  mediaUrl: string
): TelegramPhotoPayload {
  const photo = getTelegramMediaUrl(mediaUrl);
  if (!photo) {
    throw new InvalidRequestError("Telegram image URL is required when image sending is enabled.");
  }
  if (Array.from(markdown).length > TELEGRAM_MAX_PHOTO_CAPTION_LENGTH) {
    throw new InvalidRequestError(TELEGRAM_PHOTO_CAPTION_TOO_LONG_ERROR);
  }
  return {
    photo,
    caption: renderTelegramHtml(markdown),
    parse_mode: "HTML"
  };
}

function createTelegramEditPhotoPayload(
  row: TelegramMessageRow,
  markdown: string,
  mediaUrl: string
): TelegramEditPhotoPayload {
  const payload = createTelegramPhotoPayload(markdown, mediaUrl);
  return {
    chat_id: row.chat_id,
    message_id: Number(row.message_id),
    media: {
      type: "photo",
      media: payload.photo,
      caption: payload.caption,
      parse_mode: payload.parse_mode
    }
  };
}

async function sendTelegramRemoteMessage(
  env: Env,
  targetRef: string,
  markdown: string,
  media: { enabled: boolean; url: string }
) {
  return media.enabled
    ? telegramRequest<TelegramMessage>(env, "sendPhoto", {
      chat_id: targetRef,
      ...createTelegramPhotoPayload(markdown, media.url)
    })
    : telegramRequest<TelegramMessage>(env, "sendMessage", {
      chat_id: targetRef,
      ...createTelegramSendPayload(markdown)
    });
}

async function editTelegramRemoteMessage(
  env: Env,
  row: TelegramMessageRow,
  markdown: string,
  media: { enabled: boolean; url: string }
) {
  return media.enabled
    ? telegramRequest<TelegramMessage>(
      env,
      "editMessageMedia",
      createTelegramEditPhotoPayload(row, markdown, media.url)
    )
    : telegramRequest<TelegramMessage>(env, "editMessageText", {
      chat_id: row.chat_id,
      message_id: Number(row.message_id),
      ...createTelegramSendPayload(markdown)
    });
}

async function replaceTelegramRemoteMessage(
  env: Env,
  row: TelegramMessageRow,
  markdown: string,
  media: { enabled: boolean; url: string }
) {
  const replacement = await sendTelegramRemoteMessage(
    env,
    row.target_ref || row.chat_id,
    markdown,
    media
  );
  try {
    await deleteTelegramRemoteMessage(env, row.chat_id, row.message_id);
  } catch (error) {
    try {
      await deleteTelegramRemoteMessage(
        env,
        String(replacement.chat.id),
        String(replacement.message_id)
      );
    } catch {
      throw new TelegramRequestError(
        "Telegram message replacement result is uncertain.",
        "uncertain"
      );
    }
    throw error;
  }
  return replacement;
}

async function deleteTelegramRemoteMessage(
  env: Env,
  chatId: string,
  messageId: string
) {
  try {
    await telegramRequest<true>(env, "deleteMessage", {
      chat_id: chatId,
      message_id: Number(messageId)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!isTelegramMessageMissingError(message)) throw error;
  }
}

function renderTelegramHtml(markdown: string) {
  const blocks: string[] = [];
  const inlines: string[] = [];
  let text = markdown.replace(/\r\n?/g, "\n").trim();

  text = text.replace(/```([A-Za-z0-9_+-]*)\n?([\s\S]*?)```/g, (_, language: string, body: string) => {
    const content = escapeTelegramHtml(body.replace(/\n$/, ""));
    blocks.push(
      language
        ? `<pre><code class="language-${escapeTelegramHtml(language)}">${content}</code></pre>`
        : `<pre>${content}</pre>`
    );
    return `%%TGB${blocks.length - 1}%%`;
  });

  text = text.replace(/`([^`\n]+)`/g, (_, body: string) => {
    inlines.push(`<code>${escapeTelegramHtml(body)}</code>`);
    return `%%TGI${inlines.length - 1}%%`;
  });

  text = escapeTelegramHtml(text)
    .replace(
      /\[([^\]\n]+)]\((https?:\/\/[^)\s]+)\)/g,
      (_, label: string, url: string) => `<a href="${url}">${label}</a>`
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");

  const lines: string[] = [];
  let quote: string[] = [];
  const flushQuote = () => {
    if (!quote.length) return;
    lines.push(`<blockquote>${quote.join("\n")}</blockquote>`);
    quote = [];
  };

  for (const line of text.split("\n")) {
    const quoted = line.match(/^&gt;\s?(.*)$/);
    if (quoted) {
      quote.push(quoted[1]);
      continue;
    }
    if (quote.length && isTelegramQuoteContinuation(line)) {
      quote.push(line);
      continue;
    }
    flushQuote();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    lines.push(heading ? `<b>${heading[1]}</b>` : line);
  }
  flushQuote();

  return lines
    .join("\n")
    .replace(/%%TGI(\d+)%%/g, (_, index: string) => inlines[Number(index)])
    .replace(/%%TGB(\d+)%%/g, (_, index: string) => blocks[Number(index)]);
}

function isTelegramQuoteContinuation(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (/^[-*+]\s/.test(trimmed)) return false;
  if (/^\d+\.\s/.test(trimmed)) return false;
  if (/^%%TGB\d+%%$/.test(trimmed)) return false;
  return true;
}

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hasTelegramConfiguration(env: Env, target: string) {
  return Boolean(getTelegramToken(env) && target);
}

async function requireEnabledTelegramSettings(env: Env) {
  const settings = await getTelegramSettings(env);
  if (!settings.available) {
    throw new InvalidRequestError(TELEGRAM_NOT_CONFIGURED_ERROR);
  }
  if (!settings.enabled) {
    throw new InvalidRequestError("Telegram pushing is disabled.");
  }
  return settings;
}

async function resolveTelegramConnection(
  env: Env,
  target: string,
  signal: AbortSignal
): Promise<TelegramConnection> {
  const bot = await telegramRequest<TelegramUser>(env, "getMe", {}, { signal });
  const chat = await telegramRequest<TelegramChat>(env, "getChat", {
    chat_id: target
  }, { signal });
  const type = chat.type ?? "unknown";

  if (type !== "private") {
    const member = await telegramRequest<TelegramChatMember>(env, "getChatMember", {
      chat_id: chat.id,
      user_id: bot.id
    }, { signal });
    const status = member.status ?? "";
    if (status === "left" || status === "kicked") {
      throw new InvalidRequestError("Telegram bot is not a member of the target chat.");
    }
    if (
      type === "channel" &&
      status !== "creator" &&
      (status !== "administrator" || member.can_post_messages === false)
    ) {
      throw new InvalidRequestError("Telegram bot cannot post to the target channel.");
    }
    if (
      (type === "group" || type === "supergroup") &&
      (member.can_send_messages === false ||
        (status === "member" && chat.permissions?.can_send_messages === false))
    ) {
      throw new InvalidRequestError("Telegram bot cannot send messages to the target group.");
    }
  }

  return {
    botName: bot.first_name?.trim() ?? "",
    botUsername: bot.username ?? "",
    chatId: String(chat.id),
    chatTitle: getTelegramChatTitle(chat),
    chatType: type,
    canSend: true
  };
}

async function telegramRequest<T>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const token = getTelegramToken(env);
  if (!token) {
    throw new InvalidRequestError(TELEGRAM_NOT_CONFIGURED_ERROR);
  }

  const retryable = TELEGRAM_SAFE_RETRY_METHODS.has(method);
  const attempts = retryable ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      const signal = options.signal ?? AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS);
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt + 1 < attempts) {
        await waitForTelegramRetry(options.signal);
        continue;
      }
      throw new TelegramRequestError("Telegram API request failed.", "uncertain");
    }

    const data = (await response.json().catch(() => ({}))) as TelegramApiResponse<T>;
    if (response.ok && data.ok === true && data.result !== undefined) return data.result;

    const outcomeUncertain =
      response.status === 408 ||
      response.status === 425 ||
      response.status >= 500 ||
      response.ok;
    if (outcomeUncertain && attempt + 1 < attempts) {
      await waitForTelegramRetry(options.signal);
      continue;
    }
    throw new TelegramRequestError(
      data.description ? `Telegram API: ${data.description}` : "Telegram API request failed.",
      outcomeUncertain ? "uncertain" : "known"
    );
  }

  throw new TelegramRequestError("Telegram API request failed.", "uncertain");
}

async function waitForTelegramRetry(signal?: AbortSignal) {
  await new Promise((resolve) => setTimeout(resolve, TELEGRAM_RETRY_DELAY_MS));
  signal?.throwIfAborted();
}

function getTelegramToken(env: Env) {
  const token = env.TGTOKEN?.trim() ?? "";
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token) ? token : "";
}

function getTelegramEnvironmentTarget(env: Env) {
  try {
    return normalizeTelegramTarget(env.TGID);
  } catch {
    return "";
  }
}

function normalizeTelegramTarget(value: unknown) {
  const target = typeof value === "string" ? value.trim() : "";
  if (!target) return "";
  if (/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(target)) return target;
  if (/^-?\d{5,20}$/.test(target)) return target;
  throw new InvalidRequestError("Telegram target is invalid.");
}

function normalizeFooterMarkdown(value: unknown) {
  const footer = typeof value === "string"
    ? value
        .replace(/\r\n?/g, "\n")
        .replace(
          /(^|[\s｜|])([^\[\]\n()｜|]+?)\s*\((https?:\/\/[^)\s]+)\)/g,
          (_, prefix: string, label: string, url: string) =>
            `${prefix}[${label.trim()}](${url})`
        )
        .replace(/\s*｜\s*/g, " ｜ ")
        .trim()
    : "";
  if (Array.from(footer).length > TELEGRAM_MAX_FOOTER_LENGTH) {
    throw new InvalidRequestError("Telegram message footer is too long.");
  }
  return footer;
}

function normalizeBodyMarkdown(value: unknown) {
  const body = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) throw new InvalidRequestError("Telegram message body is required.");
  if (Array.from(body).length > TELEGRAM_MAX_BODY_LENGTH) {
    throw new InvalidRequestError("Telegram message body is too long.");
  }
  return body;
}

function normalizeTelegramMedia(
  payload: TelegramMessagePayload,
  fallbackUrl: string,
  fallbackEnabled: boolean
) {
  const enabled = typeof payload.mediaEnabled === "boolean"
    ? payload.mediaEnabled
    : fallbackEnabled;
  const rawUrl = typeof payload.mediaUrl === "string"
    ? payload.mediaUrl.trim()
    : fallbackUrl;
  const url = getTelegramMediaUrl(rawUrl);

  if (rawUrl && !url) {
    throw new InvalidRequestError("Telegram image URL must use HTTP or HTTPS.");
  }
  if (enabled && !url) {
    throw new InvalidRequestError("Telegram image URL is required when image sending is enabled.");
  }
  if (url.length > 2048) {
    throw new InvalidRequestError("Telegram image URL is too long.");
  }

  return { enabled, url };
}

async function toTelegramPushListRecord(
  row: TelegramPushListRow,
  origin: string,
  footerMarkdown: string
): Promise<TelegramPushListRecord> {
  const resource = createTelegramPushListResource(row, origin, footerMarkdown);
  const messageMarkdown = normalizeTelegramEditableMessageMarkdown(
    row.message_markdown
  );
  const mediaEnabled = row.media_enabled === 1;
  const mediaUrl = getTelegramMediaUrl(row.media_url);
  const currentHash = await createTelegramMessageFingerprint(
    row.message_markdown,
    mediaEnabled,
    mediaUrl
  );

  return {
    id: row.id,
    deliveryUncertain: row.delivery_uncertain === 1,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    title: resource?.title ?? readTelegramMessageTitle(row.message_markdown),
    resourceExists: row.resource_type === "custom" || row.resource_exists === 1,
    resource,
    messageMarkdown,
    mediaEnabled,
    mediaUrl,
    syncStatus: !row.message_id
      ? "not_pushed"
      : row.last_pushed_hash === currentHash
        ? "synced"
        : "pending",
    sentAt: row.sent_at,
    updatedAt: row.updated_at
  };
}

function createTelegramPushListResource(
  row: TelegramPushListRow,
  origin: string,
  footerMarkdown: string
): TelegramResource | null {
  const stored = parseTelegramStoredResource(
    row.resource_data,
    row.resource_type,
    row.resource_id,
    origin,
    row.category
  );
  if (stored) return stored;

  if (row.resource_type === "custom") {
    const content = parseCustomPushContent(
      row.message_markdown,
      footerMarkdown,
      row.custom_title
    );
    return {
      type: "custom",
      id: row.resource_id,
      title: row.custom_title,
      description: content.description,
      url: "",
      demoUrl: "",
      image: "",
      category: row.category ?? "",
      tags: content.tags
    };
  }

  return null;
}

function resolveTelegramCustomTitle(
  resource: TelegramResource,
  payload: TelegramMessagePayload
) {
  const provided = typeof payload.title === "string" ? payload.title.trim() : "";
  const title = (provided || resource.title).slice(0, 120);
  if (!title) throw new InvalidRequestError("Telegram message title is required.");
  resource.title = title;
  return title;
}

function normalizeTelegramPayloadResource(
  value: unknown,
  fallback: TelegramResource
): TelegramResource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const input = value as Partial<Record<keyof TelegramResource, unknown>>;
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : fallback.title;
  const description = typeof input.description === "string"
    ? input.description.trim().slice(0, 4000)
    : fallback.description;
  const url = typeof input.url === "string" ? input.url.trim().slice(0, 2048) : fallback.url;
  const demoUrl = typeof input.demoUrl === "string"
    ? input.demoUrl.trim().slice(0, 2048)
    : fallback.demoUrl;
  const image = typeof input.image === "string" ? input.image.trim().slice(0, 2048) : fallback.image;
  const category = typeof input.category === "string"
    ? input.category.trim().slice(0, 48)
    : fallback.category;
  const tags = Array.isArray(input.tags)
    ? input.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().replace(/^#+/, "").slice(0, 48))
        .filter(Boolean)
        .slice(0, 24)
    : fallback.tags;

  if (!title) throw new InvalidRequestError("Telegram message title is required.");
  for (const candidate of [url, demoUrl, image]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      throw new InvalidRequestError("Telegram resource URLs must use HTTP or HTTPS.");
    }
  }

  return {
    type: fallback.type,
    id: fallback.id,
    title,
    description,
    url,
    demoUrl,
    image,
    category,
    tags: Array.from(new Set(tags))
  };
}

function serializeTelegramResource(resource: TelegramResource) {
  return JSON.stringify({
    ...resource,
    url: resource.url,
    demoUrl: resource.demoUrl,
    image: resource.image,
    tags: resource.tags
  });
}

function parseTelegramStoredResource(
  value: string,
  type: TelegramResourceType,
  id: string,
  origin: string,
  categoryOverride = ""
): TelegramResource | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TelegramResource>;
    if (parsed.type !== type || typeof parsed.title !== "string") return null;
    return {
      type,
      id,
      title: parsed.title,
      description: typeof parsed.description === "string" ? parsed.description : "",
      url: resolveTelegramPublicUrl(typeof parsed.url === "string" ? parsed.url : "", origin),
      demoUrl: resolveTelegramPublicUrl(typeof parsed.demoUrl === "string" ? parsed.demoUrl : "", origin),
      image: resolveTelegramPublicUrl(typeof parsed.image === "string" ? parsed.image : "", origin),
      category: categoryOverride,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : []
    };
  } catch {
    return null;
  }
}

async function loadStoredOrCurrentTelegramResource(
  db: D1Database,
  type: TelegramResourceType,
  id: string,
  origin: string,
  row: TelegramMessageRow | null
) {
  const stored = parseTelegramStoredResource(
    row?.resource_data ?? "",
    type,
    id,
    origin,
    row?.category ?? ""
  );
  if (stored) return stored;
  try {
    return await loadTelegramResource(db, type, id, origin);
  } catch (error) {
    if (!row || type === "custom") throw error;
    const content = parseCustomPushContent(row.message_markdown, "", row.custom_title);
    return {
      type,
      id,
      title: row.custom_title || readTelegramMessageTitle(row.message_markdown),
      description: content.description,
      url: "",
      demoUrl: "",
      image: getTelegramMediaUrl(row.media_url),
      category: row.category,
      tags: content.tags
    };
  }
}

function stripTelegramFooter(markdown: string, footerMarkdown: string) {
  const body = markdown.trim();
  const footer = footerMarkdown.trim();
  if (!footer || !body.endsWith(footer)) return body;
  return body.slice(0, body.length - footer.length).trim();
}

export function normalizeTelegramEditableMessageMarkdown(markdown: string) {
  return markdown.replace(
    /^(项目地址|演示地址|文章地址|本站浏览|原文地址|Project|Article|Demo|Repository|Site View|Original)([：:])\s*(https?:\/\/\S+)$/gim,
    (_line, label: string, separator: string, url: string) =>
      `${label}${separator}[${url}](${url})`
  );
}

function parseCustomPushContent(
  markdown: string,
  footerMarkdown: string,
  title: string
) {
  const body = stripTelegramFooter(markdown, footerMarkdown);
  const tags: string[] = [];
  const lines: string[] = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#[^\s#]+(\s+#[^\s#]+)*$/.test(trimmed)) {
      for (const tag of trimmed.split(/\s+/)) {
        const name = tag.replace(/^#/, "").trim();
        if (name && !tags.includes(name)) tags.push(name);
      }
      continue;
    }
    lines.push(trimmed.replace(/^>\s*/, ""));
  }

  const heading = title.trim();
  if (heading && lines[0] === `**${heading}**`) lines.shift();

  return { description: lines.join(" "), tags };
}

function readTelegramMessageTitle(markdown: string) {
  const firstLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const plain = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*{1,3}|\*{1,3}$/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .trim();
  return plain.slice(0, 120) || "Telegram";
}

function readTelegramPushCursor(
  value: string | null,
  sort: TelegramPushSortMode
): TelegramPushCursor | null {
  if (!value) return null;
  if (value.length > 1024) throw new InvalidRequestError("Telegram push cursor is invalid.");

  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TelegramPushCursor>;
    if (
      parsed.sort !== sort ||
      typeof parsed.sortKey !== "string" ||
      parsed.sortKey.length > 256 ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      parsed.id.length > 256
    ) {
      throw new Error();
    }
    return parsed as TelegramPushCursor;
  } catch {
    throw new InvalidRequestError("Telegram push cursor is invalid.");
  }
}

function createTelegramPushCursor(cursor: TelegramPushCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loadTelegramResource(
  db: D1Database,
  type: TelegramResourceType,
  id: string,
  origin: string
): Promise<TelegramResource> {
  if (type === "custom") {
    const record = await db.prepare(
      `SELECT custom_title FROM telegram_messages
       WHERE resource_type = 'custom' AND resource_id = ?`
    )
      .bind(id)
      .first<{ custom_title: string }>();
    return {
      type,
      id,
      title: record?.custom_title ?? "",
      description: "",
      url: "",
      demoUrl: "",
      image: "",
      category: "",
      tags: []
    };
  }

  if (type === "tool") {
    const tool = await db.prepare("SELECT * FROM tools WHERE id = ?")
      .bind(id)
      .first<ToolRow>();
    if (!tool) throw new InvalidRequestError("Tool not found.");
    return {
      type,
      id: tool.id,
      title: tool.name,
      description: tool.description,
      url: resolveTelegramPublicUrl(tool.url, origin),
      demoUrl: resolveTelegramPublicUrl(tool.demo_url ?? "", origin),
      image: resolveTelegramPublicUrl(tool.image, origin),
      category: "",
      tags: getEffectiveTags(safelyParseTags(tool.tags), tool.category)
    };
  }

  if (type === "content") {
    const item = await db.prepare("SELECT * FROM content_items WHERE id = ?")
      .bind(id)
      .first<ContentItemRow>();
    if (!item) throw new InvalidRequestError("Content item not found.");
    return {
      type,
      id: item.id,
      title: item.title,
      description: item.summary,
      url: "",
      demoUrl: resolveTelegramPublicUrl(item.url, origin),
      image: resolveTelegramPublicUrl(item.cover_image, origin),
      category: "",
      tags: getEffectiveTags(safelyParseTags(item.tags), item.category)
    };
  }

  const article = await db.prepare("SELECT * FROM articles WHERE id = ?")
    .bind(id)
    .first<ArticleRow>();
  if (!article) throw new InvalidRequestError("Article not found.");
  return {
    type,
    id: article.id,
    title: article.title,
    description: article.summary,
    url: article.published === 1
      ? resolveTelegramPublicUrl(`/articles/${encodeURIComponent(article.slug)}`, origin)
      : "",
    demoUrl: "",
    image: resolveTelegramPublicUrl(article.cover_image, origin),
    category: "",
    tags: getEffectiveTags(safelyParseTags(article.tags), article.category)
  };
}

function createDefaultTelegramBody(resource: TelegramResource) {
  const description = escapeTelegramMarkdownText(resource.description);
  const title = escapeTelegramMarkdownText(resource.title);
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

async function toTelegramMessageState(
  row: TelegramMessageRow | null,
  defaultBody: string,
  defaultMediaUrl: string,
  targetRef: string,
  resource: TelegramResource,
  resourceExists: boolean,
  deliveryUncertain = false
): Promise<TelegramMessageState> {
  const sentMediaUrl = getTelegramMediaUrl(row?.media_url ?? "") || defaultMediaUrl;
  const storedMarkdown = row?.message_markdown || "";
  const bodyMarkdown = storedMarkdown
    ? normalizeTelegramEditableMessageMarkdown(storedMarkdown)
    : defaultBody;
  const mediaEnabled = row ? row.media_enabled === 1 : false;
  const currentHash = await createTelegramMessageFingerprint(
    storedMarkdown || bodyMarkdown,
    mediaEnabled,
    sentMediaUrl
  );
  return {
    exists: Boolean(row?.message_id),
    deliveryUncertain,
    targetChanged: hasTelegramTargetChanged(row, targetRef),
    syncStatus: !row?.message_id
      ? "not_pushed"
      : row.last_pushed_hash === currentHash
        ? "synced"
        : "pending",
    bodyMarkdown,
    mediaEnabled,
    mediaUrl: sentMediaUrl,
    defaultBodyMarkdown: defaultBody,
    defaultMediaUrl,
    resource,
    resourceExists
  };
}

async function telegramResourceExists(
  db: D1Database,
  type: TelegramResourceType,
  id: string
) {
  if (type === "custom") return true;
  const table = type === "tool"
    ? "tools"
    : type === "article"
      ? "articles"
      : "content_items";
  const row = await db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ found: number }>();
  return Boolean(row);
}

export function hasTelegramTargetChanged(
  row: TelegramMessageRow | null,
  targetRef: string
) {
  if (!row?.message_id || !targetRef) return false;
  if (row.target_ref) return row.target_ref !== targetRef;
  return Boolean(row.chat_id && row.chat_id !== targetRef);
}

export async function createTelegramMessageFingerprint(
  bodyMarkdown: string,
  mediaEnabled: boolean,
  mediaUrl: string
) {
  const payload = JSON.stringify({
    bodyMarkdown,
    mediaEnabled,
    mediaUrl: mediaEnabled ? mediaUrl : ""
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function createDefaultTelegramMediaUrl(resource: TelegramResource) {
  const repoPath = resource.type === "tool" ? getGitHubRepoPath(resource.url) : "";
  const currentImage = getTelegramMediaUrl(resource.image);

  if (resource.type === "article" || resource.type === "content") return currentImage;

  if (
    repoPath &&
    (!currentImage || isGeneratedPreviewUrl(currentImage))
  ) {
    return `https://opengraph.githubassets.com/htools/${repoPath}`;
  }

  if (currentImage) return currentImage;
  const resourceUrl = getTelegramMediaUrl(resource.url);
  return resourceUrl
    ? `https://image.thum.io/get/width/1200/crop/720/${resourceUrl}`
    : "";
}

function getGitHubRepoPath(value: string) {
  try {
    const url = new URL(value);
    if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return "";
    const [owner, repository] = url.pathname.split("/").filter(Boolean).slice(0, 2);
    return owner && repository
      ? `${owner}/${repository.replace(/\.git$/i, "")}`
      : "";
  } catch {
    return "";
  }
}

function isGeneratedPreviewUrl(value: string) {
  try {
    return ["image.thum.io", "opengraph.githubassets.com"].includes(
      new URL(value).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

function safelyParseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function toTelegramHashtag(value: string) {
  const normalized = value.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]+/gu, "_");
  return normalized ? `#${normalized.replace(/^_+|_+$/g, "")}` : "";
}

function getTelegramChatTitle(chat: TelegramChat) {
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  return chat.title?.trim() || name || (chat.username ? `@${chat.username}` : String(chat.id));
}

function getTelegramMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function resolveTelegramPublicUrl(value: string, origin: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, normalizeTelegramOrigin(origin));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeTelegramOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    // Fall through to the invalid local origin below.
  }
  return "https://invalid.local";
}

function escapeTelegramMarkdownText(value: string) {
  return value.trim().replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
}


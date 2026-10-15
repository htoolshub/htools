CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  demo_url TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  github_language TEXT NOT NULL DEFAULT '',
  github_license TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tools_latest_sort
  ON tools (updated_at DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tools_category_latest_sort
  ON tools (category, updated_at DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tools_featured_latest_sort
  ON tools (featured, updated_at DESC, created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_tools_category;
DROP INDEX IF EXISTS idx_tools_featured;

CREATE TABLE IF NOT EXISTS telegram_messages (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('tool', 'article', 'content', 'custom')),
  resource_id TEXT NOT NULL,
  custom_title TEXT NOT NULL DEFAULT '',
  resource_data TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  chat_id TEXT NOT NULL,
  target_ref TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL,
  message_markdown TEXT NOT NULL DEFAULT '',
  media_enabled INTEGER NOT NULL DEFAULT 0,
  media_url TEXT NOT NULL DEFAULT '',
  last_pushed_hash TEXT NOT NULL DEFAULT '',
  last_pushed_media_enabled INTEGER,
  sent_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_type, resource_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_resource
  ON telegram_messages (resource_type, resource_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS telegram_push_locks (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('tool', 'article', 'content', 'custom')),
  resource_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('save', 'send', 'update', 'recover', 'delete')),
  lock_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'uncertain')),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  cover_image TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  content_item_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  client_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_updated_at
ON admin_login_attempts (updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_content_item_id
  ON articles (content_item_id)
  WHERE content_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_public_sort
  ON articles (
    published,
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_articles_public_category_sort
  ON articles (
    published,
    category,
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_articles_latest_sort
  ON articles (
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_articles_category_latest_sort
  ON articles (
    category,
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_articles_name_sort
  ON articles (title, id);
CREATE INDEX IF NOT EXISTS idx_articles_category_name_sort
  ON articles (category, title, id);
DROP INDEX IF EXISTS idx_articles_slug;
DROP INDEX IF EXISTS idx_articles_published;
DROP INDEX IF EXISTS idx_articles_category;

CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  site_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_sources_category
  ON content_sources (category);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  article_id TEXT,
  UNIQUE(source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_content_items_latest_sort
  ON content_items (
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_content_items_source_latest_sort
  ON content_items (
    source_id,
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_content_items_category_latest_sort
  ON content_items (
    category,
    COALESCE(published_at, updated_at, created_at) DESC,
    id DESC
  );
DROP INDEX IF EXISTS idx_content_items_source;
DROP INDEX IF EXISTS idx_content_items_category;

DROP INDEX IF EXISTS idx_github_oauth_states_expires_at;
DROP INDEX IF EXISTS idx_github_sessions_expires_at;
DROP TABLE IF EXISTS github_oauth_states;
DROP TABLE IF EXISTS github_sessions;
DELETE FROM app_settings WHERE key LIKE 'github_submission_cooldown:%';
UPDATE app_settings
SET value = CASE WHEN json_valid(value) THEN
      '{"enabled":' ||
        CASE WHEN json_extract(value, '$.enabled') = 1 THEN 'true' ELSE 'false' END ||
        ',"owner":' || json_quote(TRIM(COALESCE(json_extract(value, '$.owner'), ''))) ||
        ',"repo":' || json_quote(TRIM(COALESCE(json_extract(value, '$.repo'), ''))) ||
        ',"labels":' || CASE
          WHEN json_type(value, '$.labels') = 'array' THEN json_extract(value, '$.labels')
          ELSE '["tool-submission"]'
        END || '}'
      ELSE '{"enabled":false,"owner":"","repo":"","labels":["tool-submission"]}'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'github_settings';

CREATE VIRTUAL TABLE IF NOT EXISTS articles_search USING fts5(
  article_id UNINDEXED,
  title,
  summary,
  content,
  slug,
  category,
  tags,
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS articles_search_ai
AFTER INSERT ON articles
BEGIN
  INSERT INTO articles_search
    (article_id, title, summary, content, slug, category, tags)
  VALUES
    (new.id, new.title, new.summary, new.content, new.slug, new.category, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS articles_search_au
AFTER UPDATE OF title, summary, content, slug, category, tags ON articles
BEGIN
  DELETE FROM articles_search WHERE article_id = old.id;
  INSERT INTO articles_search
    (article_id, title, summary, content, slug, category, tags)
  VALUES
    (new.id, new.title, new.summary, new.content, new.slug, new.category, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS articles_search_ad
AFTER DELETE ON articles
BEGIN
  DELETE FROM articles_search WHERE article_id = old.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS content_items_search USING fts5(
  item_id UNINDEXED,
  source_id UNINDEXED,
  title,
  summary,
  url,
  author,
  tags,
  source_title,
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS content_items_search_ai
AFTER INSERT ON content_items
BEGIN
  INSERT INTO content_items_search
    (item_id, source_id, title, summary, url, author, tags, source_title)
  VALUES
    (new.id, new.source_id, new.title, new.summary, new.url, new.author, new.tags,
     COALESCE((SELECT title FROM content_sources WHERE id = new.source_id), ''));
END;

CREATE TRIGGER IF NOT EXISTS content_items_search_au
AFTER UPDATE OF source_id, title, summary, url, author, tags ON content_items
BEGIN
  DELETE FROM content_items_search WHERE item_id = old.id;
  INSERT INTO content_items_search
    (item_id, source_id, title, summary, url, author, tags, source_title)
  VALUES
    (new.id, new.source_id, new.title, new.summary, new.url, new.author, new.tags,
     COALESCE((SELECT title FROM content_sources WHERE id = new.source_id), ''));
END;

CREATE TRIGGER IF NOT EXISTS content_items_search_ad
AFTER DELETE ON content_items
BEGIN
  DELETE FROM content_items_search WHERE item_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS content_items_article_unlink_ad
AFTER DELETE ON content_items
BEGIN
  UPDATE articles SET content_item_id = NULL WHERE content_item_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS content_sources_search_au
AFTER UPDATE OF title ON content_sources
BEGIN
  DELETE FROM content_items_search WHERE source_id = old.id;
  INSERT INTO content_items_search
    (item_id, source_id, title, summary, url, author, tags, source_title)
  SELECT id, source_id, title, summary, url, author, tags, new.title
  FROM content_items
  WHERE source_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS content_sources_search_ad
AFTER DELETE ON content_sources
BEGIN
  DELETE FROM content_items_search WHERE source_id = old.id;
END;

DELETE FROM articles_search;
INSERT INTO articles_search
  (article_id, title, summary, content, slug, category, tags)
SELECT id, title, summary, content, slug, category, tags
FROM articles;

DELETE FROM content_items_search;
INSERT INTO content_items_search
  (item_id, source_id, title, summary, url, author, tags, source_title)
SELECT content_items.id, content_items.source_id, content_items.title,
       content_items.summary, content_items.url, content_items.author,
       content_items.tags, content_sources.title
FROM content_items
JOIN content_sources ON content_sources.id = content_items.source_id;

UPDATE articles SET content_item_id = NULL
WHERE content_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM content_items WHERE id = articles.content_item_id);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('database_schema_version', '18', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;

import {
  contentSourceFromRow,
  fetchFeedPreview,
  getDatabase,
  json,
  jsonDeleted,
  jsonError,
  requireAdmin,
  resolveContentSourceFetchUrl,
  validateContentSourcePayload,
  writeErrorResponse,
  type ContentSourceRow,
  type Env
} from "../../../_shared";

export const onRequestPut: PagesFunction<Env> = async ({
  request,
  env,
  params
}) => {
  const unauthorized = await requireAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const id = String(params.id ?? "");
    const db = await getDatabase(env);
    const existing = await db.prepare("SELECT * FROM content_sources WHERE id = ?")
      .bind(id)
      .first<ContentSourceRow>();

    if (!existing) {
      return jsonError("Content source not found.", "NOT_FOUND", { status: 404 });
    }

    const payload = validateContentSourcePayload(
      (await request.json()) as object
    );
    const urlChanged = payload.url !== existing.url;
    const preview = urlChanged
      ? await fetchFeedPreview(await resolveContentSourceFetchUrl(db, payload.url))
      : null;
    const now = new Date().toISOString();

    const statements = [db.prepare(
      `UPDATE content_sources
       SET title = ?, url = ?, site_url = ?, description = ?,
           category = ?, tags = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        payload.title || preview?.title || existing.title,
        payload.url,
        payload.siteUrl || preview?.siteUrl || existing.site_url,
        payload.description || preview?.description || existing.description,
        payload.category,
        JSON.stringify(payload.tags),
        payload.enabled ? 1 : 0,
        now,
        id
      )];

    if (urlChanged) {
      statements.push(db.prepare("DELETE FROM content_items WHERE source_id = ?")
        .bind(id));
    } else {
      statements.push(db.prepare(
        `UPDATE content_items
         SET category = ?, updated_at = ?
         WHERE source_id = ?`
      )
        .bind(payload.category, now, id));
    }
    await db.batch(statements);

    const row = await db.prepare("SELECT * FROM content_sources WHERE id = ?")
      .bind(id)
      .first<ContentSourceRow>();

    if (!row) {
      return jsonError("Content source could not be loaded after update.", "SERVER_ERROR", { status: 500 });
    }
    return json({ source: contentSourceFromRow(row) });
  } catch (error) {
    return writeErrorResponse(error, "Unable to update content source.");
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({
  request,
  env,
  params
}) => {
  const unauthorized = await requireAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  const id = String(params.id ?? "");
  const db = await getDatabase(env);
  const existing = await db.prepare("SELECT id FROM content_sources WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) {
    return jsonError("Content source not found.", "NOT_FOUND", { status: 404 });
  }
  await db.batch([
    db.prepare("DELETE FROM content_items WHERE source_id = ?").bind(id),
    db.prepare("DELETE FROM content_sources WHERE id = ?").bind(id)
  ]);
  return jsonDeleted("contentSource", id);
};

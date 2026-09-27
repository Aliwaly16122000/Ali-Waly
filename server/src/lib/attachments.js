import { Router } from 'express';
import db from '../db.js';
import { notFound, toId } from './http.js';
import { courseAccess } from './access.js';
import { removeUpload, sendUpload, storedName } from './upload.js';

/** Files attached to posts (announcements, lecture notes) and assessments (sheets, assignments). */

export function saveAttachments(ownerType, ownerId, files = []) {
  const ins = db.prepare('INSERT INTO attachments (owner_type, owner_id, path, name, size) VALUES (?, ?, ?, ?, ?)');
  for (const f of files) ins.run(ownerType, ownerId, storedName(f), f.originalname, f.size ?? null);
}

/** ownerId → [{ id, name, size }] for many owners at once. */
export function attachmentsFor(ownerType, ownerIds) {
  const map = new Map(ownerIds.map((id) => [id, []]));
  if (!ownerIds.length) return map;
  const rows = db.prepare(`SELECT id, owner_id, name, size FROM attachments WHERE owner_type = ?
    AND owner_id IN (${ownerIds.map(() => '?').join(',')}) ORDER BY id`).all(ownerType, ...ownerIds);
  for (const { owner_id, ...a } of rows) map.get(owner_id)?.push(a);
  return map;
}

/** Deletes some (by id) or all attachments of an owner, files included. */
export function removeAttachments(ownerType, ownerId, ids = null) {
  const rows = db.prepare('SELECT id, path FROM attachments WHERE owner_type = ? AND owner_id = ?').all(ownerType, ownerId)
    .filter((a) => !ids || ids.includes(a.id));
  const del = db.prepare('DELETE FROM attachments WHERE id = ?');
  for (const a of rows) { del.run(a.id); removeUpload(a.path); }
}

/** Removes files multer already wrote when the request then fails. */
export const discardUploads = (req) => [req.file, ...(req.files || [])].filter(Boolean).forEach((f) => removeUpload(storedName(f)));

const COURSE_OF = {
  post: db.prepare('SELECT course_id FROM posts WHERE id = ?').pluck(),
  assessment: db.prepare('SELECT course_id FROM assessments WHERE id = ?').pluck(),
};

/** GET /api/attachments/:id — anyone in the course can download. */
export const attachmentsRouter = Router();
attachmentsRouter.get('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(toId(req.params.id));
  const courseId = a && COURSE_OF[a.owner_type].get(a.owner_id);
  if (!courseId) throw notFound('الملف غير موجود');
  courseAccess(req.user, courseId);
  sendUpload(res, a.path, a.name);
});

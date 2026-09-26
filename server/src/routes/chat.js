import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { parse, badRequest, forbidden, notFound, toId } from '../lib/http.js';
import { canChat } from '../lib/access.js';
import { upload, storedName, removeUpload, sendUpload } from '../lib/upload.js';
import { emitTo, isOnline } from '../lib/realtime.js';
import { notify } from '../lib/notify.js';
import { nowIso } from '../lib/time.js';

const router = Router();

const ROLE_LABEL = { doctor: 'د.', ta: 'م.', student: '' };

/** People the current user can start a conversation with, grouped by shared course. */
router.get('/contacts', (req, res) => {
  const { user } = req;
  const rows = user.role === 'student'
    ? db.prepare(`
        SELECT u.id, u.name, u.role, c.id AS course_id, c.name AS course_name, c.code AS course_code
        FROM enrollments e JOIN course_staff cs ON cs.course_id = e.course_id
        JOIN users u ON u.id = cs.user_id JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = ? AND u.is_active = 1 ORDER BY c.code, cs.role, u.name`).all(user.id)
    : db.prepare(`
        SELECT u.id, u.name, u.role, c.id AS course_id, c.name AS course_name, c.code AS course_code, e.section
        FROM course_staff me JOIN courses c ON c.id = me.course_id
        JOIN (SELECT course_id, user_id, NULL AS section FROM course_staff
              UNION ALL SELECT course_id, student_id, section FROM enrollments) e ON e.course_id = me.course_id
        JOIN users u ON u.id = e.user_id
        WHERE me.user_id = ? AND u.id != ? AND u.is_active = 1
        ORDER BY c.code, CASE u.role WHEN 'doctor' THEN 0 WHEN 'ta' THEN 1 ELSE 2 END, u.name`).all(user.id, user.id);
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.course_id)) groups.set(r.course_id, { course_id: r.course_id, course_name: r.course_name, course_code: r.course_code, members: [] });
    groups.get(r.course_id).members.push({ id: r.id, name: r.name, role: r.role, section: r.section ?? null, online: isOnline(r.id) });
  }
  res.json([...groups.values()]);
});

router.get('/conversations', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`
    SELECT c.id, c.last_message_at, u.id AS other_id, u.name AS other_name, u.role AS other_role,
      (SELECT COALESCE(m.body, '📎 ' || m.file_name) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL) AS unread
    FROM conversations c JOIN users u ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
    WHERE (c.user1_id = ? OR c.user2_id = ?)
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`).all(uid, uid, uid, uid);
  res.json(rows.map((r) => ({ ...r, online: isOnline(r.other_id) })));
});

router.get('/unread-count', (req, res) => {
  const uid = req.user.id;
  res.json({ count: db.prepare(`
    SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE (c.user1_id = ? OR c.user2_id = ?) AND m.sender_id != ? AND m.read_at IS NULL`).pluck().get(uid, uid, uid) });
});

router.post('/conversations', (req, res) => {
  const { user_id } = parse(z.object({ user_id: z.number().int().positive() }), req.body);
  if (!canChat(req.user.id, user_id)) throw forbidden('لا يمكنك مراسلة هذا المستخدم');
  const [a, b] = [req.user.id, user_id].sort((x, y) => x - y);
  db.prepare('INSERT OR IGNORE INTO conversations (user1_id, user2_id, created_at) VALUES (?, ?, ?)').run(a, b, nowIso());
  const conv = db.prepare('SELECT id FROM conversations WHERE user1_id = ? AND user2_id = ?').get(a, b);
  res.json({ id: conv.id });
});

function loadConversation(req) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(toId(req.params.id));
  if (!c || (c.user1_id !== req.user.id && c.user2_id !== req.user.id)) throw notFound('المحادثة غير موجودة');
  const otherId = c.user1_id === req.user.id ? c.user2_id : c.user1_id;
  return { c, otherId };
}

const messageColumns = 'id, conversation_id, sender_id, body, file_name, created_at, read_at';

router.get('/conversations/:id', (req, res) => {
  const { c, otherId } = loadConversation(req);
  const other = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(otherId);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const messages = db.prepare(`
    SELECT ${messageColumns} FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 50`)
    .all(c.id, before).reverse();
  res.json({ id: c.id, other: { ...other, online: isOnline(otherId) }, messages, has_more: messages.length === 50 });
});

router.post('/conversations/:id/messages', upload.single('file'), (req, res) => {
  let conv;
  let body;
  try {
    conv = loadConversation(req);
    ({ body } = parse(z.object({ body: z.string().trim().max(5000).optional() }), req.body));
    if (!body && !req.file) throw badRequest('الرسالة فارغة');
  } catch (err) {
    removeUpload(storedName(req.file));
    throw err;
  }
  const { c, otherId } = conv;
  const now = nowIso();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, body, file_path, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(c.id, req.user.id, body || null, storedName(req.file), req.file?.originalname ?? null, now);
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, c.id);
  const message = db.prepare(`SELECT ${messageColumns} FROM messages WHERE id = ?`).get(lastInsertRowid);

  emitTo([req.user.id, otherId], 'message:new', { ...message, sender_name: req.user.name });
  // Only raise a notification (and push) when the recipient isn't looking at the app right now.
  if (!isOnline(otherId)) {
    const prefix = ROLE_LABEL[req.user.role] ? `${ROLE_LABEL[req.user.role]} ` : '';
    notify(otherId, {
      type: 'message', title: `رسالة من ${prefix}${req.user.name}`,
      body: body ? body.slice(0, 140) : `📎 ${req.file.originalname}`, link: `/chat/${c.id}`,
    });
  }
  res.status(201).json(message);
});

router.post('/conversations/:id/read', (req, res) => {
  const { c, otherId } = loadConversation(req);
  const r = db.prepare('UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL')
    .run(nowIso(), c.id, req.user.id);
  if (r.changes) emitTo(otherId, 'message:read', { conversation_id: c.id });
  res.json({ ok: true });
});

export const messagesRouter = Router();
messagesRouter.get('/:id/file', (req, res) => {
  const m = db.prepare(`
    SELECT m.file_path, m.file_name, c.user1_id, c.user2_id FROM messages m
    JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?`).get(toId(req.params.id));
  if (!m || (m.user1_id !== req.user.id && m.user2_id !== req.user.id)) throw notFound();
  sendUpload(res, m.file_path, m.file_name);
});

export default router;

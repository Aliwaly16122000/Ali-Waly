import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { parse, toId } from '../lib/http.js';
import { VAPID_PUBLIC_KEY } from '../lib/notify.js';

const router = Router();

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
    .all(req.user.id, before, limit);
  const unread = db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0').pluck().get(req.user.id);
  res.json({ items, unread });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.json({ ok: true });
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(toId(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ───────────── Web Push ─────────────
router.get('/push/public-key', (_req, res) => res.json({ key: VAPID_PUBLIC_KEY }));

router.post('/push/subscribe', (req, res) => {
  const sub = parse(z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }), req.body);
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(req.user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  res.json({ ok: true });
});

router.post('/push/unsubscribe', (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().url() }), req.body);
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

export default router;

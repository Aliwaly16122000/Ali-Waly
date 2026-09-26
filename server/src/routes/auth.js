import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import db from '../db.js';
import { ah, parse, badRequest, HttpError } from '../lib/http.js';
import { COOKIE_NAME, requireAuth, setAuthCookie, signToken, publicUser, userFromToken } from '../lib/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، حاول مرة أخرى بعد قليل' },
});

router.post('/login', loginLimiter, ah(async (req, res) => {
  const { username, password } = parse(
    z.object({ username: z.string().trim().min(1), password: z.string().min(1) }),
    req.body,
  );
  const user = db.prepare(`
    SELECT u.*, d.name AS department_name FROM users u
    LEFT JOIN departments d ON d.id = u.department_id WHERE u.username = ?`).get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!user.is_active) throw new HttpError(403, 'هذا الحساب موقوف، تواصل مع إدارة الكلية');
  db.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user.id);
  setAuthCookie(res, signToken(user));
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = userFromToken(req.cookies?.[COOKIE_NAME]);
  res.json({ user: user ? publicUser(user) : null });
});

router.post('/change-password', requireAuth, ah(async (req, res) => {
  const { current_password, new_password } = parse(
    z.object({ current_password: z.string().min(1), new_password: z.string().min(6, 'كلمة المرور يجب ألا تقل عن 6 أحرف') }),
    req.body,
  );
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(current_password, row.password_hash))) throw badRequest('كلمة المرور الحالية غير صحيحة');
  if (current_password === new_password) throw badRequest('اختر كلمة مرور مختلفة عن الحالية');
  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
}));

router.put('/profile', requireAuth, ah(async (req, res) => {
  const data = parse(
    z.object({ email: z.string().trim().email().or(z.literal('')).optional(), phone: z.string().trim().max(30).optional() }),
    req.body,
  );
  db.prepare('UPDATE users SET email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?')
    .run(data.email ?? null, data.phone ?? null, req.user.id);
  res.json({ ok: true });
}));

export default router;

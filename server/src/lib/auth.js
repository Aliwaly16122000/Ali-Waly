import jwt from 'jsonwebtoken';
import db, { JWT_SECRET } from '../db.js';
import { HttpError } from './http.js';

export const COOKIE_NAME = 'engportal_token';
const TOKEN_TTL_DAYS = 14;

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure whenever the request arrived over HTTPS (directly or via a trusted proxy).
    secure: res.req.secure,
    maxAge: TOKEN_TTL_DAYS * 24 * 3600 * 1000,
  });
}

const loadUser = db.prepare(`
  SELECT u.id, u.name, u.username, u.email, u.phone, u.role, u.department_id, u.level,
         u.must_change_password, u.is_active, d.name AS department_name
  FROM users u LEFT JOIN departments d ON d.id = u.department_id
  WHERE u.id = ?`);

export function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = loadUser.get(payload.sub);
    return user && user.is_active ? user : null;
  } catch {
    return null;
  }
}

export function requireAuth(req, _res, next) {
  const user = userFromToken(req.cookies?.[COOKIE_NAME]);
  if (!user) return next(new HttpError(401, 'يجب تسجيل الدخول'));
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'غير مسموح لك بهذا الإجراء'));
  next();
};

export function publicUser(user) {
  const { password_hash, is_active, ...rest } = user;
  const scopes = db.prepare(`SELECT o.scope, o.scope_id, o.title,
      CASE o.scope WHEN 'department' THEN d.name WHEN 'faculty' THEN f.name ELSE 'الجامعة' END AS name
    FROM oversight o LEFT JOIN departments d ON o.scope = 'department' AND d.id = o.scope_id
    LEFT JOIN faculties f ON o.scope = 'faculty' AND f.id = o.scope_id WHERE o.user_id = ?`).all(rest.id);
  return { ...rest, must_change_password: !!rest.must_change_password, oversight: scopes };
}

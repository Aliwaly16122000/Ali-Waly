import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../db.js';
import { parse, badRequest, notFound, toId, HttpError } from '../lib/http.js';
import { courseAccess, courseStudentIds, courseStaffIds } from '../lib/access.js';
import { notify } from '../lib/notify.js';
import { emitTo } from '../lib/realtime.js';
import { nowIso } from '../lib/time.js';

/**
 * QR attendance. Each session has a secret; the QR shown on the projector encodes a
 * token derived from that secret and the current time window, so it rotates every few
 * seconds and a photo sent to an absent friend stops working almost immediately.
 */
const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest();
const windowOf = (session, t = Date.now()) => Math.floor(t / (session.rotate_seconds * 1000));

export function tokenFor(session, w = windowOf(session)) {
  const sig = hmac(session.secret, `${session.id}.${w}`).subarray(0, 12).toString('base64url');
  return `${session.id}.${w}.${sig}`;
}

/** Six digit code shown under the QR for students whose camera doesn't work. */
export function codeFor(session, w = windowOf(session)) {
  return String(hmac(session.secret, `code.${w}`).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

const isActive = (s) => !s.closed_at && new Date(s.closes_at) > new Date();
const validWindows = (s) => {
  const w = windowOf(s);
  return [w, w - 1]; // accept the previous window too, to tolerate scan latency
};

/** Mounted under /api/courses/:courseId/attendance */
export const courseAttendance = Router({ mergeParams: true });
const router = Router();

courseAttendance.get('/', (req, res) => {
  const courseId = toId(req.params.courseId);
  const { role } = courseAccess(req.user, courseId);
  const sessions = db.prepare(`
    SELECT s.id, s.title, s.started_at, s.closes_at, s.closed_at, s.rotate_seconds, u.name AS created_by_name,
      (SELECT COUNT(*) FROM attendance_records r WHERE r.session_id = s.id) AS present_count,
      (SELECT r.recorded_at FROM attendance_records r WHERE r.session_id = s.id AND r.student_id = ?) AS my_recorded_at
    FROM attendance_sessions s LEFT JOIN users u ON u.id = s.created_by
    WHERE s.course_id = ? ORDER BY s.started_at DESC`).all(req.user.id, courseId)
    .map((s) => ({ ...s, active: isActive(s) }));
  const studentsCount = db.prepare('SELECT COUNT(*) FROM enrollments WHERE course_id = ?').pluck().get(courseId);

  if (role === 'student') {
    const attended = sessions.filter((s) => s.my_recorded_at).length;
    return res.json({
      sessions: sessions.map(({ present_count, ...s }) => ({ ...s, present: !!s.my_recorded_at })),
      summary: { attended, total: sessions.length, rate: sessions.length ? Math.round((attended / sessions.length) * 1000) / 10 : null },
    });
  }
  res.json({ sessions: sessions.map(({ my_recorded_at, ...s }) => s), students_count: studentsCount });
});

/** Opens an attendance session and notifies the course's students. Returns the new session id. */
export function openAttendanceSession({ course, title, userId, durationMinutes = 15, rotateSeconds = 15, scheduleId = null }) {
  const closesAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO attendance_sessions (course_id, title, created_by, secret, rotate_seconds, started_at, closes_at, schedule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(course.id, title, userId, crypto.randomBytes(32).toString('hex'),
    rotateSeconds, nowIso(), closesAt, scheduleId);
  const sectionFilter = scheduleId && db.prepare('SELECT section FROM course_schedule WHERE id = ?').pluck().get(scheduleId);
  const students = sectionFilter
    ? db.prepare('SELECT student_id FROM enrollments WHERE course_id = ? AND section = ?').pluck().all(course.id, sectionFilter)
    : courseStudentIds(course.id);
  notify(students, {
    type: 'attendance', title: `تسجيل الحضور مفتوح - ${course.name}`, body: `${title} · امسح الـ QR من المدرج`, link: '/scan',
  });
  return Number(lastInsertRowid);
}

courseAttendance.post('/', (req, res) => {
  const courseId = toId(req.params.courseId);
  const { course } = courseAccess(req.user, courseId, ['doctor', 'ta']);
  const { title, duration_minutes, rotate_seconds } = parse(z.object({
    title: z.string().trim().min(2).max(200),
    duration_minutes: z.number().int().min(1).max(240).default(15),
    rotate_seconds: z.number().int().min(5).max(120).default(15),
  }), req.body);
  const id = openAttendanceSession({ course, title, userId: req.user.id, durationMinutes: duration_minutes, rotateSeconds: rotate_seconds });
  res.status(201).json({ id });
});

function loadSession(req, allowed) {
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(toId(req.params.id));
  if (!s) throw notFound('جلسة الحضور غير موجودة');
  const { course } = courseAccess(req.user, s.course_id, allowed);
  return { s, course };
}

router.get('/:id', (req, res) => {
  const { s, course } = loadSession(req, ['doctor', 'ta']);
  const students = db.prepare(`
    SELECT u.id, u.name, u.username, e.section, r.recorded_at, r.method
    FROM enrollments e JOIN users u ON u.id = e.student_id
    LEFT JOIN attendance_records r ON r.session_id = ? AND r.student_id = u.id
    WHERE e.course_id = ? ORDER BY r.recorded_at IS NULL, r.recorded_at DESC, u.name`).all(s.id, s.course_id);
  const { secret, ...session } = s;
  res.json({ ...session, active: isActive(s), course_name: course.name, course_code: course.code, students });
});

/** The rotating QR payload, polled by the lecturer's screen. */
router.get('/:id/token', (req, res) => {
  const { s } = loadSession(req, ['doctor', 'ta']);
  if (!isActive(s)) return res.json({ active: false });
  const w = windowOf(s);
  const periodMs = s.rotate_seconds * 1000;
  res.json({
    active: true,
    token: tokenFor(s, w),
    code: codeFor(s, w),
    expires_in_ms: (w + 1) * periodMs - Date.now(),
    rotate_seconds: s.rotate_seconds,
    closes_at: s.closes_at,
  });
});

router.post('/:id/close', (req, res) => {
  const { s } = loadSession(req, ['doctor', 'ta']);
  db.prepare('UPDATE attendance_sessions SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(nowIso(), s.id);
  res.json({ ok: true });
});

router.post('/:id/extend', (req, res) => {
  const { s } = loadSession(req, ['doctor', 'ta']);
  const { minutes } = parse(z.object({ minutes: z.number().int().min(1).max(120) }), req.body);
  const base = isActive(s) ? new Date(s.closes_at).getTime() : Date.now();
  db.prepare('UPDATE attendance_sessions SET closes_at = ?, closed_at = NULL WHERE id = ?')
    .run(new Date(base + minutes * 60_000).toISOString(), s.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { s } = loadSession(req, ['doctor']);
  db.prepare('DELETE FROM attendance_sessions WHERE id = ?').run(s.id);
  res.json({ ok: true });
});

/** Staff marks a student present/absent manually (e.g. phone died). */
router.put('/:id/records/:studentId', (req, res) => {
  const { s } = loadSession(req, ['doctor', 'ta']);
  const studentId = toId(req.params.studentId);
  const { present } = parse(z.object({ present: z.boolean() }), req.body);
  if (!courseStudentIds(s.course_id).includes(studentId)) throw badRequest('الطالب غير مسجل في المادة');
  if (present) {
    db.prepare("INSERT OR IGNORE INTO attendance_records (session_id, student_id, method, recorded_at) VALUES (?, ?, 'manual', ?)")
      .run(s.id, studentId, nowIso());
  } else {
    db.prepare('DELETE FROM attendance_records WHERE session_id = ? AND student_id = ?').run(s.id, studentId);
  }
  res.json({ ok: true });
});

function record(session, student, method) {
  const r = db.prepare('INSERT OR IGNORE INTO attendance_records (session_id, student_id, method, recorded_at) VALUES (?, ?, ?, ?)')
    .run(session.id, student.id, method, nowIso());
  if (r.changes) {
    const payload = { session_id: session.id, student: { id: student.id, name: student.name, username: student.username }, method, recorded_at: nowIso() };
    emitTo(courseStaffIds(session.course_id), 'attendance:new', payload);
  }
  return !!r.changes;
}

/** Student scans a QR (token) or types the 6-digit code. */
router.post('/scan', (req, res) => {
  if (req.user.role !== 'student') throw new HttpError(403, 'تسجيل الحضور متاح للطلاب فقط');
  const { token, code } = parse(z.object({
    token: z.string().trim().max(200).optional(),
    code: z.string().trim().regex(/^\d{6}$/, 'الكود يتكون من 6 أرقام').optional(),
  }).refine((v) => v.token || v.code, 'امسح الـ QR أو اكتب الكود'), req.body);

  let session = null;
  let method = 'qr';
  if (token) {
    // Accept both a raw token and a full URL (when scanned with the phone's native camera).
    const raw = token.includes('t=') ? new URL(token, 'http://x').searchParams.get('t') || '' : token;
    const [sid, w] = raw.split('.');
    const s = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(Number(sid));
    if (!s || !validWindows(s).includes(Number(w)) || tokenFor(s, Number(w)) !== raw) {
      throw badRequest('الـ QR منتهي الصلاحية، امسح الكود الظاهر حالياً على الشاشة');
    }
    session = s;
  } else {
    method = 'code';
    const candidates = db.prepare(`
      SELECT s.* FROM attendance_sessions s JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = ?
      WHERE s.closed_at IS NULL`).all(req.user.id).filter(isActive);
    session = candidates.find((s) => validWindows(s).some((w) => codeFor(s, w) === code));
    if (!session) throw badRequest('الكود غير صحيح أو انتهت صلاحيته');
  }

  if (!isActive(session)) throw badRequest('تم إغلاق تسجيل الحضور لهذه المحاضرة');
  const course = db.prepare('SELECT id, name, code FROM courses WHERE id = ?').get(session.course_id);
  if (!db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(session.course_id, req.user.id)) {
    throw badRequest(`أنت غير مسجل في مادة ${course.name}`);
  }
  const fresh = record(session, req.user, method);
  res.json({ ok: true, already: !fresh, course, session: { id: session.id, title: session.title } });
});

export default router;

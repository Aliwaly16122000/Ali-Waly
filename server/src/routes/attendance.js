import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../db.js';
import { assertCurrentTerm } from '../lib/term.js';
import { parse, badRequest, forbidden, notFound, toId, HttpError } from '../lib/http.js';
import { courseAccess, courseRole, courseStudentIds, courseStaffIds, READERS } from '../lib/access.js';
import { notify } from '../lib/notify.js';
import { emitTo } from '../lib/realtime.js';
import { nowIso } from '../lib/time.js';
import { localNow, toMinutes } from '../lib/clock.js';

/**
 * QR attendance. Each session has a secret; the QR shown on the projector encodes a
 * token derived from that secret and the current time window, so it rotates every few
 * seconds and a photo sent to an absent friend stops working almost immediately.
 */
const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest();
// rotate_seconds = 0 → a fixed QR/code for the whole session (window 0).
const windowOf = (session, t = Date.now()) => (session.rotate_seconds ? Math.floor(t / (session.rotate_seconds * 1000)) : 0);

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
    SELECT s.id, s.title, s.started_at, s.closes_at, s.closed_at, s.rotate_seconds, s.mode, s.created_by, u.name AS created_by_name,
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

/** The timetable slot running now for a course (from 30 min before it starts until it ends), if any. */
function currentSlot(courseId, userId) {
  const now = localNow();
  const slots = db.prepare('SELECT * FROM course_schedule WHERE course_id = ? AND day_of_week = ?').all(courseId, now.dow)
    .filter((s) => now.minutes >= toMinutes(s.start_time) - 30 && now.minutes <= toMinutes(s.end_time));
  // Parallel sections: prefer the one this person teaches.
  return slots.find((s) => s.staff_id === userId) ?? slots[0] ?? null;
}

/**
 * The session to reopen instead of starting another one for the same class: today's session
 * for this timetable slot, or — with no slot — one of this course opened in the last 3 hours.
 */
function sessionToReuse(courseId, scheduleId) {
  const today = localNow().date;
  const recent = db.prepare(`SELECT * FROM attendance_sessions WHERE course_id = ? AND started_at > ? ORDER BY id DESC`)
    .all(courseId, new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .filter((s) => localNow(new Date(s.started_at)).date === today);
  if (scheduleId) return recent.find((s) => s.schedule_id === scheduleId) ?? null;
  return recent.find((s) => Date.now() - new Date(s.started_at).getTime() < 3 * 3600 * 1000) ?? null;
}

/**
 * Opens attendance for a class and notifies its students. One class = one session: opening it
 * again (same timetable slot today, or within 3 hours when there's no slot) reopens the same
 * session instead of adding another lecture to the record. Returns { id, reused }.
 */
export function openAttendanceSession({ course, title, userId, durationMinutes = 15, rotateSeconds = 15, scheduleId = null, location = null }) {
  const slot = scheduleId ? db.prepare('SELECT * FROM course_schedule WHERE id = ?').get(scheduleId) : currentSlot(course.id, userId);
  const closesAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const existing = sessionToReuse(course.id, slot?.id ?? null);
  const mode = location ? 'location' : 'qr';
  const geo = [location?.lat ?? null, location?.lng ?? null, location?.accuracy ?? null, location?.radius ?? null];
  let id;
  if (existing) {
    const stillOpen = !existing.closed_at && existing.closes_at > nowIso();
    // Reopening keeps the session but takes the way of checking in chosen now.
    db.prepare(`UPDATE attendance_sessions SET closes_at = ?, closed_at = NULL, rotate_seconds = ?, mode = ?,
      geo_lat = ?, geo_lng = ?, geo_accuracy = ?, geo_radius = ? WHERE id = ?`)
      .run(stillOpen && existing.closes_at > closesAt ? existing.closes_at : closesAt, rotateSeconds, mode, ...geo, existing.id);
    id = existing.id;
  } else {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO attendance_sessions (course_id, title, created_by, secret, rotate_seconds, started_at, closes_at, schedule_id,
        mode, geo_lat, geo_lng, geo_accuracy, geo_radius)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(course.id, title, userId, crypto.randomBytes(32).toString('hex'),
      rotateSeconds, nowIso(), closesAt, slot?.id ?? null, mode, ...geo);
    id = Number(lastInsertRowid);
  }
  const students = slot?.section
    ? db.prepare('SELECT student_id FROM enrollments WHERE course_id = ? AND (section = ? OR section IS NULL)').pluck().all(course.id, slot.section)
    : courseStudentIds(course.id);
  const sessionTitle = existing?.title ?? title;
  notify(students, {
    type: 'attendance', title: `تسجيل الحضور مفتوح - ${course.name}`, link: '/scan',
    body: mode === 'location' ? `${sessionTitle} · افتح الإشعار وإنت في القاعة وحضورك هيتسجل بموقعك` : `${sessionTitle} · امسح الـ QR من المدرج`,
  });
  return { id, reused: !!existing };
}

courseAttendance.post('/', (req, res) => {
  const courseId = toId(req.params.courseId);
  const { course } = courseAccess(req.user, courseId, ['doctor', 'ta']);
  assertCurrentTerm(course);
  const { title, duration_minutes, rotate_seconds, mode, location, radius } = parse(z.object({
    title: z.string().trim().min(2).max(200),
    duration_minutes: z.number().int().min(1).max(240).default(15),
    // 0 = fixed QR
    rotate_seconds: z.number().int().min(0).max(120).refine((v) => v === 0 || v >= 5, 'مدة تغيير الكود غير صحيحة').default(15),
    mode: z.enum(['qr', 'location']).default('qr'),
    location: LOCATION.optional(),
    radius: z.number().int().min(10).max(1000).default(50),
  }).refine((v) => v.mode !== 'location' || v.location, 'لازم نحدد موقعك الأول عشان الطلبة القريبين منك يسجلوا'), req.body);
  if (mode === 'location' && location.accuracy > MAX_STAFF_ACCURACY) {
    throw badRequest(`دقة موقعك ضعيفة (حوالي ${Math.round(location.accuracy)} متر) — فعّل الـ GPS أو قرّب من شباك وحاول تاني`);
  }
  const { id, reused } = openAttendanceSession({
    course, title, userId: req.user.id, durationMinutes: duration_minutes, rotateSeconds: rotate_seconds,
    location: mode === 'location' ? { ...location, radius } : null,
  });
  res.status(reused ? 200 : 201).json({ id, reused });
});

const LOCATION = z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional(),
});
const MAX_STAFF_ACCURACY = 150;

function loadSession(req, allowed) {
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(toId(req.params.id));
  if (!s) throw notFound('جلسة الحضور غير موجودة');
  const { course } = courseAccess(req.user, s.course_id, allowed);
  return { s, course };
}

/** Location sessions open right now in the student's courses (the scan page checks them in straight away). */
router.get('/open', (req, res) => {
  if (req.user.role !== 'student') return res.json([]);
  const rows = db.prepare(`
    SELECT s.id, s.title, s.closes_at, s.closed_at, s.course_id, c.name AS course_name, c.code AS course_code,
      EXISTS (SELECT 1 FROM attendance_records r WHERE r.session_id = s.id AND r.student_id = e.student_id) AS present
    FROM attendance_sessions s JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = ?
    JOIN courses c ON c.id = s.course_id
    WHERE s.mode = 'location' AND s.closed_at IS NULL AND s.closes_at > ? ORDER BY s.started_at DESC`).all(req.user.id, nowIso());
  res.json(rows.map(({ closed_at, ...r }) => ({ ...r, present: !!r.present })));
});

router.get('/:id', (req, res) => {
  const { s, course } = loadSession(req, READERS);
  const students = db.prepare(`
    SELECT u.id, u.name, u.username, e.section, r.recorded_at, r.method, r.distance_m
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
  if (s.mode === 'location') return res.json({ active: true, mode: 'location', expires_in_ms: 10_000, closes_at: s.closes_at });
  const w = windowOf(s);
  const periodMs = s.rotate_seconds * 1000;
  res.json({
    active: true,
    mode: 'qr',
    token: tokenFor(s, w),
    code: codeFor(s, w),
    // A fixed QR never changes; the screen still re-checks every 30s to notice closing / extending.
    expires_in_ms: s.rotate_seconds ? (w + 1) * periodMs - Date.now() : 30_000,
    rotate_seconds: s.rotate_seconds,
    closes_at: s.closes_at,
  });
});

/** Lecturer re-pins the spot students are measured from (e.g. a better GPS fix inside the hall). */
router.put('/:id/location', (req, res) => {
  const { s } = loadSession(req, ['doctor', 'ta']);
  if (s.mode !== 'location') throw badRequest('المحاضرة دي بالـ QR مش بالموقع');
  const { location, radius } = parse(z.object({ location: LOCATION, radius: z.number().int().min(10).max(1000).optional() }), req.body);
  if (location.accuracy > MAX_STAFF_ACCURACY) throw badRequest(`دقة موقعك ضعيفة (حوالي ${Math.round(location.accuracy)} متر) — فعّل الـ GPS وحاول تاني`);
  db.prepare('UPDATE attendance_sessions SET geo_lat = ?, geo_lng = ?, geo_accuracy = ?, geo_radius = ? WHERE id = ?')
    .run(location.lat, location.lng, location.accuracy ?? null, radius ?? s.geo_radius, s.id);
  res.json({ ok: true });
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
  const { s } = loadSession(req, ['doctor', 'ta']);
  // A TA may delete only the sessions they opened themselves (e.g. a test); the doctor and admin any.
  if (courseRole(req.user, s.course_id) === 'ta' && s.created_by !== req.user.id) throw forbidden('المعيد يقدر يحذف المحاضرات اللي فتحها بنفسه بس');
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

const DEVICE_BINDING = process.env.DEVICE_BINDING !== '0';
const TICKET_TTL_MS = 90_000;

/** Great-circle distance in metres. */
function distanceMeters(a, b) {
  const R = 6371e3;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/*
 * When a course requires location, the first scan answers 428 with a short-lived ticket.
 * The phone then gets a GPS fix (which can take several seconds — longer than the QR
 * rotation) and resubmits with the ticket instead of the now-expired QR token.
 */
function makeTicket(session, studentId, method) {
  const exp = Date.now() + TICKET_TTL_MS;
  const body = `${session.id}.${studentId}.${method}.${exp}`;
  return `${body}.${hmac(session.secret, `ticket.${body}`).subarray(0, 12).toString('base64url')}`;
}

function readTicket(ticket, studentId) {
  const [sid, uid, method, exp, sig] = String(ticket).split('.');
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(Number(sid));
  const body = `${sid}.${uid}.${method}.${exp}`;
  if (!s || Number(uid) !== studentId || Number(exp) < Date.now()
    || hmac(s.secret, `ticket.${body}`).subarray(0, 12).toString('base64url') !== sig) {
    throw badRequest('انتهت مهلة تحديد الموقع، امسح الكود مرة أخرى');
  }
  return { session: s, method: method === 'code' ? 'code' : 'qr' };
}

function record(session, student, method, extra) {
  const r = db.prepare(`
    INSERT OR IGNORE INTO attendance_records (session_id, student_id, method, recorded_at, device_id, latitude, longitude, distance_m)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(session.id, student.id, method, nowIso(), extra.deviceId ?? null, extra.lat ?? null, extra.lng ?? null, extra.distance ?? null);
  if (r.changes) {
    const payload = { session_id: session.id, student: { id: student.id, name: student.name, username: student.username }, method, recorded_at: nowIso() };
    emitTo(courseStaffIds(session.course_id), 'attendance:new', payload);
  }
  return !!r.changes;
}

/**
 * Student scans a QR (token) or types the 6-digit code. Anti-cheating:
 *  - each student account is bound to the first phone it checks in from; other phones are
 *    refused until admin resets the binding, and one phone can't check in two students;
 *  - courses can require the phone to be within a radius of the lecture hall.
 */
router.post('/scan', (req, res) => {
  if (req.user.role !== 'student') throw new HttpError(403, 'تسجيل الحضور متاح للطلاب فقط');
  const body = parse(z.object({
    token: z.string().trim().max(300).optional(),
    code: z.string().trim().regex(/^\d{6}$/, 'الكود يتكون من 6 أرقام').optional(),
    ticket: z.string().trim().max(300).optional(),
    device_id: z.string().trim().min(16).max(100).optional(),
    device_label: z.string().trim().max(120).optional(),
    location: z.object({
      lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional(),
    }).optional(),
  }).refine((v) => v.token || v.code || v.ticket, 'امسح الـ QR أو اكتب الكود'), req.body);

  let session = null;
  let method = 'qr';
  if (body.ticket) {
    ({ session, method } = readTicket(body.ticket, req.user.id));
  } else if (body.token) {
    // Accept both a raw token and a full URL (when scanned with the phone's native camera).
    const raw = body.token.includes('t=') ? new URL(body.token, 'http://x').searchParams.get('t') || '' : body.token;
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
      WHERE s.closed_at IS NULL AND s.mode = 'qr'`).all(req.user.id).filter(isActive);
    session = candidates.find((s) => validWindows(s).some((w) => codeFor(s, w) === body.code));
    if (!session) throw badRequest('الكود غير صحيح أو انتهت صلاحيته');
  }

  if (!isActive(session)) throw badRequest('تم إغلاق تسجيل الحضور لهذه المحاضرة');
  if (session.mode === 'location') throw badRequest('المحاضرة دي الحضور فيها بالموقع — افتح صفحة تسجيل الحضور وإنت في القاعة');
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(session.course_id);
  const courseInfo = { id: course.id, name: course.name, code: course.code };
  if (!db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(session.course_id, req.user.id)) {
    throw badRequest(`أنت غير مسجل في مادة ${course.name}`);
  }
  const done = () => res.json({ ok: true, already: true, course: courseInfo, session: { id: session.id, title: session.title } });
  if (db.prepare('SELECT 1 FROM attendance_records WHERE session_id = ? AND student_id = ?').get(session.id, req.user.id)) return done();

  const bindNow = checkDevice(session, req.user, body.device_id);

  // ── Location (optional per course) ──
  let geo = {};
  if (course.geo_enabled && course.geo_lat !== null && course.geo_lng !== null) {
    if (!body.location) {
      throw new HttpError(428, 'المادة دي بتطلب تحديد موقعك داخل الكلية', { code: 'location_required', ticket: makeTicket(session, req.user.id, method) });
    }
    const { lat, lng, accuracy = 0 } = body.location;
    if (accuracy > 1000) throw badRequest('دقة الموقع ضعيفة جداً — فعّل الـ GPS (الموقع الدقيق) وحاول تاني');
    const distance = distanceMeters({ lat, lng }, { lat: course.geo_lat, lng: course.geo_lng });
    // Give the benefit of the doubt for GPS error indoors, capped so it can't be abused.
    if (distance - Math.min(accuracy, 150) > course.geo_radius) {
      throw new HttpError(403, `أنت بعيد عن ${course.geo_label || 'مكان المحاضرة'} (حوالي ${Math.round(distance)} متر). لازم تكون موجود عشان تسجل حضورك.`, { code: 'too_far', distance: Math.round(distance) });
    }
    geo = { lat, lng, distance: Math.round(distance) };
  }

  const fresh = record(session, req.user, method, { deviceId: body.device_id, ...geo });
  if (fresh && bindNow) bindDevice(req.user, body);
  res.json({ ok: true, already: !fresh, course: courseInfo, session: { id: session.id, title: session.title } });
});

/**
 * Each student account is bound to the first phone it checks in from; other phones are refused
 * until the admin resets it, and one phone can't check in two students. Returns whether to bind now.
 */
function checkDevice(session, user, deviceId) {
  if (!DEVICE_BINDING) return false;
  if (!deviceId) throw badRequest('حدّث الصفحة وحاول مرة أخرى', { code: 'device_required' });
  const bound = db.prepare('SELECT device_id FROM student_devices WHERE user_id = ?').pluck().get(user.id);
  if (bound && bound !== deviceId) {
    throw new HttpError(403, 'حسابك مربوط بموبايل تاني. سجّل الحضور من موبايلك، ولو غيّرته تواصل مع شؤون الطلاب لإعادة الربط.', { code: 'device_mismatch' });
  }
  const other = db.prepare('SELECT 1 FROM student_devices WHERE device_id = ? AND user_id != ?').get(deviceId, user.id);
  const usedInSession = db.prepare('SELECT 1 FROM attendance_records WHERE session_id = ? AND device_id = ? AND student_id != ?')
    .get(session.id, deviceId, user.id);
  if (other || usedInSession) {
    throw new HttpError(403, 'هذا الموبايل مسجّل لطالب آخر. كل طالب يسجل الحضور من موبايله فقط.', { code: 'device_used' });
  }
  return !bound;
}

const bindDevice = (user, body) => db.prepare('INSERT OR IGNORE INTO student_devices (user_id, device_id, label, bound_at) VALUES (?, ?, ?, ?)')
  .run(user.id, body.device_id, body.device_label || null, nowIso());

/**
 * Location check-in (no QR): the lecturer opened the session from their phone in the hall;
 * a student whose phone is within the radius of that spot is marked present.
 */
router.post('/:id/checkin', (req, res) => {
  if (req.user.role !== 'student') throw new HttpError(403, 'تسجيل الحضور متاح للطلاب فقط');
  const body = parse(z.object({
    device_id: z.string().trim().min(16).max(100).optional(),
    device_label: z.string().trim().max(120).optional(),
    location: LOCATION,
  }), req.body);
  const session = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(toId(req.params.id));
  if (!session) throw notFound('جلسة الحضور غير موجودة');
  const course = db.prepare('SELECT id, name, code FROM courses WHERE id = ?').get(session.course_id);
  if (!db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(session.course_id, req.user.id)) {
    throw badRequest(`أنت غير مسجل في مادة ${course.name}`);
  }
  if (session.mode !== 'location') throw badRequest('المحاضرة دي بالـ QR — امسح الكود اللي على الشاشة');
  if (!isActive(session)) throw badRequest('تم إغلاق تسجيل الحضور لهذه المحاضرة');
  const result = { ok: true, course, session: { id: session.id, title: session.title } };
  if (db.prepare('SELECT 1 FROM attendance_records WHERE session_id = ? AND student_id = ?').get(session.id, req.user.id)) {
    return res.json({ ...result, already: true });
  }
  const bindNow = checkDevice(session, req.user, body.device_id);

  const { lat, lng, accuracy = 0 } = body.location;
  if (accuracy > 500) throw badRequest('دقة الموقع ضعيفة جداً — فعّل الـ GPS (الموقع الدقيق) وحاول تاني', { code: 'weak_gps' });
  const distance = distanceMeters({ lat, lng }, { lat: session.geo_lat, lng: session.geo_lng });
  // Both phones' GPS error (indoors) counts in the student's favour, capped so it can't be stretched far.
  const slack = Math.min(accuracy, 100) + Math.min(session.geo_accuracy ?? 0, 50);
  if (distance - slack > session.geo_radius) {
    throw new HttpError(403, `إنت بعيد عن مكان المحاضرة (حوالي ${Math.round(distance)} متر). لازم تكون في القاعة عشان يتسجل حضورك.`, { code: 'too_far', distance: Math.round(distance) });
  }
  const fresh = record(session, req.user, 'location', { deviceId: body.device_id, lat, lng, distance: Math.round(distance) });
  if (fresh && bindNow) bindDevice(req.user, body);
  res.json({ ...result, already: !fresh });
});

export default router;

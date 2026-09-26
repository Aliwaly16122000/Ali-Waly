import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { parse, badRequest, notFound, toId } from '../lib/http.js';
import { courseAccess } from '../lib/access.js';
import { localNow, toMinutes } from '../lib/clock.js';
import { openAttendanceSession } from './attendance.js';

export const KIND_LABELS = { lecture: 'محاضرة', section: 'سكشن', lab: 'معمل' };
export const DAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const SLOT_COLUMNS = `
  s.*, c.name AS course_name, c.code AS course_code, u.name AS staff_name, u.role AS staff_role`;

const slotSchema = z.object({
  kind: z.enum(['lecture', 'section', 'lab']),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'وقت غير صالح'),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'وقت غير صالح'),
  location: z.string().trim().max(100).nullish(),
  section: z.string().trim().max(20).nullish(),
  staff_id: z.number().int().positive().nullish(),
  remind_before: z.number().int().min(0).max(24 * 60).default(30),
  attendance_mode: z.enum(['off', 'remind', 'auto']).default('remind'),
  attendance_offset: z.number().int().min(0).max(180).default(10),
  attendance_duration: z.number().int().min(1).max(180).default(15),
}).refine((s) => toMinutes(s.end_time) > toMinutes(s.start_time), { message: 'وقت النهاية يجب أن يكون بعد البداية', path: ['end_time'] });

function validateStaff(courseId, staffId) {
  if (!staffId) return;
  const ok = db.prepare('SELECT 1 FROM course_staff WHERE course_id = ? AND user_id = ?').get(courseId, staffId);
  if (!ok) throw badRequest('المسؤول يجب أن يكون من هيئة تدريس المادة');
}

/** Mounted under /api/courses/:courseId/schedule */
export const courseSchedule = Router({ mergeParams: true });

courseSchedule.get('/', (req, res) => {
  const courseId = toId(req.params.courseId);
  courseAccess(req.user, courseId);
  res.json(db.prepare(`
    SELECT ${SLOT_COLUMNS} FROM course_schedule s JOIN courses c ON c.id = s.course_id LEFT JOIN users u ON u.id = s.staff_id
    WHERE s.course_id = ? ORDER BY (s.day_of_week + 1) % 7, s.start_time`).all(courseId));
});

courseSchedule.post('/', (req, res) => {
  const courseId = toId(req.params.courseId);
  courseAccess(req.user, courseId, ['doctor', 'ta']);
  const s = parse(slotSchema, req.body);
  validateStaff(courseId, s.staff_id);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO course_schedule (course_id, kind, day_of_week, start_time, end_time, location, section, staff_id,
      remind_before, attendance_mode, attendance_offset, attendance_duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(courseId, s.kind, s.day_of_week, s.start_time, s.end_time,
    s.location || null, s.section || null, s.staff_id ?? null, s.remind_before, s.attendance_mode, s.attendance_offset, s.attendance_duration);
  res.status(201).json({ id: Number(lastInsertRowid) });
});

const router = Router();

function loadSlot(req, allowed = ['doctor', 'ta']) {
  const slot = db.prepare('SELECT * FROM course_schedule WHERE id = ?').get(toId(req.params.id));
  if (!slot) throw notFound('الموعد غير موجود');
  const { course, role } = courseAccess(req.user, slot.course_id, allowed);
  return { slot, course, role };
}

router.put('/:id', (req, res) => {
  const { slot } = loadSlot(req);
  const s = parse(slotSchema, req.body);
  validateStaff(slot.course_id, s.staff_id);
  db.prepare(`
    UPDATE course_schedule SET kind = ?, day_of_week = ?, start_time = ?, end_time = ?, location = ?, section = ?, staff_id = ?,
      remind_before = ?, attendance_mode = ?, attendance_offset = ?, attendance_duration = ? WHERE id = ?`)
    .run(s.kind, s.day_of_week, s.start_time, s.end_time, s.location || null, s.section || null, s.staff_id ?? null,
      s.remind_before, s.attendance_mode, s.attendance_offset, s.attendance_duration, slot.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { slot } = loadSlot(req);
  db.prepare('DELETE FROM course_schedule WHERE id = ?').run(slot.id);
  res.json({ ok: true });
});

/** The current user's weekly timetable across all their courses. */
router.get('/me', (req, res) => {
  const { user } = req;
  let rows;
  if (user.role === 'student') {
    rows = db.prepare(`
      SELECT ${SLOT_COLUMNS} FROM enrollments e JOIN course_schedule s ON s.course_id = e.course_id
      JOIN courses c ON c.id = s.course_id LEFT JOIN users u ON u.id = s.staff_id
      WHERE e.student_id = ? AND (s.section IS NULL OR s.section = e.section)`).all(user.id);
  } else if (user.role === 'admin') {
    rows = [];
  } else {
    // Doctors see their lectures; TAs see sections/labs. Anyone explicitly assigned sees the slot.
    rows = db.prepare(`
      SELECT ${SLOT_COLUMNS} FROM course_staff cs JOIN course_schedule s ON s.course_id = cs.course_id
      JOIN courses c ON c.id = s.course_id LEFT JOIN users u ON u.id = s.staff_id
      WHERE cs.user_id = ? AND (s.staff_id = cs.user_id OR (s.staff_id IS NULL AND
        ((cs.role = 'doctor' AND s.kind = 'lecture') OR (cs.role = 'ta' AND s.kind != 'lecture'))))`).all(user.id);
  }
  const now = localNow();
  rows.sort((a, b) => ((a.day_of_week + 1) % 7) - ((b.day_of_week + 1) % 7) || a.start_time.localeCompare(b.start_time));
  res.json({
    today: now.dow,
    now_minutes: now.minutes,
    slots: rows.map((s) => ({ ...s, is_today: s.day_of_week === now.dow })),
  });
});

/**
 * One tap from the reminder notification: opens attendance for this slot (or returns the
 * session already running for it today) so the lecturer lands straight on the QR screen.
 */
router.post('/:id/start-attendance', (req, res) => {
  const { slot, course } = loadSlot(req);
  const existing = db.prepare(`
    SELECT id FROM attendance_sessions WHERE schedule_id = ? AND closed_at IS NULL AND closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(slot.id, new Date().toISOString());
  if (existing) return res.json({ id: existing.id, existing: true });
  const id = openAttendanceSession({
    course, userId: req.user.id, scheduleId: slot.id, durationMinutes: slot.attendance_duration,
    title: slotTitle(slot),
  });
  res.status(201).json({ id });
});

export function slotTitle(slot) {
  const d = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Africa/Cairo' }).format(new Date());
  return `${KIND_LABELS[slot.kind]}${slot.section ? ` ${slot.section}` : ''} - ${d}`;
}

export default router;

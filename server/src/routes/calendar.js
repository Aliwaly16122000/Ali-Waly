import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { examsLock } from '../lib/visibility.js';
import { parse, badRequest, notFound, toId } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { notify } from '../lib/notify.js';
import { termFilter, termInfo, termDates, holidayFor } from '../lib/term.js';
import { KIND_LABELS } from './schedule.js';
import { EXAM_KINDS } from './exams.js';

const router = Router();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');
const EVENT_KINDS = { holiday: 'إجازة', exam: 'امتحانات', event: 'حدث' };

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** Term info for the header ("week 7 of 15"). */
router.get('/term', (_req, res) => res.json(termInfo()));

/** Events visible to this user: students see faculty-wide ones and those for their department/year. */
function eventsFor(user, from, to) {
  const rows = db.prepare(`
    SELECT e.*, d.name AS department_name FROM academic_events e LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.start_date <= ? AND e.end_date >= ? ORDER BY e.start_date`).all(to, from);
  if (user.role !== 'student') return rows;
  return rows.filter((e) => (e.department_id === null || e.department_id === user.department_id) && (e.level === null || e.level === user.level));
}

/**
 * Everything on the user's calendar between two dates: academic events, assessment
 * deadlines and the weekly timetable expanded into dated occurrences (skipping holidays
 * and days outside the term).
 */
router.get('/', (req, res) => {
  const { from, to } = parse(z.object({ from: DATE, to: DATE }), req.query);
  if (to < from || (new Date(to) - new Date(from)) / 86400000 > 62) throw badRequest('المدة المطلوبة كبيرة');
  const { user } = req;
  const tf = termFilter();
  const items = [];

  for (const e of eventsFor(user, from, to)) {
    items.push({ type: e.kind, id: `e${e.id}`, event_id: e.id, title: e.title, start: e.start_date, end: e.end_date,
      notes: e.notes, subtitle: [EVENT_KINDS[e.kind], e.department_name].filter(Boolean).join(' · ') });
  }

  const myCourses = user.role === 'student'
    ? db.prepare(`SELECT c.*, e.section AS my_section FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? AND ${tf.sql}`).all(user.id, ...tf.params)
    : user.role === 'admin'
      ? []
      : db.prepare(`SELECT c.*, cs.role AS my_role FROM course_staff cs JOIN courses c ON c.id = cs.course_id WHERE cs.user_id = ? AND ${tf.sql}`).all(user.id, ...tf.params);
  const ids = myCourses.map((c) => c.id);
  const byId = new Map(myCourses.map((c) => [c.id, c]));

  if (ids.length) {
    const qs = ids.map(() => '?').join(',');
    // Deadlines (due_at is UTC; compare on the calendar day of the ISO string, close enough for a month view).
    const due = db.prepare(`
      SELECT a.id, a.title, a.type, a.due_at, a.course_id FROM assessments a
      WHERE a.course_id IN (${qs}) AND a.due_at IS NOT NULL AND substr(a.due_at, 1, 10) BETWEEN ? AND ?`).all(...ids, addDays(from, -1), to);
    for (const a of due) {
      const c = byId.get(a.course_id);
      items.push({ type: 'deadline', id: `a${a.id}`, title: `تسليم ${a.title}`, subtitle: c.name, at: a.due_at, link: `/courses/${c.id}/assessments/${a.id}` });
    }

    const exams = db.prepare(`SELECT x.* FROM exams x WHERE x.course_id IN (${qs}) AND x.exam_date BETWEEN ? AND ?
      ${user.role === 'student' ? 'AND x.published = 1' : ''}`).all(...ids, from, to)
      .filter((x) => user.role !== 'student' || !examsLock(user.id, x.course_id));
    for (const x of exams) {
      const c = byId.get(x.course_id);
      items.push({ type: 'exam', id: `x${x.id}`, title: `امتحان ${EXAM_KINDS[x.kind]} ${c.name}`, date: x.exam_date,
        start_time: x.start_time, end_time: x.end_time, subtitle: x.location || '', link: '/exams' });
    }

    const slots = db.prepare(`
      SELECT s.*, u.name AS staff_name, u.role AS staff_role FROM course_schedule s LEFT JOIN users u ON u.id = s.staff_id
      WHERE s.course_id IN (${qs})`).all(...ids).filter((s) => {
      const c = byId.get(s.course_id);
      // A student without a section follows every group's slots.
      if (user.role === 'student') return !s.section || !c.my_section || s.section === c.my_section;
      if (s.staff_id) return s.staff_id === user.id;
      return c.my_role === 'doctor' ? s.kind === 'lecture' : s.kind !== 'lecture';
    });
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const s of slots.filter((x) => x.day_of_week === dow(d))) {
        const c = byId.get(s.course_id);
        const dates = termDates(c);
        if (dates && (d < dates.start_date || d > dates.end_date)) continue;
        const off = holidayFor(d, c);
        items.push({
          type: s.kind, id: `s${s.id}-${d}`, title: `${KIND_LABELS[s.kind]} ${c.name}`, date: d, start_time: s.start_time, end_time: s.end_time,
          subtitle: [s.section, s.location].filter(Boolean).join(' · '), link: `/courses/${c.id}`, cancelled: off ? off.title : null,
        });
      }
    }
  }
  res.json({ term: termInfo(), items });
});

// ───────────── Admin: academic events ─────────────
const eventSchema = z.object({
  title: z.string().trim().min(2, 'العنوان مطلوب').max(150),
  kind: z.enum(['holiday', 'exam', 'event']),
  start_date: DATE,
  end_date: DATE,
  department_id: z.number().int().positive().nullish(),
  level: z.number().int().min(0).max(5).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  notify: z.boolean().default(true),
}).refine((e) => e.end_date >= e.start_date, { message: 'تاريخ النهاية قبل البداية', path: ['end_date'] });

router.get('/events', requireRole('admin'), (req, res) => {
  res.json(db.prepare(`SELECT e.*, d.name AS department_name FROM academic_events e
    LEFT JOIN departments d ON d.id = e.department_id ORDER BY e.start_date DESC LIMIT 500`).all());
});

router.post('/events', requireRole('admin'), (req, res) => {
  const e = parse(eventSchema, req.body);
  const { lastInsertRowid } = db.prepare(`INSERT INTO academic_events (title, kind, start_date, end_date, department_id, level, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(e.title, e.kind, e.start_date, e.end_date, e.department_id ?? null, e.level ?? null, e.notes || null, req.user.id);
  if (e.notify) {
    const where = ["role IN ('student','ta','doctor')", 'is_active = 1'];
    const args = [];
    if (e.department_id) { where.push('department_id = ?'); args.push(e.department_id); }
    if (e.level !== null && e.level !== undefined) { where.push("(level = ? OR role != 'student')"); args.push(e.level); }
    const users = db.prepare(`SELECT id FROM users WHERE ${where.join(' AND ')}`).pluck().all(...args);
    const range = e.start_date === e.end_date ? e.start_date : `${e.start_date} ← ${e.end_date}`;
    notify(users, { type: e.kind === 'holiday' ? 'announcement' : 'schedule', title: `${e.kind === 'holiday' ? '🏖️' : e.kind === 'exam' ? '📝' : '📅'} ${e.title}`, body: range, link: '/calendar' });
  }
  res.status(201).json({ id: Number(lastInsertRowid) });
});

router.put('/events/:id', requireRole('admin'), (req, res) => {
  const e = parse(eventSchema, req.body);
  const r = db.prepare(`UPDATE academic_events SET title = ?, kind = ?, start_date = ?, end_date = ?, department_id = ?, level = ?, notes = ? WHERE id = ?`)
    .run(e.title, e.kind, e.start_date, e.end_date, e.department_id ?? null, e.level ?? null, e.notes || null, toId(req.params.id));
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

router.delete('/events/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM academic_events WHERE id = ?').run(toId(req.params.id));
  res.json({ ok: true });
});

export default router;

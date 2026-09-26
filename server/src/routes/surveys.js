import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { parse, badRequest, forbidden, notFound, toId } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { notify } from '../lib/notify.js';
import { courseRole } from '../lib/access.js';
import { termFilter } from '../lib/term.js';
import { round } from '../lib/stats.js';
import { nowIso } from '../lib/time.js';

const router = Router();

/** Ready-made course evaluation (admin can edit it). */
export const COURSE_EVALUATION = [
  { id: 'q1', type: 'rating', text: 'وضوح شرح المحاضرات', required: true },
  { id: 'q2', type: 'rating', text: 'استفادتك من السكاشن / المعامل', required: true },
  { id: 'q3', type: 'rating', text: 'مناسبة الشيتات والتكليفات للمحتوى', required: true },
  { id: 'q4', type: 'rating', text: 'التزام هيئة التدريس بالمواعيد', required: true },
  { id: 'q5', type: 'rating', text: 'عدالة التقييم والدرجات', required: true },
  { id: 'q6', type: 'choice', text: 'مستوى صعوبة المادة', options: ['سهلة', 'مناسبة', 'صعبة', 'صعبة جداً'], required: true },
  { id: 'q7', type: 'text', text: 'اقتراحات لتحسين المادة', required: false },
];

const questionSchema = z.object({
  id: z.string().trim().min(1).max(20),
  type: z.enum(['rating', 'choice', 'text']),
  text: z.string().trim().min(2, 'نص السؤال قصير').max(300),
  options: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  required: z.boolean().default(true),
}).refine((q) => q.type !== 'choice' || (q.options && q.options.length >= 2), 'سؤال الاختيار محتاج اختيارين على الأقل');

const surveySchema = z.object({
  title: z.string().trim().min(2, 'العنوان مطلوب').max(150),
  description: z.string().trim().max(1000).nullish(),
  questions: z.array(questionSchema).min(1, 'أضف سؤال واحد على الأقل').max(40),
  gate_grades: z.boolean().default(false),
  gate_exams: z.boolean().default(false),
  share_with_staff: z.boolean().default(true),
  // which courses: explicit ids, or every current-term course (optionally of one department / year)
  target: z.object({
    course_ids: z.array(z.number().int().positive()).optional(),
    department_id: z.number().int().positive().nullish(),
    level: z.number().int().min(0).max(5).nullish(),
  }).default({}),
});

function resolveCourses(target) {
  if (target.course_ids?.length) return target.course_ids;
  const tf = termFilter();
  const where = [tf.sql];
  const args = [...tf.params];
  if (target.department_id) { where.push('c.department_id = ?'); args.push(target.department_id); }
  if (target.level !== null && target.level !== undefined) { where.push('c.level = ?'); args.push(target.level); }
  return db.prepare(`SELECT c.id FROM courses c WHERE ${where.join(' AND ')}`).pluck().all(...args);
}

const hydrate = (s) => ({ ...s, questions: JSON.parse(s.questions), gate_grades: !!s.gate_grades, gate_exams: !!s.gate_exams, share_with_staff: !!s.share_with_staff });

/** A student's unanswered open surveys, one entry per course. */
export function pendingSurveys(studentId) {
  return db.prepare(`
    SELECT s.id, s.title, s.gate_grades, s.gate_exams, c.id AS course_id, c.name AS course_name, c.code AS course_code
    FROM surveys s JOIN survey_courses sc ON sc.survey_id = s.id
    JOIN enrollments e ON e.course_id = sc.course_id AND e.student_id = ? JOIN courses c ON c.id = sc.course_id
    WHERE s.status = 'open' AND NOT EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = s.id AND r.course_id = sc.course_id AND r.student_id = e.student_id)
    ORDER BY s.id, c.code`).all(studentId).map((r) => ({ ...r, gate_grades: !!r.gate_grades, gate_exams: !!r.gate_exams }));
}

router.get('/template', requireRole('admin'), (_req, res) => res.json(COURSE_EVALUATION));

// ───────────── Student ─────────────
router.get('/pending', (req, res) => res.json(req.user.role === 'student' ? pendingSurveys(req.user.id) : []));

router.get('/:id/form', (req, res) => {
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(toId(req.params.id));
  const courseId = toId(req.query.course_id);
  if (!s || !db.prepare('SELECT 1 FROM survey_courses WHERE survey_id = ? AND course_id = ?').get(s.id, courseId)) throw notFound('الاستبيان غير موجود');
  if (req.user.role === 'student' && !db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(courseId, req.user.id)) throw forbidden();
  const course = db.prepare('SELECT id, name, code FROM courses WHERE id = ?').get(courseId);
  const answered = !!db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? AND course_id = ? AND student_id = ?').get(s.id, courseId, req.user.id);
  const { created_by, ...survey } = hydrate(s);
  res.json({ ...survey, course, answered });
});

router.post('/:id/respond', (req, res) => {
  if (req.user.role !== 'student') throw forbidden();
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(toId(req.params.id));
  if (!s || s.status !== 'open') throw badRequest('الاستبيان مقفول');
  const { course_id, answers } = parse(z.object({ course_id: z.number().int().positive(), answers: z.record(z.string(), z.union([z.number(), z.string()])) }), req.body);
  if (!db.prepare('SELECT 1 FROM survey_courses WHERE survey_id = ? AND course_id = ?').get(s.id, course_id)) throw notFound();
  if (!db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(course_id, req.user.id)) throw forbidden();

  const clean = {};
  for (const q of JSON.parse(s.questions)) {
    const v = answers[q.id];
    const empty = v === undefined || v === null || v === '';
    if (empty) { if (q.required) throw badRequest(`جاوب على: ${q.text}`); continue; }
    if (q.type === 'rating' && !(Number.isInteger(Number(v)) && v >= 1 && v <= 5)) throw badRequest(`تقييم غير صالح: ${q.text}`);
    if (q.type === 'choice' && !q.options.includes(v)) throw badRequest(`اختيار غير صالح: ${q.text}`);
    clean[q.id] = q.type === 'rating' ? Number(v) : String(v).slice(0, 2000);
  }
  const r = db.prepare('INSERT OR IGNORE INTO survey_responses (survey_id, course_id, student_id, answers, submitted_at) VALUES (?, ?, ?, ?, ?)')
    .run(s.id, course_id, req.user.id, JSON.stringify(clean), nowIso());
  res.json({ ok: true, already: !r.changes });
});

// ───────────── Admin ─────────────
router.get('/', requireRole('admin'), (_req, res) => {
  res.json(db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM survey_courses sc WHERE sc.survey_id = s.id) AS courses,
      (SELECT COUNT(*) FROM survey_courses sc JOIN enrollments e ON e.course_id = sc.course_id WHERE sc.survey_id = s.id) AS expected,
      (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS responses
    FROM surveys s ORDER BY s.id DESC`).all().map(hydrate));
});

router.post('/', requireRole('admin'), (req, res) => {
  const s = parse(surveySchema, req.body);
  const courses = resolveCourses(s.target);
  if (!courses.length) throw badRequest('مفيش مواد مطابقة في الترم الحالي');
  const id = db.transaction(() => {
    const newId = Number(db.prepare(`INSERT INTO surveys (title, description, questions, gate_grades, gate_exams, share_with_staff, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(s.title, s.description || null, JSON.stringify(s.questions), Number(s.gate_grades), Number(s.gate_exams),
      Number(s.share_with_staff), req.user.id).lastInsertRowid);
    const ins = db.prepare('INSERT OR IGNORE INTO survey_courses (survey_id, course_id) VALUES (?, ?)');
    courses.forEach((c) => ins.run(newId, c));
    return newId;
  })();
  res.status(201).json({ id, courses: courses.length });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const s = parse(surveySchema.omit({ target: true }), req.body);
  const current = db.prepare('SELECT * FROM surveys WHERE id = ?').get(toId(req.params.id));
  if (!current) throw notFound();
  const hasAnswers = db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? LIMIT 1').get(current.id);
  if (hasAnswers && JSON.stringify(s.questions) !== current.questions) throw badRequest('لا يمكن تعديل الأسئلة بعد وصول ردود');
  db.prepare('UPDATE surveys SET title = ?, description = ?, questions = ?, gate_grades = ?, gate_exams = ?, share_with_staff = ? WHERE id = ?')
    .run(s.title, s.description || null, JSON.stringify(s.questions), Number(s.gate_grades), Number(s.gate_exams), Number(s.share_with_staff), current.id);
  res.json({ ok: true });
});

router.post('/:id/status', requireRole('admin'), (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['draft', 'open', 'closed']) }), req.body);
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(toId(req.params.id));
  if (!s) throw notFound();
  db.prepare('UPDATE surveys SET status = ? WHERE id = ?').run(status, s.id);
  if (status === 'open' && s.status !== 'open') {
    const students = db.prepare(`SELECT DISTINCT e.student_id FROM survey_courses sc JOIN enrollments e ON e.course_id = sc.course_id WHERE sc.survey_id = ?`).pluck().all(s.id);
    const gate = [s.gate_grades && 'الدرجات', s.gate_exams && 'جدول الامتحانات'].filter(Boolean).join(' و');
    notify(students, { type: 'announcement', title: `📋 ${s.title}`, body: gate ? `املأ الاستبيان لكل مادة عشان تشوف ${gate}` : 'رأيك يهمنا — املأ الاستبيان', link: '/surveys' });
  }
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM surveys WHERE id = ?').run(toId(req.params.id));
  res.json({ ok: true });
});

/**
 * Aggregated, anonymous results. Admin sees all courses; a course's doctor/TA sees their
 * own course when the survey is shared with staff; leadership sees courses they oversee.
 */
router.get('/:id/results', (req, res) => {
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(toId(req.params.id));
  if (!s) throw notFound();
  const courseId = req.query.course_id ? toId(req.query.course_id) : null;
  if (req.user.role !== 'admin') {
    const role = courseId && courseRole(req.user, courseId);
    const ok = role === 'observer' || ((role === 'doctor' || role === 'ta') && s.share_with_staff);
    if (!ok) throw forbidden();
  }
  const questions = JSON.parse(s.questions);
  const where = courseId ? 'survey_id = ? AND course_id = ?' : 'survey_id = ?';
  const args = courseId ? [s.id, courseId] : [s.id];
  const answers = db.prepare(`SELECT answers FROM survey_responses WHERE ${where}`).pluck().all(...args).map((a) => JSON.parse(a));
  const expected = courseId
    ? db.prepare('SELECT COUNT(*) FROM enrollments WHERE course_id = ?').pluck().get(courseId)
    : db.prepare('SELECT COUNT(*) FROM survey_courses sc JOIN enrollments e ON e.course_id = sc.course_id WHERE sc.survey_id = ?').pluck().get(s.id);

  const results = questions.map((q) => {
    const vals = answers.map((a) => a[q.id]).filter((v) => v !== undefined);
    if (q.type === 'rating') {
      const dist = [1, 2, 3, 4, 5].map((n) => ({ value: n, count: vals.filter((v) => v === n).length }));
      return { ...q, count: vals.length, mean: vals.length ? round(vals.reduce((x, y) => x + y, 0) / vals.length, 2) : null, distribution: dist };
    }
    if (q.type === 'choice') return { ...q, count: vals.length, distribution: q.options.map((o) => ({ value: o, count: vals.filter((v) => v === o).length })) };
    return { ...q, count: vals.length, texts: vals.slice(0, 300) };
  });

  const perCourse = courseId ? [] : db.prepare(`
    SELECT c.id, c.code, c.name, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS expected,
      (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = sc.survey_id AND r.course_id = c.id) AS responses
    FROM survey_courses sc JOIN courses c ON c.id = sc.course_id WHERE sc.survey_id = ? ORDER BY c.code`).all(s.id);

  res.json({ survey: hydrate(s), responses: answers.length, expected, results, courses: perCourse });
});

/** Surveys attached to a course (for its staff/leadership to open the results). */
router.get('/course/:courseId', (req, res) => {
  const courseId = toId(req.params.courseId);
  const role = courseRole(req.user, courseId);
  if (!role || role === 'student') throw forbidden();
  res.json(db.prepare(`SELECT s.id, s.title, s.status, s.share_with_staff,
      (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id AND r.course_id = ?) AS responses
    FROM surveys s JOIN survey_courses sc ON sc.survey_id = s.id WHERE sc.course_id = ? AND s.status != 'draft'`).all(courseId, courseId)
    .filter((s) => role === 'admin' || role === 'observer' || s.share_with_staff));
});

export default router;

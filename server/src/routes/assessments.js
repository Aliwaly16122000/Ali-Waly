import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { ah, parse, badRequest, forbidden, notFound, toId } from '../lib/http.js';
import { courseAccess, courseStudentIds, courseStaffIds } from '../lib/access.js';
import { upload, storedName, removeUpload, sendUpload } from '../lib/upload.js';
import { notify } from '../lib/notify.js';
import { nowIso } from '../lib/time.js';

export const TYPE_LABELS = {
  sheet: 'شيت', quiz: 'كويز', midterm: 'ميدترم', lab: 'معمل', project: 'مشروع', final: 'فاينال', other: 'تقييم',
};

/** Routes mounted under /api/courses/:courseId/assessments */
export const courseAssessments = Router({ mergeParams: true });
/** Routes mounted under /api/assessments */
const router = Router();

const withUploadCleanup = (req, fn) => {
  try {
    return fn();
  } catch (err) {
    removeUpload(storedName(req.file));
    throw err;
  }
};

courseAssessments.get('/', (req, res) => {
  const courseId = toId(req.params.courseId);
  const { role } = courseAccess(req.user, courseId);

  if (role === 'student') {
    const rows = db.prepare(`
      SELECT a.id, a.course_id, a.title, a.type, a.description, a.max_score, a.due_at, a.accepts_submissions,
             a.attachment_name, a.status, a.created_at, a.published_at,
             s.id AS submission_id, s.file_name, s.submitted_at, s.note,
             CASE WHEN a.status = 'published' THEN s.score END AS score,
             CASE WHEN a.status = 'published' THEN s.feedback END AS feedback
      FROM assessments a
      LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = ?
      WHERE a.course_id = ? ORDER BY COALESCE(a.due_at, a.created_at) DESC`).all(req.user.id, courseId);
    return res.json(rows);
  }

  res.json(db.prepare(`
    SELECT a.*, u.name AS created_by_name, sb.name AS submitted_by_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = a.course_id) AS students_count,
      (SELECT COUNT(*) FROM submissions s WHERE s.assessment_id = a.id AND s.submitted_at IS NOT NULL) AS submitted_count,
      (SELECT COUNT(*) FROM submissions s WHERE s.assessment_id = a.id AND s.score IS NOT NULL) AS graded_count,
      (SELECT AVG(s.score) FROM submissions s WHERE s.assessment_id = a.id AND s.score IS NOT NULL) AS avg_score
    FROM assessments a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN users sb ON sb.id = a.submitted_by
    WHERE a.course_id = ? ORDER BY COALESCE(a.due_at, a.created_at) DESC`).all(courseId)
    .map(({ attachment_path, ...a }) => a));
});

const assessmentSchema = z.object({
  title: z.string().trim().min(2, 'العنوان مطلوب').max(200),
  type: z.enum(Object.keys(TYPE_LABELS)).default('sheet'),
  description: z.string().trim().max(10000).optional(),
  max_score: z.coerce.number().positive('الدرجة العظمى يجب أن تكون أكبر من صفر').max(1000),
  due_at: z.string().datetime({ offset: true }).optional().or(z.literal('')),
  accepts_submissions: z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 1, z.boolean()).default(true),
});

courseAssessments.post('/', upload.single('attachment'), (req, res) => {
  const courseId = toId(req.params.courseId);
  const { a, course } = withUploadCleanup(req, () => {
    const { course } = courseAccess(req.user, courseId, ['doctor', 'ta']);
    return { a: parse(assessmentSchema, req.body), course };
  });
  const dueAt = a.due_at ? new Date(a.due_at).toISOString() : null;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO assessments (course_id, title, type, description, max_score, due_at, accepts_submissions,
                             attachment_path, attachment_name, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(courseId, a.title, a.type, a.description || null, a.max_score, dueAt,
    Number(a.accepts_submissions), storedName(req.file), req.file?.originalname ?? null, req.user.id);
  const id = Number(lastInsertRowid);

  const due = dueAt ? ` - التسليم حتى ${new Date(dueAt).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })}` : '';
  notify(courseStudentIds(courseId), {
    type: 'assessment',
    title: `${TYPE_LABELS[a.type]} جديد في ${course.name}`,
    body: `${a.title}${due}`,
    link: `/courses/${courseId}/assessments/${id}`,
  });
  res.status(201).json({ id });
});

function loadAssessment(req, allowed) {
  const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(toId(req.params.id));
  if (!a) throw notFound('التقييم غير موجود');
  const { course, role } = courseAccess(req.user, a.course_id, allowed);
  return { a, course, role };
}

router.get('/:id', (req, res) => {
  const { a, course, role } = loadAssessment(req);
  const { attachment_path, ...assessment } = a;
  const base = { ...assessment, course_name: course.name, course_code: course.code, my_role: role };

  if (role === 'student') {
    const s = db.prepare('SELECT * FROM submissions WHERE assessment_id = ? AND student_id = ?').get(a.id, req.user.id);
    const visible = a.status === 'published';
    return res.json({
      ...base,
      review_note: undefined,
      submission: s ? {
        id: s.id, file_name: s.file_name, file_size: s.file_size, note: s.note, submitted_at: s.submitted_at,
        score: visible ? s.score : null, feedback: visible ? s.feedback : null, graded: s.score !== null,
      } : null,
    });
  }

  const roster = db.prepare(`
    SELECT u.id AS student_id, u.name, u.username, e.section,
           s.id AS submission_id, s.file_name, s.file_size, s.note, s.submitted_at, s.score, s.feedback, s.graded_at,
           g.name AS graded_by_name
    FROM enrollments e JOIN users u ON u.id = e.student_id
    LEFT JOIN submissions s ON s.assessment_id = ? AND s.student_id = u.id
    LEFT JOIN users g ON g.id = s.graded_by
    WHERE e.course_id = ? ORDER BY e.section, u.name`).all(a.id, a.course_id);
  res.json({ ...base, roster });
});

router.put('/:id', upload.single('attachment'), (req, res) => {
  const { a: current, data } = withUploadCleanup(req, () => {
    const { a } = loadAssessment(req, ['doctor', 'ta']);
    return { a, data: parse(assessmentSchema, req.body) };
  });
  const dueAt = data.due_at ? new Date(data.due_at).toISOString() : null;
  db.prepare(`
    UPDATE assessments SET title = ?, type = ?, description = ?, max_score = ?, due_at = ?, accepts_submissions = ?,
      attachment_path = COALESCE(?, attachment_path), attachment_name = COALESCE(?, attachment_name)
    WHERE id = ?`).run(data.title, data.type, data.description || null, data.max_score, dueAt,
    Number(data.accepts_submissions), storedName(req.file), req.file?.originalname ?? null, current.id);
  if (req.file) removeUpload(current.attachment_path);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { a, role } = loadAssessment(req, ['doctor', 'ta']);
  if (role === 'ta' && a.status !== 'open') throw forbidden('لا يمكن حذف تقييم تم رفعه للدكتور');
  const files = db.prepare('SELECT file_path FROM submissions WHERE assessment_id = ?').pluck().all(a.id);
  db.prepare('DELETE FROM assessments WHERE id = ?').run(a.id);
  [a.attachment_path, ...files].forEach(removeUpload);
  res.json({ ok: true });
});

router.get('/:id/attachment', (req, res) => {
  const { a } = loadAssessment(req);
  sendUpload(res, a.attachment_path, a.attachment_name);
});

// ───────────── Student submission ─────────────
router.post('/:id/submit', upload.single('file'), (req, res) => {
  const { a, course, note } = withUploadCleanup(req, () => {
    const { a, course } = loadAssessment(req, ['student']);
    if (!a.accepts_submissions) throw badRequest('هذا التقييم لا يستقبل تسليمات إلكترونية');
    if (a.status !== 'open') throw badRequest('انتهى التسليم لهذا التقييم');
    if (!req.file) throw badRequest('يجب إرفاق ملف الحل');
    const existing = db.prepare('SELECT score FROM submissions WHERE assessment_id = ? AND student_id = ?').get(a.id, req.user.id);
    if (existing && existing.score !== null) throw badRequest('تم تصحيح تسليمك بالفعل ولا يمكن تعديله');
    const { note } = parse(z.object({ note: z.string().trim().max(2000).optional() }), req.body);
    return { a, course, note };
  });

  const previous = db.prepare('SELECT file_path FROM submissions WHERE assessment_id = ? AND student_id = ?').pluck().get(a.id, req.user.id);
  db.prepare(`
    INSERT INTO submissions (assessment_id, student_id, file_path, file_name, file_size, note, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (assessment_id, student_id) DO UPDATE SET
      file_path = excluded.file_path, file_name = excluded.file_name, file_size = excluded.file_size,
      note = excluded.note, submitted_at = excluded.submitted_at`)
    .run(a.id, req.user.id, storedName(req.file), req.file.originalname, req.file.size, note || null, nowIso());
  if (previous) removeUpload(previous);

  notify(courseStaffIds(a.course_id, 'ta'), {
    type: 'submission',
    title: `تسليم جديد - ${course.name}`,
    body: `${req.user.name} سلّم ${a.title}`,
    link: `/courses/${a.course_id}/assessments/${a.id}`,
  });
  res.json({ ok: true, late: !!(a.due_at && new Date() > new Date(a.due_at)) });
});

export const submissionsRouter = Router();
submissionsRouter.get('/:id/file', (req, res) => {
  const s = db.prepare(`SELECT s.*, a.course_id FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE s.id = ?`)
    .get(toId(req.params.id));
  if (!s) throw notFound();
  const { role } = courseAccess(req.user, s.course_id);
  if (role === 'student' && s.student_id !== req.user.id) throw forbidden();
  sendUpload(res, s.file_path, s.file_name);
});

// ───────────── Grading workflow ─────────────
/**
 * Saves scores for one or more students. TAs may grade only while the assessment is
 * open; doctors can adjust grades at any stage.
 */
router.put('/:id/grades', (req, res) => {
  const { a, role } = loadAssessment(req, ['doctor', 'ta']);
  if (role === 'ta' && a.status !== 'open') throw forbidden('تم رفع الدرجات للدكتور، لا يمكن التعديل إلا بعد إرجاعها');
  const { grades } = parse(z.object({
    grades: z.array(z.object({
      student_id: z.number().int().positive(),
      score: z.number().min(0).nullable(),
      feedback: z.string().trim().max(5000).nullish(),
    })).min(1),
  }), req.body);

  const enrolled = new Set(courseStudentIds(a.course_id));
  for (const g of grades) {
    if (!enrolled.has(g.student_id)) throw badRequest('طالب غير مسجل في المادة');
    if (g.score !== null && g.score > a.max_score) throw badRequest(`الدرجة لا يمكن أن تتجاوز ${a.max_score}`);
  }
  const upsert = db.prepare(`
    INSERT INTO submissions (assessment_id, student_id, score, feedback, graded_by, graded_at)
    VALUES (@assessment_id, @student_id, @score, @feedback, @graded_by, @graded_at)
    ON CONFLICT (assessment_id, student_id) DO UPDATE SET
      score = excluded.score, feedback = excluded.feedback, graded_by = excluded.graded_by, graded_at = excluded.graded_at`);
  const now = nowIso();
  db.transaction(() => grades.forEach((g) => upsert.run({
    assessment_id: a.id, student_id: g.student_id, score: g.score, feedback: g.feedback || null,
    graded_by: g.score === null ? null : req.user.id, graded_at: g.score === null ? null : now,
  })))();
  res.json({ ok: true, saved: grades.length });
});

/** TA finishes grading and hands the sheet to the course doctor(s). */
router.post('/:id/submit-to-doctor', (req, res) => {
  const { a, course } = loadAssessment(req, ['doctor', 'ta']);
  if (a.status !== 'open') throw badRequest('تم رفع الدرجات بالفعل');
  const graded = db.prepare('SELECT COUNT(*) FROM submissions WHERE assessment_id = ? AND score IS NOT NULL').pluck().get(a.id);
  if (!graded) throw badRequest('لم يتم رصد أي درجات بعد');
  db.prepare("UPDATE assessments SET status = 'submitted', submitted_by = ?, submitted_at = ?, review_note = NULL WHERE id = ?")
    .run(req.user.id, nowIso(), a.id);
  notify(courseStaffIds(a.course_id, 'doctor').filter((id) => id !== req.user.id), {
    type: 'grades_submitted',
    title: `درجات بانتظار اعتمادك - ${course.name}`,
    body: `${req.user.name} رفع درجات ${a.title}`,
    link: `/courses/${a.course_id}/assessments/${a.id}`,
  });
  res.json({ ok: true });
});

/** Doctor approves and releases grades to students. */
router.post('/:id/publish', (req, res) => {
  const { a, course } = loadAssessment(req, ['doctor']);
  if (a.status === 'published') throw badRequest('الدرجات منشورة بالفعل');
  db.prepare("UPDATE assessments SET status = 'published', published_at = ? WHERE id = ?").run(nowIso(), a.id);
  notify(courseStudentIds(a.course_id), {
    type: 'grades_published',
    title: `نزلت درجات ${a.title}`,
    body: course.name,
    link: `/courses/${a.course_id}/assessments/${a.id}`,
  });
  notify(courseStaffIds(a.course_id, 'ta'), {
    type: 'grades_published', title: `تم اعتماد درجات ${a.title}`, body: course.name,
    link: `/courses/${a.course_id}/assessments/${a.id}`,
  });
  res.json({ ok: true });
});

/** Doctor sends grades back to the TAs for revision (or hides published grades). */
router.post('/:id/return', (req, res) => {
  const { a, course } = loadAssessment(req, ['doctor']);
  const { note } = parse(z.object({ note: z.string().trim().max(2000).optional() }), req.body);
  if (a.status === 'open') throw badRequest('التقييم مفتوح بالفعل');
  db.prepare("UPDATE assessments SET status = 'open', review_note = ?, published_at = NULL WHERE id = ?").run(note || null, a.id);
  notify(courseStaffIds(a.course_id, 'ta'), {
    type: 'grades_returned',
    title: `تمت إعادة درجات ${a.title} للمراجعة`,
    body: note ? `${course.name}: ${note}` : course.name,
    link: `/courses/${a.course_id}/assessments/${a.id}`,
  });
  res.json({ ok: true });
});

export default router;

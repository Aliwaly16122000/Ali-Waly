import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { gradesLock } from '../lib/visibility.js';
import { ACCEPTING_SQL } from './assessments.js';
import { isArchived, listTerms, termFilter, termInfo } from '../lib/term.js';
import { ah, parse, notFound, forbidden, toId } from '../lib/http.js';
import { courseAccess, courseStudentIds, courseStaffIds, READERS } from '../lib/access.js';
import { uploadMany, MAX_FILES } from '../lib/upload.js';
import { attachmentsFor, discardUploads, removeAttachments, saveAttachments } from '../lib/attachments.js';
import { notify } from '../lib/notify.js';

const router = Router();

const COURSE_COLUMNS = `
  c.*, d.name AS department_name,
  (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
  (SELECT json_group_array(json_object('id', u.id, 'name', u.name, 'role', cs.role))
     FROM course_staff cs JOIN users u ON u.id = cs.user_id WHERE cs.course_id = c.id) AS staff`;

const hydrate = (c) => ({ ...c, staff: JSON.parse(c.staff || '[]') });

/** Courses relevant to the current user: enrolled (student), assigned (staff) or all (admin). */
router.get('/', (req, res) => {
  const { user } = req;
  // ?term=current (default) | all | 2026/2027-fall
  const t = req.query.term || 'current';
  let tf = { sql: '1 = 1', params: [] };
  if (t === 'current') tf = termFilter();
  else if (t !== 'all') {
    const [year, semester] = String(t).split('-');
    tf = { sql: 'c.academic_year = ? AND c.semester = ?', params: [year, semester] };
  }
  let rows;
  if (user.role === 'admin') {
    rows = db.prepare(`SELECT ${COURSE_COLUMNS}, 'admin' AS my_role FROM courses c
      LEFT JOIN departments d ON d.id = c.department_id WHERE ${tf.sql} ORDER BY c.academic_year DESC, c.code`).all(...tf.params);
  } else if (user.role === 'student') {
    rows = db.prepare(`
      SELECT ${COURSE_COLUMNS}, 'student' AS my_role, e.section,
        (SELECT COUNT(*) FROM assessments a WHERE a.course_id = c.id AND ${ACCEPTING_SQL}
           AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assessment_id = a.id AND s.student_id = e.student_id
                           AND (s.submitted_at IS NOT NULL OR s.score IS NOT NULL))) AS pending_count,
        (SELECT SUM(s.score) FROM submissions s JOIN assessments a ON a.id = s.assessment_id
           WHERE a.course_id = c.id AND a.status = 'published' AND s.student_id = e.student_id) AS my_total,
        (SELECT SUM(a.max_score) FROM assessments a WHERE a.course_id = c.id AND a.status = 'published') AS published_max
      FROM enrollments e JOIN courses c ON c.id = e.course_id LEFT JOIN departments d ON d.id = c.department_id
      WHERE e.student_id = ? AND ${tf.sql} ORDER BY c.academic_year DESC, c.code`).all(user.id, ...tf.params);
  } else {
    rows = db.prepare(`
      SELECT ${COURSE_COLUMNS}, cs.role AS my_role,
        (SELECT COUNT(*) FROM submissions s JOIN assessments a ON a.id = s.assessment_id
           WHERE a.course_id = c.id AND a.status = 'open' AND s.submitted_at IS NOT NULL AND s.score IS NULL) AS to_grade_count,
        (SELECT COUNT(*) FROM assessments a WHERE a.course_id = c.id AND a.status = 'submitted') AS awaiting_approval_count
      FROM course_staff cs JOIN courses c ON c.id = cs.course_id LEFT JOIN departments d ON d.id = c.department_id
      WHERE cs.user_id = ? AND ${tf.sql} ORDER BY c.academic_year DESC, c.code`).all(user.id, ...tf.params);
  }
  res.json(rows.map((c) => {
    const lock = user.role === 'student' ? gradesLock(user.id, c) : null;
    return { ...hydrate(c), archived: isArchived(c), ...(lock ? { my_total: null, published_max: null, grades_lock: lock } : {}) };
  }));
});

/** Current term + the terms this user has courses in (for the archive switcher). */
router.get('/terms', (req, res) => {
  res.json({ current: termInfo(), terms: listTerms() });
});

router.get('/:id', (req, res) => {
  const id = toId(req.params.id);
  const { role } = courseAccess(req.user, id);
  const course = db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses c LEFT JOIN departments d ON d.id = c.department_id WHERE c.id = ?`).get(id);
  let mySection = null;
  let sectionStaff = [];
  if (role === 'student') {
    // "Your section's TA": whoever runs the timetable slots of the student's own section.
    mySection = db.prepare('SELECT section FROM enrollments WHERE course_id = ? AND student_id = ?').pluck().get(id, req.user.id);
    if (mySection) {
      sectionStaff = db.prepare(`SELECT DISTINCT u.id, u.name, u.role, s.kind FROM course_schedule s JOIN users u ON u.id = s.staff_id
        WHERE s.course_id = ? AND s.section = ?`).all(id, mySection);
    }
  }
  res.json({
    ...hydrate(course), my_role: role, archived: isArchived(course), my_section: mySection, section_staff: sectionStaff,
    grades_lock: role === 'student' ? gradesLock(req.user.id, course) : null,
  });
});

/** Doctor/admin: hide the course's grades from students, optionally until a date. */
router.put('/:id/grade-visibility', (req, res) => {
  const id = toId(req.params.id);
  const { course } = courseAccess(req.user, id, ['doctor']);
  const v = parse(z.object({
    hidden: z.boolean(),
    visible_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  }), req.body);
  db.prepare('UPDATE courses SET grades_hidden = ?, grades_visible_from = ? WHERE id = ?').run(Number(v.hidden), v.hidden ? v.visible_from || null : null, id);
  if (course.grades_hidden && !v.hidden) announceGrades(course);
  res.json({ ok: true });
});

router.get('/:id/students', (req, res) => {
  const id = toId(req.params.id);
  courseAccess(req.user, id, READERS);
  res.json(db.prepare(`
    SELECT u.id, u.name, u.username, u.email, u.level, e.section, d.name AS department_name
    FROM enrollments e JOIN users u ON u.id = e.student_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE e.course_id = ? ORDER BY u.name`).all(id));
});

/** Attendance options per course: optional geofence around the lecture hall. */
router.put('/:id/attendance-settings', (req, res) => {
  const id = toId(req.params.id);
  courseAccess(req.user, id, ['doctor', 'ta']);
  const g = parse(z.object({
    geo_enabled: z.boolean(),
    geo_lat: z.number().min(-90).max(90).nullish(),
    geo_lng: z.number().min(-180).max(180).nullish(),
    geo_radius: z.number().int().min(30).max(5000).default(300),
    geo_label: z.string().trim().max(100).nullish(),
  }).refine((v) => !v.geo_enabled || (v.geo_lat != null && v.geo_lng != null), 'حدد موقع المدرج أولاً'), req.body);
  db.prepare('UPDATE courses SET geo_enabled = ?, geo_lat = ?, geo_lng = ?, geo_radius = ?, geo_label = ? WHERE id = ?')
    .run(Number(g.geo_enabled), g.geo_lat ?? null, g.geo_lng ?? null, g.geo_radius, g.geo_label || null, id);
  res.json({ ok: true });
});

// ───────────── Posts: announcements & lecture materials ─────────────
router.get('/:id/posts', (req, res) => {
  const id = toId(req.params.id);
  const { role } = courseAccess(req.user, id);
  const staff = role !== 'student';
  // Staff also get how many enrolled students opened each post (students never see this).
  const posts = db.prepare(`
    SELECT p.id, p.course_id, p.type, p.title, p.body, p.created_at, p.author_id,
           u.name AS author_name, cs.role AS author_role
           ${staff ? `, (SELECT COUNT(*) FROM post_views v JOIN enrollments e ON e.student_id = v.user_id AND e.course_id = p.course_id
                        WHERE v.post_id = p.id) AS seen_count` : ''}
    FROM posts p LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN course_staff cs ON cs.course_id = p.course_id AND cs.user_id = p.author_id
    WHERE p.course_id = ? ORDER BY p.created_at DESC`).all(id);
  const files = attachmentsFor('post', posts.map((p) => p.id));
  const students = staff ? courseStudentIds(id).length : undefined;
  res.json(posts.map((p) => ({ ...p, attachments: files.get(p.id), ...(staff && { students_count: students }) })));
});

/** A student opened the announcements / materials tab: everything of that type there counts as seen. */
router.post('/:id/posts/seen', (req, res) => {
  const id = toId(req.params.id);
  const { role } = courseAccess(req.user, id);
  const { type } = parse(z.object({ type: z.enum(['announcement', 'material']) }), req.body);
  if (role === 'student') {
    db.prepare(`INSERT OR IGNORE INTO post_views (post_id, user_id) SELECT id, ? FROM posts WHERE course_id = ? AND type = ?`)
      .run(req.user.id, id, type);
  }
  res.json({ ok: true });
});

router.post('/:id/posts', uploadMany.array('files', MAX_FILES), ah(async (req, res) => {
  const id = toId(req.params.id);
  let course;
  let p;
  try {
    ({ course } = courseAccess(req.user, id, ['doctor', 'ta']));
    p = parse(z.object({
      type: z.enum(['announcement', 'material']).default('announcement'),
      title: z.string().trim().min(2, 'العنوان مطلوب').max(200),
      body: z.string().trim().max(10000).optional(),
    }), req.body);
  } catch (err) {
    discardUploads(req);
    throw err;
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO posts (course_id, author_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, p.type, p.title, p.body || null);
  saveAttachments('post', Number(lastInsertRowid), req.files);

  const recipients = [...courseStudentIds(id), ...courseStaffIds(id)].filter((uid) => uid !== req.user.id);
  notify(recipients, {
    type: p.type,
    title: `${p.type === 'material' ? 'محتوى جديد' : 'إعلان جديد'} - ${course.name}`,
    body: p.title,
    link: `/courses/${id}?tab=${p.type === 'material' ? 'materials' : 'announcements'}`,
  });
  res.status(201).json({ id: Number(lastInsertRowid) });
}));

/** Tells students their (previously hidden) grades are now visible. */
export function announceGrades(course) {
  const published = db.prepare("SELECT COUNT(*) FROM assessments WHERE course_id = ? AND status = 'published'").pluck().get(course.id);
  if (!published) return;
  notify(courseStudentIds(course.id), {
    type: 'grades_published', title: `🎉 درجات ${course.name} متاحة دلوقتي`, body: 'افتح المادة وشوف درجاتك', link: `/courses/${course.id}?tab=grades`,
  });
}

export const postsRouter = Router();

/** Seen / not seen lists of one post, for the course staff. */
postsRouter.get('/:id/views', (req, res) => {
  const post = db.prepare('SELECT id, course_id FROM posts WHERE id = ?').get(toId(req.params.id));
  if (!post) throw notFound();
  courseAccess(req.user, post.course_id, READERS);
  const rows = db.prepare(`
    SELECT u.id, u.name, u.username, e.section, v.seen_at
    FROM enrollments e JOIN users u ON u.id = e.student_id
    LEFT JOIN post_views v ON v.post_id = ? AND v.user_id = u.id
    WHERE e.course_id = ? ORDER BY v.seen_at IS NULL, v.seen_at DESC, u.name`).all(post.id, post.course_id);
  res.json({ seen: rows.filter((r) => r.seen_at), unseen: rows.filter((r) => !r.seen_at) });
});

postsRouter.delete('/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(toId(req.params.id));
  if (!post) throw notFound();
  const { role } = courseAccess(req.user, post.course_id, ['doctor', 'ta']);
  if (role === 'ta' && post.author_id !== req.user.id) throw forbidden('يمكنك حذف منشوراتك فقط');
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  removeAttachments('post', post.id);
  res.json({ ok: true });
});

export default router;

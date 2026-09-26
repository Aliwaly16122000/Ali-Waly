import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { user } = req;
  const now = new Date().toISOString();

  if (user.role === 'student') {
    const pending = db.prepare(`
      SELECT a.id, a.title, a.type, a.due_at, a.max_score, c.id AS course_id, c.name AS course_name, c.code AS course_code
      FROM enrollments e JOIN assessments a ON a.course_id = e.course_id JOIN courses c ON c.id = a.course_id
      LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = e.student_id
      WHERE e.student_id = ? AND a.status = 'open' AND a.accepts_submissions = 1
        AND s.submitted_at IS NULL AND s.score IS NULL
      ORDER BY a.due_at IS NULL, a.due_at LIMIT 10`).all(user.id);
    const recentGrades = db.prepare(`
      SELECT a.id, a.title, a.max_score, a.published_at, s.score, c.id AS course_id, c.name AS course_name
      FROM enrollments e JOIN assessments a ON a.course_id = e.course_id AND a.status = 'published'
      JOIN courses c ON c.id = a.course_id
      LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = e.student_id
      WHERE e.student_id = ? ORDER BY a.published_at DESC LIMIT 6`).all(user.id);
    const att = db.prepare(`
      SELECT COUNT(s.id) AS total, COUNT(r.session_id) AS attended
      FROM enrollments e JOIN attendance_sessions s ON s.course_id = e.course_id
      LEFT JOIN attendance_records r ON r.session_id = s.id AND r.student_id = e.student_id
      WHERE e.student_id = ?`).get(user.id);
    const activeSessions = db.prepare(`
      SELECT s.id, s.title, s.closes_at, c.name AS course_name,
        EXISTS (SELECT 1 FROM attendance_records r WHERE r.session_id = s.id AND r.student_id = e.student_id) AS attended
      FROM enrollments e JOIN attendance_sessions s ON s.course_id = e.course_id JOIN courses c ON c.id = s.course_id
      WHERE e.student_id = ? AND s.closed_at IS NULL AND s.closes_at > ?`).all(user.id, now);
    const announcements = db.prepare(`
      SELECT p.id, p.title, p.type, p.created_at, c.id AS course_id, c.name AS course_name, u.name AS author_name
      FROM enrollments e JOIN posts p ON p.course_id = e.course_id JOIN courses c ON c.id = p.course_id
      LEFT JOIN users u ON u.id = p.author_id
      WHERE e.student_id = ? ORDER BY p.created_at DESC LIMIT 6`).all(user.id);
    const courses = db.prepare('SELECT COUNT(*) FROM enrollments WHERE student_id = ?').pluck().get(user.id);
    return res.json({
      courses, pending, recent_grades: recentGrades, active_sessions: activeSessions, announcements,
      attendance: { ...att, rate: att.total ? Math.round((att.attended / att.total) * 1000) / 10 : null },
    });
  }

  if (user.role === 'doctor' || user.role === 'ta') {
    const toGrade = db.prepare(`
      SELECT a.id, a.title, a.type, a.status, a.review_note, a.due_at, c.id AS course_id, c.name AS course_name,
        (SELECT COUNT(*) FROM submissions s WHERE s.assessment_id = a.id AND s.submitted_at IS NOT NULL AND s.score IS NULL) AS ungraded,
        (SELECT COUNT(*) FROM submissions s WHERE s.assessment_id = a.id AND s.score IS NOT NULL) AS graded,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = a.course_id) AS students
      FROM course_staff cs JOIN assessments a ON a.course_id = cs.course_id JOIN courses c ON c.id = a.course_id
      WHERE cs.user_id = ? AND a.status = 'open'
      ORDER BY ungraded DESC, a.due_at LIMIT 12`).all(user.id);
    const awaiting = db.prepare(`
      SELECT a.id, a.title, a.type, a.submitted_at, u.name AS submitted_by_name, c.id AS course_id, c.name AS course_name,
        (SELECT AVG(s.score) FROM submissions s WHERE s.assessment_id = a.id AND s.score IS NOT NULL) AS avg_score, a.max_score
      FROM course_staff cs JOIN assessments a ON a.course_id = cs.course_id JOIN courses c ON c.id = a.course_id
      LEFT JOIN users u ON u.id = a.submitted_by
      WHERE cs.user_id = ? AND a.status = 'submitted' ORDER BY a.submitted_at`).all(user.id);
    const activeSessions = db.prepare(`
      SELECT s.id, s.title, s.closes_at, c.name AS course_name,
        (SELECT COUNT(*) FROM attendance_records r WHERE r.session_id = s.id) AS present
      FROM course_staff cs JOIN attendance_sessions s ON s.course_id = cs.course_id JOIN courses c ON c.id = s.course_id
      WHERE cs.user_id = ? AND s.closed_at IS NULL AND s.closes_at > ?`).all(user.id, now);
    const totals = db.prepare(`
      SELECT COUNT(DISTINCT cs.course_id) AS courses,
        (SELECT COUNT(DISTINCT e.student_id) FROM enrollments e JOIN course_staff c2 ON c2.course_id = e.course_id WHERE c2.user_id = ?) AS students
      FROM course_staff cs WHERE cs.user_id = ?`).get(user.id, user.id);
    return res.json({
      ...totals,
      to_grade: toGrade,
      ungraded_total: toGrade.reduce((s, a) => s + a.ungraded, 0),
      awaiting_approval: awaiting,
      active_sessions: activeSessions,
    });
  }

  const count = (sql) => db.prepare(sql).pluck().get();
  res.json({
    departments: count('SELECT COUNT(*) FROM departments'),
    courses: count('SELECT COUNT(*) FROM courses'),
    students: count("SELECT COUNT(*) FROM users WHERE role = 'student'"),
    doctors: count("SELECT COUNT(*) FROM users WHERE role = 'doctor'"),
    tas: count("SELECT COUNT(*) FROM users WHERE role = 'ta'"),
    courses_without_staff: db.prepare(`
      SELECT c.id, c.code, c.name FROM courses c
      WHERE NOT EXISTS (SELECT 1 FROM course_staff cs WHERE cs.course_id = c.id AND cs.role = 'doctor') LIMIT 10`).all(),
    courses_without_students: db.prepare(`
      SELECT c.id, c.code, c.name FROM courses c
      WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id) LIMIT 10`).all(),
  });
});

export default router;

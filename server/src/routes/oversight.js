import { Router } from 'express';
import db from '../db.js';
import { forbidden, notFound, toId } from '../lib/http.js';
import { termFilter } from '../lib/term.js';
import { canOverseeDepartment, canOverseeFaculty, canOverseeUniversity, userScopes } from '../lib/oversight.js';
import { courseHealth, rollup } from '../lib/health.js';

/**
 * Leadership follow-up (read-only): head of department → courses, dean → departments,
 * president → faculties. Admin sees everything.
 */
const router = Router();
const isAdmin = (u) => u.role === 'admin';

router.get('/scopes', (req, res) => {
  res.json(isAdmin(req.user) ? [{ scope: 'university', scope_id: 0, name: 'الجامعة', title: 'مسؤول النظام' }] : userScopes(req.user.id));
});

function coursesOf(where, params) {
  const tf = termFilter();
  return db.prepare(`
    SELECT c.id, c.code, c.name, c.level, c.department_id,
      (SELECT json_group_array(json_object('id', u.id, 'name', u.name, 'role', cs.role, 'last_login_at', u.last_login_at))
         FROM course_staff cs JOIN users u ON u.id = cs.user_id WHERE cs.course_id = c.id) AS staff
    FROM courses c WHERE ${where} AND ${tf.sql} ORDER BY c.level, c.code`).all(...params, ...tf.params)
    .map((c) => ({ ...c, staff: JSON.parse(c.staff), health: courseHealth(c.id) }));
}

function departmentSummary(dept) {
  const courses = coursesOf('c.department_id = ?', [dept.id]);
  const students = db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student' AND department_id = ? AND is_active = 1").pluck().get(dept.id);
  const staff = db.prepare("SELECT COUNT(*) FROM users WHERE role IN ('doctor','ta') AND department_id = ?").pluck().get(dept.id);
  return { ...dept, students, staff, ...rollup(courses.map((c) => c.health)), _courses: courses };
}

router.get('/department/:id', (req, res) => {
  const id = toId(req.params.id);
  if (!isAdmin(req.user) && !canOverseeDepartment(req.user.id, id)) throw forbidden();
  const dept = db.prepare('SELECT d.*, f.name AS faculty_name FROM departments d LEFT JOIN faculties f ON f.id = d.faculty_id WHERE d.id = ?').get(id);
  if (!dept) throw notFound();
  const { _courses, ...summary } = departmentSummary(dept);
  res.json({ ...summary, courses: _courses });
});

function facultySummary(fac) {
  const depts = db.prepare('SELECT * FROM departments WHERE faculty_id = ? ORDER BY name').all(fac.id).map(departmentSummary);
  const all = depts.flatMap((d) => d._courses.map((c) => c.health));
  return {
    ...fac, ...rollup(all),
    students: depts.reduce((s, d) => s + d.students, 0), staff: depts.reduce((s, d) => s + d.staff, 0),
    _departments: depts.map(({ _courses, ...d }) => d),
  };
}

router.get('/faculty/:id', (req, res) => {
  const id = toId(req.params.id);
  if (!isAdmin(req.user) && !canOverseeFaculty(req.user.id, id)) throw forbidden();
  const fac = db.prepare('SELECT * FROM faculties WHERE id = ?').get(id);
  if (!fac) throw notFound();
  const { _departments, ...summary } = facultySummary(fac);
  res.json({ ...summary, departments: _departments });
});

router.get('/university', (req, res) => {
  if (!isAdmin(req.user) && !canOverseeUniversity(req.user.id)) throw forbidden();
  const faculties = db.prepare('SELECT * FROM faculties ORDER BY name').all().map((f) => {
    const { _departments, ...summary } = facultySummary(f);
    return { ...summary, departments: _departments.length };
  });
  const students = faculties.reduce((s, f) => s + f.students, 0);
  res.json({ students, faculties });
});

export default router;

import db from '../db.js';
import { forbidden, notFound } from './http.js';

const staffRoleStmt = db.prepare('SELECT role FROM course_staff WHERE course_id = ? AND user_id = ?');
const enrolledStmt = db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?');
const courseStmt = db.prepare('SELECT * FROM courses WHERE id = ?');

/** Returns the user's relation to a course: 'admin' | 'doctor' | 'ta' | 'student' | null. */
export function courseRole(user, courseId) {
  if (user.role === 'admin') return 'admin';
  const staff = staffRoleStmt.get(courseId, user.id);
  if (staff) return staff.role;
  if (user.role === 'student' && enrolledStmt.get(courseId, user.id)) return 'student';
  return null;
}

/**
 * Loads a course and asserts access. `allowed` lists the course roles permitted;
 * admins are always allowed. Returns { course, role }.
 */
export function courseAccess(user, courseId, allowed = ['doctor', 'ta', 'student']) {
  const course = courseStmt.get(courseId);
  if (!course) throw notFound('المادة غير موجودة');
  const role = courseRole(user, courseId);
  if (!role || (role !== 'admin' && !allowed.includes(role))) throw forbidden();
  return { course, role };
}

export const isStaffRole = (role) => role === 'doctor' || role === 'ta' || role === 'admin';

export const courseStudentIds = (courseId) =>
  db.prepare('SELECT student_id FROM enrollments WHERE course_id = ?').pluck().all(courseId);

export const courseStaffIds = (courseId, role) =>
  role
    ? db.prepare('SELECT user_id FROM course_staff WHERE course_id = ? AND role = ?').pluck().all(courseId, role)
    : db.prepare('SELECT user_id FROM course_staff WHERE course_id = ?').pluck().all(courseId);

/** Two users may chat when they share a course and at least one of them is staff on it. */
export function canChat(aId, bId) {
  if (aId === bId) return false;
  const row = db.prepare(`
    WITH members AS (
      SELECT course_id, user_id, 1 AS staff FROM course_staff
      UNION ALL
      SELECT course_id, student_id, 0 FROM enrollments
    )
    SELECT 1 FROM members a JOIN members b ON a.course_id = b.course_id
    WHERE a.user_id = ? AND b.user_id = ? AND (a.staff = 1 OR b.staff = 1)
    LIMIT 1`).get(aId, bId);
  return !!row;
}

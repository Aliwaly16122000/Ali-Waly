import db from '../db.js';

/** Scopes a user may follow: [{ scope, scope_id, title, name }]. */
export function userScopes(userId) {
  return db.prepare(`
    SELECT o.scope, o.scope_id, o.title,
      CASE o.scope WHEN 'department' THEN d.name WHEN 'faculty' THEN f.name ELSE 'الجامعة' END AS name
    FROM oversight o
    LEFT JOIN departments d ON o.scope = 'department' AND d.id = o.scope_id
    LEFT JOIN faculties f ON o.scope = 'faculty' AND f.id = o.scope_id
    WHERE o.user_id = ? ORDER BY CASE o.scope WHEN 'university' THEN 0 WHEN 'faculty' THEN 1 ELSE 2 END`).all(userId);
}

/** Can the user follow this department (as its head, its faculty's dean, or university-wide)? */
export function canOverseeDepartment(userId, departmentId) {
  if (!departmentId) return !!db.prepare("SELECT 1 FROM oversight WHERE user_id = ? AND scope = 'university'").get(userId);
  return !!db.prepare(`
    SELECT 1 FROM oversight o LEFT JOIN departments d ON d.id = ?
    WHERE o.user_id = ? AND (o.scope = 'university'
      OR (o.scope = 'faculty' AND o.scope_id = d.faculty_id)
      OR (o.scope = 'department' AND o.scope_id = d.id)) LIMIT 1`).get(departmentId, userId);
}

export function canOverseeFaculty(userId, facultyId) {
  return !!db.prepare(`SELECT 1 FROM oversight WHERE user_id = ? AND (scope = 'university' OR (scope = 'faculty' AND scope_id = ?)) LIMIT 1`)
    .get(userId, facultyId);
}

export const canOverseeUniversity = (userId) => !!db.prepare("SELECT 1 FROM oversight WHERE user_id = ? AND scope = 'university'").get(userId);

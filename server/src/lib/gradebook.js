import db from '../db.js';
import { letterGrade, round } from './stats.js';

/**
 * Grading scheme ("توزيع الدرجات") stored per course as JSON:
 * {
 *   components: [{ key, name, weight, assessment_ids: [..], best_of: n|null }],
 *   attendance: { enabled: bool, weight: number }
 * }
 * Each component is scaled to its weight: Σscore / Σmax × weight over the chosen
 * assessments (optionally only the student's best N). Attendance contributes
 * rate × weight. The final grade is the sum of all components.
 */
export function getScheme(courseId) {
  const raw = db.prepare('SELECT grading_scheme FROM courses WHERE id = ?').pluck().get(courseId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function attendanceRates(courseId) {
  const sessions = db.prepare('SELECT COUNT(*) FROM attendance_sessions WHERE course_id = ?').pluck().get(courseId);
  const map = new Map();
  if (!sessions) return map;
  const rows = db.prepare(`
    SELECT e.student_id, COUNT(r.session_id) AS attended FROM enrollments e
    LEFT JOIN attendance_records r ON r.student_id = e.student_id
      AND r.session_id IN (SELECT id FROM attendance_sessions WHERE course_id = e.course_id)
    WHERE e.course_id = ? GROUP BY e.student_id`).all(courseId);
  for (const r of rows) map.set(r.student_id, { attended: r.attended, sessions, rate: round((r.attended / sessions) * 100, 1) });
  return map;
}

function componentScore(component, grades, assessmentsById, assessedIds) {
  // Only assessments whose grading is finished count, so the grade is meaningful
  // mid-term; a student with no score on a finished item gets zero.
  const items = component.assessment_ids
    .map((id) => assessmentsById.get(id))
    .filter((a) => a && assessedIds.has(a.id))
    .map((a) => ({ max: a.max_score, score: grades[a.id]?.score ?? 0 }));
  if (!items.length) return null;
  let chosen = items;
  if (component.best_of && component.best_of < items.length) {
    chosen = [...items].sort((x, y) => y.score / y.max - x.score / x.max).slice(0, component.best_of);
  }
  const max = chosen.reduce((s, i) => s + i.max, 0);
  const score = chosen.reduce((s, i) => s + i.score, 0);
  return max ? (score / max) * component.weight : null;
}

/**
 * Builds the course gradebook: every enrolled student × every assessment, with totals
 * computed automatically — both the raw sum and, when the course has a grading
 * scheme, the weighted final grade.
 */
export function buildGradebook(courseId) {
  const assessments = db.prepare(`
    SELECT id, title, type, max_score, status, due_at FROM assessments
    WHERE course_id = ? ORDER BY COALESCE(due_at, created_at), id`).all(courseId);
  const students = db.prepare(`
    SELECT u.id, u.name, u.username, e.section FROM enrollments e JOIN users u ON u.id = e.student_id
    WHERE e.course_id = ? ORDER BY e.section, u.name`).all(courseId);
  const scores = db.prepare(`
    SELECT s.student_id, s.assessment_id, s.score, s.submitted_at FROM submissions s
    JOIN assessments a ON a.id = s.assessment_id WHERE a.course_id = ?`).all(courseId);

  const byStudent = new Map(students.map((s) => [s.id, {}]));
  for (const s of scores) {
    const cells = byStudent.get(s.student_id);
    if (cells) cells[s.assessment_id] = s;
  }

  const totalMax = assessments.reduce((sum, a) => sum + a.max_score, 0);
  // An assessment counts toward "so far" totals once its grading is finished: handed to the
  // doctor / published, or every enrolled student has a score. A sheet the TA is still
  // grading doesn't penalise students whose papers simply haven't been marked yet.
  const gradedCount = new Map();
  for (const s of scores) if (s.score !== null) gradedCount.set(s.assessment_id, (gradedCount.get(s.assessment_id) || 0) + 1);
  const assessedIds = new Set(assessments
    .filter((a) => gradedCount.get(a.id) && (a.status !== 'open' || gradedCount.get(a.id) >= students.length))
    .map((a) => a.id));
  const assessedMax = assessments.filter((a) => assessedIds.has(a.id)).reduce((sum, a) => sum + a.max_score, 0);
  const assessmentsById = new Map(assessments.map((a) => [a.id, a]));
  const attendance = attendanceRates(courseId);

  const scheme = getScheme(courseId);
  const components = scheme?.components ?? [];
  const attWeight = scheme?.attendance?.enabled ? Number(scheme.attendance.weight) || 0 : 0;
  const finalMax = components.reduce((s, c) => s + c.weight, 0) + attWeight;

  const rows = students.map((st) => {
    const cells = byStudent.get(st.id);
    let total = 0;
    let assessedTotal = 0;
    const grades = {};
    for (const a of assessments) {
      const cell = cells[a.id];
      grades[a.id] = cell ? { score: cell.score, submitted: !!cell.submitted_at } : { score: null, submitted: false };
      if (cell && cell.score !== null) {
        total += cell.score;
        if (assessedIds.has(a.id)) assessedTotal += cell.score;
      }
    }
    const pct = assessedMax ? (assessedTotal / assessedMax) * 100 : null;
    const att = attendance.get(st.id) ?? null;

    let final = null;
    if (scheme) {
      const parts = {};
      let sum = 0;
      let available = 0;
      for (const c of components) {
        const v = componentScore(c, grades, assessmentsById, assessedIds);
        parts[c.key] = v === null ? null : round(v);
        if (v !== null) { sum += v; available += c.weight; }
      }
      if (attWeight) {
        const v = att ? (att.rate / 100) * attWeight : null;
        parts.attendance = v === null ? null : round(v);
        if (v !== null) { sum += v; available += attWeight; }
      }
      const finalPct = available ? (sum / available) * 100 : null;
      final = { parts, total: round(sum), available, percentage: round(finalPct), letter: letterGrade(finalPct) };
    }

    return {
      ...st, grades, total: round(total), assessed_total: round(assessedTotal), percentage: round(pct), letter: letterGrade(pct), attendance: att, final,
    };
  });
  return { assessments, rows, total_max: totalMax, assessed_max: assessedMax, scheme, final_max: scheme ? finalMax : null };
}

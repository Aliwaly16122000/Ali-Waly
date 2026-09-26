import db from '../db.js';
import { buildGradebook } from './gradebook.js';
import { round } from './stats.js';

/*
 * "Is everything on track?" metrics for leadership dashboards. A course is flagged when
 * attendance or grades are low, grading is piling up, or nothing has been assessed yet.
 */
const TTL_MS = 2 * 60 * 1000;
const cache = new Map();

export function courseHealth(courseId) {
  const hit = cache.get(courseId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = computeCourseHealth(courseId);
  cache.set(courseId, { at: Date.now(), value });
  return value;
}

function computeCourseHealth(courseId) {
  const gb = buildGradebook(courseId);
  const students = gb.rows.length;
  const pcts = gb.rows.map((r) => (gb.scheme ? r.final?.percentage : r.percentage)).filter((p) => p !== null && p !== undefined);
  const avg = pcts.length ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null;
  const pass = pcts.length ? (pcts.filter((p) => p >= 50).length / pcts.length) * 100 : null;
  const att = gb.rows.map((r) => r.attendance?.rate).filter((v) => v !== null && v !== undefined);
  const attendance = att.length ? att.reduce((s, v) => s + v, 0) / att.length : null;
  const sessions = db.prepare('SELECT COUNT(*) FROM attendance_sessions WHERE course_id = ?').pluck().get(courseId);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const backlog = db.prepare(`SELECT COUNT(*) FROM submissions s JOIN assessments a ON a.id = s.assessment_id
    WHERE a.course_id = ? AND s.submitted_at IS NOT NULL AND s.score IS NULL`).pluck().get(courseId);
  const overdue = db.prepare(`SELECT COUNT(*) FROM submissions s JOIN assessments a ON a.id = s.assessment_id
    WHERE a.course_id = ? AND s.submitted_at IS NOT NULL AND s.score IS NULL AND s.submitted_at < ?`).pluck().get(courseId, weekAgo);
  const counts = db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'published') AS published, SUM(status = 'submitted') AS awaiting
    FROM assessments WHERE course_id = ?`).get(courseId);
  const atRisk = gb.rows.filter((r) => {
    const p = gb.scheme ? r.final?.percentage : r.percentage;
    return (p !== null && p !== undefined && p < 50) || (r.attendance && r.attendance.rate < 75);
  }).length;

  const issues = [];
  if (attendance !== null && attendance < 60) issues.push({ level: 'critical', text: `الحضور ${round(attendance, 0)}%` });
  else if (attendance !== null && attendance < 75) issues.push({ level: 'warning', text: `الحضور ${round(attendance, 0)}%` });
  if (avg !== null && avg < 50) issues.push({ level: 'critical', text: `متوسط الدرجات ${round(avg, 0)}%` });
  else if (avg !== null && avg < 60) issues.push({ level: 'warning', text: `متوسط الدرجات ${round(avg, 0)}%` });
  if (overdue > 20) issues.push({ level: 'critical', text: `${overdue} تسليم متأخر تصحيحه أكتر من أسبوع` });
  else if (overdue > 0) issues.push({ level: 'warning', text: `${overdue} تسليم متأخر تصحيحه أكتر من أسبوع` });
  if (counts.awaiting) issues.push({ level: 'warning', text: `${counts.awaiting} تقييم بانتظار اعتماد الدكتور` });
  if (students && !sessions) issues.push({ level: 'warning', text: 'لم يُسجَّل حضور بعد' });
  if (students && !counts.total) issues.push({ level: 'warning', text: 'لا توجد تقييمات بعد' });
  const status = issues.some((i) => i.level === 'critical') ? 'critical' : issues.length ? 'warning' : 'good';

  return {
    students, avg: round(avg, 1), pass_rate: round(pass, 1), attendance: round(attendance, 1), sessions,
    assessments: counts.total || 0, published: counts.published || 0, awaiting: counts.awaiting || 0,
    backlog, overdue, at_risk: atRisk, status, issues,
  };
}

/** Student-weighted roll-up of several courses' metrics. */
export function rollup(list) {
  const withStudents = list.filter((h) => h.students);
  const w = (key) => {
    const xs = withStudents.filter((h) => h[key] !== null);
    const n = xs.reduce((s, h) => s + h.students, 0);
    return n ? round(xs.reduce((s, h) => s + h[key] * h.students, 0) / n, 1) : null;
  };
  const sum = (key) => list.reduce((s, h) => s + (h[key] || 0), 0);
  return {
    courses: list.length,
    avg: w('avg'), pass_rate: w('pass_rate'), attendance: w('attendance'),
    backlog: sum('backlog'), overdue: sum('overdue'), awaiting: sum('awaiting'), at_risk: sum('at_risk'),
    critical: list.filter((h) => h.status === 'critical').length,
    warning: list.filter((h) => h.status === 'warning').length,
    status: list.some((h) => h.status === 'critical') ? 'critical' : list.some((h) => h.status === 'warning') ? 'warning' : 'good',
  };
}

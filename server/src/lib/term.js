import db, { getSetting, setSetting } from '../db.js';
import { badRequest } from './http.js';

const SEM_ORDER = { fall: 1, spring: 2, summer: 3 };
export const SEMESTER_LABELS = { fall: 'الترم الأول', spring: 'الترم الثاني', summer: 'الترم الصيفي' };

/**
 * The term the faculty is currently running. Set by admin; until then it defaults to the
 * newest term that has courses. Courses from other terms are archived: readable, but no
 * new submissions, attendance or timetable reminders.
 */
export function currentTerm() {
  const saved = getSetting('current_term');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch { /* fall through */ }
  }
  const terms = db.prepare('SELECT DISTINCT academic_year, semester FROM courses').all();
  terms.sort((a, b) => b.academic_year.localeCompare(a.academic_year) || SEM_ORDER[b.semester] - SEM_ORDER[a.semester]);
  return terms[0] ?? null;
}

export function setCurrentTerm(term) {
  setSetting('current_term', JSON.stringify({ academic_year: term.academic_year, semester: term.semester }));
}

export function isArchived(course) {
  const t = currentTerm();
  return !!t && (course.academic_year !== t.academic_year || course.semester !== t.semester);
}

export function assertCurrentTerm(course) {
  if (isArchived(course)) throw badRequest('المادة دي من ترم سابق (أرشيف) — العرض فقط');
}

/** SQL fragment + params restricting courses alias `c` to the current term. */
export function termFilter() {
  const t = currentTerm();
  return t ? { sql: 'c.academic_year = ? AND c.semester = ?', params: [t.academic_year, t.semester] } : { sql: '1 = 1', params: [] };
}

export function listTerms() {
  return db.prepare(`SELECT academic_year, semester, COUNT(*) AS courses FROM courses GROUP BY academic_year, semester`).all()
    .sort((a, b) => b.academic_year.localeCompare(a.academic_year) || SEM_ORDER[b.semester] - SEM_ORDER[a.semester]);
}

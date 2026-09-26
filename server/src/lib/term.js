import db, { getSetting, setSetting } from '../db.js';
import { badRequest } from './http.js';
import { localNow } from './clock.js';

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

export function termDates(term) {
  if (!term) return null;
  return db.prepare('SELECT start_date, end_date FROM term_dates WHERE academic_year = ? AND semester = ?')
    .get(term.academic_year, term.semester) ?? null;
}

export function setTermDates(term, startDate, endDate) {
  db.prepare(`INSERT INTO term_dates (academic_year, semester, start_date, end_date) VALUES (?, ?, ?, ?)
    ON CONFLICT (academic_year, semester) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date`)
    .run(term.academic_year, term.semester, startDate, endDate);
}

const dayMs = 86400000;
const toDay = (ymd) => Date.UTC(...ymd.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));

/** Current term with its dates and "week N of M" (weeks start on the term's first day). */
export function termInfo() {
  const term = currentTerm();
  if (!term) return null;
  const dates = termDates(term);
  if (!dates) return { ...term, start_date: null, end_date: null, week: null, weeks: null, status: 'unknown' };
  const today = toDay(localNow().date);
  const start = toDay(dates.start_date);
  const end = toDay(dates.end_date);
  const weeks = Math.max(1, Math.ceil((end - start + dayMs) / (7 * dayMs)));
  const status = today < start ? 'upcoming' : today > end ? 'ended' : 'running';
  const week = status === 'running' ? Math.floor((today - start) / (7 * dayMs)) + 1 : null;
  return { ...term, ...dates, week, weeks, status, days_left: status === 'running' ? Math.round((end - today) / dayMs) : null };
}

/** Holidays covering `date` that apply to a course's department/year. */
export function holidayFor(date, course) {
  return db.prepare(`
    SELECT * FROM academic_events WHERE kind = 'holiday' AND start_date <= ? AND end_date >= ?
      AND (department_id IS NULL OR department_id = ?) AND (level IS NULL OR level = ?) LIMIT 1`)
    .get(date, date, course.department_id ?? -1, course.level ?? -1) ?? null;
}

/** True when classes run on `date` for this course: inside the term dates and not a holiday. */
export function isTeachingDay(date, course) {
  const dates = termDates({ academic_year: course.academic_year, semester: course.semester });
  if (dates && (date < dates.start_date || date > dates.end_date)) return false;
  return !holidayFor(date, course);
}

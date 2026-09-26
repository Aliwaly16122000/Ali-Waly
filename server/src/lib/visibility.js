import db from '../db.js';
import { localNow } from './clock.js';

/*
 * What a student may see in a course right now.
 *  - The doctor (or admin) can hide the course's grades, optionally until a date.
 *  - Admin can require an open survey to be answered before grades and/or the exam
 *    timetable are shown.
 * Returns null when nothing is locked, otherwise { reason, ... } for the UI.
 */
const pendingSurvey = (studentId, courseId, gate) => db.prepare(`
  SELECT s.id, s.title FROM surveys s JOIN survey_courses sc ON sc.survey_id = s.id AND sc.course_id = ?
  WHERE s.status = 'open' AND s.${gate} = 1
    AND NOT EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = s.id AND r.course_id = sc.course_id AND r.student_id = ?)
  ORDER BY s.id LIMIT 1`).get(courseId, studentId);

export function gradesHiddenByDoctor(course) {
  if (!course.grades_hidden) return null;
  if (course.grades_visible_from && localNow().date >= course.grades_visible_from) return null;
  return { reason: 'hidden', until: course.grades_visible_from || null };
}

export function gradesLock(studentId, courseOrId) {
  const course = typeof courseOrId === 'object' ? courseOrId : db.prepare('SELECT * FROM courses WHERE id = ?').get(courseOrId);
  if (!course) return null;
  const hidden = gradesHiddenByDoctor(course);
  if (hidden) return hidden;
  const survey = pendingSurvey(studentId, course.id, 'gate_grades');
  return survey ? { reason: 'survey', survey_id: survey.id, survey_title: survey.title, course_id: course.id } : null;
}

export function examsLock(studentId, courseId) {
  const survey = pendingSurvey(studentId, courseId, 'gate_exams');
  return survey ? { reason: 'survey', survey_id: survey.id, survey_title: survey.title, course_id: courseId } : null;
}

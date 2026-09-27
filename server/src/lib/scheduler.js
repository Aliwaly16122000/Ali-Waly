import db from '../db.js';
import { notify } from './notify.js';
import { nowIso } from './time.js';
import { localNow, toMinutes } from './clock.js';
import { isTeachingDay, termFilter } from './term.js';
import { dailyBackup } from './backup.js';
import { weeklyOffsite } from './offsite.js';
import { examReminders } from '../routes/exams.js';
import { announceGrades } from '../routes/courses.js';
import { openAttendanceSession } from '../routes/attendance.js';
import { KIND_LABELS, slotTitle } from '../routes/schedule.js';

const ABSENCE_THRESHOLD = Number(process.env.ABSENCE_THRESHOLD) || 75;
const MIN_SESSIONS_FOR_WARNING = 3;

/** 24h before a deadline, remind students who haven't submitted yet. */
function deadlineReminders() {
  const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const due = db.prepare(`
    SELECT a.id, a.title, a.course_id, a.due_at, c.name AS course_name FROM assessments a JOIN courses c ON c.id = a.course_id
    WHERE a.status = 'open' AND a.accepts_submissions = 1 AND a.reminded_at IS NULL
      AND a.due_at IS NOT NULL AND a.due_at > ? AND a.due_at <= ?`).all(nowIso(), soon);
  for (const a of due) {
    const pending = db.prepare(`
      SELECT e.student_id FROM enrollments e
      LEFT JOIN submissions s ON s.assessment_id = ? AND s.student_id = e.student_id
      WHERE e.course_id = ? AND s.submitted_at IS NULL AND s.score IS NULL`).pluck().all(a.id, a.course_id);
    const hours = Math.max(1, Math.round((new Date(a.due_at) - Date.now()) / 3600000));
    notify(pending, {
      type: 'assessment', title: `⏰ فاضل ${hours} ساعة على تسليم ${a.title}`, body: a.course_name,
      link: `/courses/${a.course_id}/assessments/${a.id}`,
    });
    db.prepare('UPDATE assessments SET reminded_at = ? WHERE id = ?').run(nowIso(), a.id);
  }
}

/**
 * After an attendance session ends, warn every student who missed it and whose
 * attendance in the course has dropped below the threshold (default 75%).
 */
function absenceWarnings() {
  const ended = db.prepare(`
    SELECT s.id, s.course_id, s.title, c.name AS course_name FROM attendance_sessions s JOIN courses c ON c.id = s.course_id
    WHERE s.warnings_sent_at IS NULL AND (s.closed_at IS NOT NULL OR s.closes_at <= ?)`).all(nowIso());
  for (const s of ended) {
    const total = db.prepare('SELECT COUNT(*) FROM attendance_sessions WHERE course_id = ?').pluck().get(s.course_id);
    if (total >= MIN_SESSIONS_FOR_WARNING) {
      const rows = db.prepare(`
        SELECT e.student_id,
          (SELECT COUNT(*) FROM attendance_records r JOIN attendance_sessions x ON x.id = r.session_id
            WHERE x.course_id = e.course_id AND r.student_id = e.student_id) AS attended
        FROM enrollments e
        WHERE e.course_id = ? AND NOT EXISTS (SELECT 1 FROM attendance_records r WHERE r.session_id = ? AND r.student_id = e.student_id)`)
        .all(s.course_id, s.id);
      for (const r of rows) {
        const rate = Math.round((r.attended / total) * 100);
        if (rate < ABSENCE_THRESHOLD) {
          notify(r.student_id, {
            type: 'attendance', title: `⚠️ إنذار غياب - ${s.course_name}`,
            body: `نسبة حضورك ${rate}% (${r.attended} من ${total}). الحد الأدنى ${ABSENCE_THRESHOLD}% لدخول الامتحان.`,
            link: `/courses/${s.course_id}?tab=attendance`,
          });
        }
      }
    }
    db.prepare('UPDATE attendance_sessions SET warnings_sent_at = ? WHERE id = ?').run(nowIso(), s.id);
  }
}

const claimEvent = db.prepare('INSERT OR IGNORE INTO schedule_events (slot_id, date, kind) VALUES (?, ?, ?)');

function slotAudience(slot) {
  const students = slot.section
    ? db.prepare('SELECT student_id FROM enrollments WHERE course_id = ? AND (section = ? OR section IS NULL)').pluck().all(slot.course_id, slot.section)
    : db.prepare('SELECT student_id FROM enrollments WHERE course_id = ?').pluck().all(slot.course_id);
  const staff = slot.staff_id
    ? [slot.staff_id]
    : db.prepare('SELECT user_id FROM course_staff WHERE course_id = ? AND role = ?').pluck()
      .all(slot.course_id, slot.kind === 'lecture' ? 'doctor' : 'ta');
  return { students, staff };
}

const hhmm = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};

/**
 * Timetable automation, evaluated every minute in the faculty's local time:
 *  - `remind_before` minutes before a slot: remind its students and lecturer/TA.
 *  - `attendance_offset` minutes after it starts: prompt the lecturer to open attendance
 *    (one-tap link to the QR screen), or open it automatically. Sessions close on their own
 *    after `attendance_duration` minutes.
 */
function timetable() {
  const now = localNow();
  const tf = termFilter();
  const slots = db.prepare(`
    SELECT s.*, c.name AS course_name, c.department_id, c.level, c.academic_year, c.semester, u.name AS staff_name
    FROM course_schedule s JOIN courses c ON c.id = s.course_id
    LEFT JOIN users u ON u.id = s.staff_id WHERE s.day_of_week = ? AND ${tf.sql}`).all(now.dow, ...tf.params);
  for (const slot of slots) {
    if (!isTeachingDay(now.date, slot)) continue; // holiday, or outside the term's dates
    const start = toMinutes(slot.start_time);
    const end = toMinutes(slot.end_time);
    const label = `${KIND_LABELS[slot.kind]}${slot.section ? ` (${slot.section})` : ''}`;
    const where = [hhmm(slot.start_time), slot.location].filter(Boolean).join(' · ');

    if (slot.remind_before > 0 && now.minutes >= start - slot.remind_before && now.minutes < start
      && claimEvent.run(slot.id, now.date, 'reminder').changes) {
      const { students, staff } = slotAudience(slot);
      const inMin = start - now.minutes;
      notify(students, { type: 'schedule', title: `📅 ${label} ${slot.course_name} بعد ${inMin} دقيقة`, body: where, link: `/courses/${slot.course_id}` });
      notify(staff, { type: 'schedule', title: `📅 عندك ${label} ${slot.course_name} بعد ${inMin} دقيقة`, body: `${where} · ${students.length} طالب`, link: `/courses/${slot.course_id}` });
    }

    const at = start + slot.attendance_offset;
    if (slot.attendance_mode !== 'off' && now.minutes >= at && now.minutes < end
      && claimEvent.run(slot.id, now.date, 'attendance').changes) {
      const { staff } = slotAudience(slot);
      if (slot.attendance_mode === 'auto') {
        const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(slot.course_id);
        const { id } = openAttendanceSession({ course, title: slotTitle(slot), userId: staff[0] ?? null, scheduleId: slot.id, durationMinutes: slot.attendance_duration });
        notify(staff, {
          type: 'attendance', title: `✅ تم فتح الحضور تلقائياً - ${slot.course_name}`,
          body: `اعرض الـ QR للطلاب · يقفل بعد ${slot.attendance_duration} دقيقة`, link: `/attendance/${id}/live`,
        });
      } else {
        notify(staff, {
          type: 'attendance', title: `🔔 وقت تسجيل الحضور - ${slot.course_name}`,
          body: `اضغط لفتح الحضور وعرض الـ QR · هيقفل تلقائياً بعد ${slot.attendance_duration} دقيقة`, link: `/schedule/${slot.id}/attend`,
        });
      }
    }
  }
}

/** Grades hidden "until <date>" become visible on that date, and students are told. */
function releaseHiddenGrades(now) {
  const due = db.prepare('SELECT * FROM courses WHERE grades_hidden = 1 AND grades_visible_from IS NOT NULL AND grades_visible_from <= ?').all(now.date);
  for (const c of due) {
    db.prepare('UPDATE courses SET grades_hidden = 0, grades_visible_from = NULL WHERE id = ?').run(c.id);
    announceGrades(c);
  }
}

export function startScheduler() {
  const tick = () => {
    try {
      timetable();
      examReminders(localNow());
      releaseHiddenGrades(localNow());
      deadlineReminders();
      absenceWarnings();
      dailyBackup().catch((err) => console.error('backup failed', err));
      weeklyOffsite((msg) => notify(db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").pluck().all(), {
        type: 'announcement', title: '⚠️ النسخة الاحتياطية الأسبوعية مااتبعتتش', body: msg, link: '/admin/system',
      }));
    } catch (err) {
      console.error('scheduler error', err);
    }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 60 * 1000);
}

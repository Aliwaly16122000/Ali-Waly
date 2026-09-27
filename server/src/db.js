import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'engportal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faculties (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email                TEXT,
  phone                TEXT,
  role                 TEXT NOT NULL CHECK (role IN ('admin','doctor','ta','student','leader')),
  department_id        INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  level                INTEGER,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  is_active            INTEGER NOT NULL DEFAULT 1,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, department_id, level);

CREATE TABLE IF NOT EXISTS courses (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  level         INTEGER,
  semester      TEXT NOT NULL DEFAULT 'fall' CHECK (semester IN ('fall','spring','summer')),
  academic_year TEXT NOT NULL,
  credit_hours  INTEGER NOT NULL DEFAULT 3,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (code, academic_year, semester)
);

CREATE TABLE IF NOT EXISTS course_staff (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('doctor','ta')),
  PRIMARY KEY (course_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_course_staff_user ON course_staff(user_id);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section     TEXT,
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (course_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);

CREATE TABLE IF NOT EXISTS assessments (
  id                  INTEGER PRIMARY KEY,
  course_id           INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'sheet'
                      CHECK (type IN ('sheet','quiz','midterm','lab','project','final','other')),
  description         TEXT,
  max_score           REAL NOT NULL CHECK (max_score > 0),
  due_at              TEXT,
  accepts_submissions INTEGER NOT NULL DEFAULT 1,
  attachment_path     TEXT,
  attachment_name     TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','published')),
  review_note         TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at        TEXT,
  published_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_assessments_course ON assessments(course_id);

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path     TEXT,
  file_name     TEXT,
  file_size     INTEGER,
  note          TEXT,
  submitted_at  TEXT,
  score         REAL,
  feedback      TEXT,
  graded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  graded_at     TEXT,
  UNIQUE (assessment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL DEFAULT 'announcement' CHECK (type IN ('announcement','material')),
  title      TEXT NOT NULL,
  body       TEXT,
  file_path  TEXT,
  file_name  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_course ON posts(course_id, created_at);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id             INTEGER PRIMARY KEY,
  course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  secret         TEXT NOT NULL,
  rotate_seconds INTEGER NOT NULL DEFAULT 15,
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closes_at      TEXT NOT NULL,
  closed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_attendance_course ON attendance_sessions(course_id);

CREATE TABLE IF NOT EXISTS attendance_records (
  session_id  INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method      TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','code','manual')),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY,
  user1_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_message_at TEXT,
  CHECK (user1_id < user2_id),
  UNIQUE (user1_id, user2_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT,
  file_path       TEXT,
  file_name       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, id);

CREATE TABLE IF NOT EXISTS course_schedule (
  id                  INTEGER PRIMARY KEY,
  course_id           INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'lecture' CHECK (kind IN ('lecture','section','lab')),
  day_of_week         INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time          TEXT NOT NULL,
  end_time            TEXT NOT NULL,
  location            TEXT,
  section             TEXT,
  staff_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remind_before       INTEGER NOT NULL DEFAULT 30,
  attendance_mode     TEXT NOT NULL DEFAULT 'remind' CHECK (attendance_mode IN ('off','remind','auto')),
  attendance_offset   INTEGER NOT NULL DEFAULT 10,
  attendance_duration INTEGER NOT NULL DEFAULT 15,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_schedule_course ON course_schedule(course_id);
CREATE INDEX IF NOT EXISTS idx_schedule_day ON course_schedule(day_of_week);

-- Which scheduled events (reminder / attendance prompt) already fired for a slot on a date.
CREATE TABLE IF NOT EXISTS schedule_events (
  slot_id  INTEGER NOT NULL REFERENCES course_schedule(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  kind     TEXT NOT NULL,
  fired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (slot_id, date, kind)
);

-- Every grade change and workflow step, so disputes can be traced ("who changed my grade?").
CREATE TABLE IF NOT EXISTS grade_history (
  id            INTEGER PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('grade','submit','publish','return')),
  old_score     REAL,
  new_score     REAL,
  old_feedback  TEXT,
  new_feedback  TEXT,
  reason        TEXT,
  changed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_grade_history ON grade_history(assessment_id, student_id);

-- The one phone a student may record attendance from.
CREATE TABLE IF NOT EXISTS student_devices (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  label     TEXT,
  bound_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Start/end dates of each term (local dates, YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS term_dates (
  academic_year TEXT NOT NULL,
  semester      TEXT NOT NULL CHECK (semester IN ('fall','spring','summer')),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  PRIMARY KEY (academic_year, semester)
);

-- Academic calendar: holidays (no classes), exam periods and other events.
CREATE TABLE IF NOT EXISTS academic_events (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('holiday','exam','event')),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  level         INTEGER,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_dates ON academic_events(start_date, end_date);

-- Exam timetable: one row per course exam, shown to every student enrolled in the course.
CREATE TABLE IF NOT EXISTS exams (
  id          INTEGER PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'final' CHECK (kind IN ('midterm','final','practical','oral')),
  exam_date   TEXT NOT NULL,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  location    TEXT,
  notes       TEXT,
  published   INTEGER NOT NULL DEFAULT 0,
  reminded_at TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (course_id, kind, exam_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_date);

-- Seat number and hall (لجنة) of each student for a term's midterm or final period.
CREATE TABLE IF NOT EXISTS exam_seating (
  academic_year TEXT NOT NULL,
  semester      TEXT NOT NULL,
  period        TEXT NOT NULL CHECK (period IN ('midterm','final')),
  student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seat_number   TEXT NOT NULL,
  hall          TEXT,
  PRIMARY KEY (academic_year, semester, period, student_id)
);

-- Read-only follow-up rights: head of department, dean (faculty) or university president.
CREATE TABLE IF NOT EXISTS oversight (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope    TEXT NOT NULL CHECK (scope IN ('department','faculty','university')),
  scope_id INTEGER NOT NULL DEFAULT 0, -- department/faculty id; 0 for the whole university
  title    TEXT,
  PRIMARY KEY (user_id, scope, scope_id)
);

-- Surveys (e.g. course evaluation). Admin can require one before a student sees their
-- grades and/or exam timetable for a course. Answers are anonymous to teaching staff.
CREATE TABLE IF NOT EXISTS surveys (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  questions        TEXT NOT NULL,
  gate_grades      INTEGER NOT NULL DEFAULT 0,
  gate_exams       INTEGER NOT NULL DEFAULT 0,
  share_with_staff INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS survey_courses (
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (survey_id, course_id)
);

CREATE TABLE IF NOT EXISTS survey_responses (
  survey_id    INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers      TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (survey_id, course_id, student_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

// Files attached to a post (lecture notes, announcements) or an assessment (sheet, assignment).
db.exec(`
CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('post','assessment')),
  owner_id   INTEGER NOT NULL,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);
`);

// ───────────── Lightweight migrations for databases created by older versions ─────────────
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('courses', 'grading_scheme', 'TEXT');
addColumn('courses', 'grades_hidden', 'INTEGER NOT NULL DEFAULT 0');
addColumn('courses', 'grades_visible_from', 'TEXT'); // local date the grades unhide automatically
addColumn('departments', 'faculty_id', 'INTEGER REFERENCES faculties(id) ON DELETE SET NULL');

// Databases created before the 'leader' role existed: rebuild users with the wider CHECK
// (SQLite can't alter a CHECK constraint in place).
{
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").pluck().get();
  if (usersSql && !usersSql.includes("'leader'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(usersSql.replace('CREATE TABLE users', 'CREATE TABLE users_new').replace("'student'))", "'student','leader'))"));
      db.exec('INSERT INTO users_new SELECT * FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, department_id, level)');
    })();
    db.pragma('foreign_keys = ON');
  }
}

// Existing single-faculty installs: put departments without a faculty under a default one.
if (db.prepare('SELECT 1 FROM departments WHERE faculty_id IS NULL LIMIT 1').get()) {
  let fid = db.prepare('SELECT id FROM faculties ORDER BY id LIMIT 1').pluck().get();
  if (!fid) fid = Number(db.prepare("INSERT INTO faculties (name, code) VALUES ('كلية الهندسة', 'ENG')").run().lastInsertRowid);
  db.prepare('UPDATE departments SET faculty_id = ? WHERE faculty_id IS NULL').run(fid);
}
addColumn('users', 'section', 'TEXT'); // student's default section, used when enrolling a cohort
addColumn('assessments', 'reminded_at', 'TEXT');
addColumn('attendance_sessions', 'warnings_sent_at', 'TEXT');
addColumn('attendance_records', 'device_id', 'TEXT');
addColumn('attendance_records', 'latitude', 'REAL');
addColumn('attendance_records', 'longitude', 'REAL');
addColumn('attendance_records', 'distance_m', 'REAL');
addColumn('courses', 'geo_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('courses', 'geo_lat', 'REAL');
addColumn('courses', 'geo_lng', 'REAL');
addColumn('courses', 'geo_radius', 'INTEGER NOT NULL DEFAULT 300');
addColumn('courses', 'geo_label', 'TEXT');
addColumn('assessments', 'late_policy', "TEXT NOT NULL DEFAULT 'allow'");
addColumn('assessments', 'grace_hours', 'INTEGER NOT NULL DEFAULT 0');
addColumn('attendance_sessions', 'schedule_id', 'INTEGER REFERENCES course_schedule(id) ON DELETE SET NULL');

export function getSetting(key, factory) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  if (!factory) return null;
  const value = factory();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export const JWT_SECRET = process.env.JWT_SECRET || getSetting('jwt_secret', () => crypto.randomBytes(48).toString('hex'));

// One file per post/assessment used to live on the row itself; move those into attachments.
db.transaction(() => {
  for (const [owner, table, pathCol, nameCol] of [['post', 'posts', 'file_path', 'file_name'], ['assessment', 'assessments', 'attachment_path', 'attachment_name']]) {
    db.prepare(`INSERT INTO attachments (owner_type, owner_id, path, name)
      SELECT '${owner}', id, ${pathCol}, COALESCE(${nameCol}, ${pathCol}) FROM ${table} WHERE ${pathCol} IS NOT NULL`).run();
    db.prepare(`UPDATE ${table} SET ${pathCol} = NULL, ${nameCol} = NULL WHERE ${pathCol} IS NOT NULL`).run();
  }
})();

export default db;

import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import db from '../db.js';
import { examsLock } from '../lib/visibility.js';
import { parse, badRequest, forbidden, notFound, toId } from '../lib/http.js';
import { courseRole } from '../lib/access.js';
import { notify } from '../lib/notify.js';
import { upload, storedName, removeUpload } from '../lib/upload.js';
import { readSheets, parseDate, parseTime } from '../lib/excel.js';
import { currentTerm, termFilter } from '../lib/term.js';
import { nowIso } from '../lib/time.js';

const router = Router();

export const EXAM_KINDS = { midterm: 'ميدترم', final: 'فاينال', practical: 'عملي', oral: 'شفوي' };
const KIND_ALIASES = { ميدترم: 'midterm', 'منتصف الترم': 'midterm', فاينال: 'final', نهائي: 'final', 'نهاية الترم': 'final', عملي: 'practical', شفوي: 'oral' };
/** Midterms use the midterm seating; everything else sits in the final-exam seats. */
const periodOf = (kind) => (kind === 'midterm' ? 'midterm' : 'final');
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'وقت غير صالح');

const examSchema = z.object({
  course_id: z.number().int().positive(),
  kind: z.enum(Object.keys(EXAM_KINDS)),
  exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  start_time: TIME,
  end_time: TIME,
  location: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(500).nullish(),
}).refine((e) => e.end_time > e.start_time, { message: 'وقت النهاية لازم يكون بعد البداية', path: ['end_time'] });

/** Admin manages all exams; a doctor manages the exams of their own courses. */
function assertCanManage(user, courseId) {
  if (user.role === 'admin') return;
  if (courseRole(user, courseId) !== 'doctor') throw forbidden('جدول الامتحانات يعدّله الأدمن أو دكتور المادة');
}

const EXAM_COLUMNS = `x.*, c.name AS course_name, c.code AS course_code, c.department_id, c.level, d.name AS department_name`;

/**
 * The current user's exams. Students see published exams of their courses with their own
 * seat number and hall; staff see every exam of their courses (published or not).
 */
router.get('/me', (req, res) => {
  const { user } = req;
  const t = currentTerm();
  const tf = termFilter();
  if (user.role === 'student') {
    const rows = db.prepare(`
      SELECT ${EXAM_COLUMNS}, st.seat_number, st.hall
      FROM enrollments e JOIN exams x ON x.course_id = e.course_id JOIN courses c ON c.id = x.course_id
      LEFT JOIN departments d ON d.id = c.department_id
      LEFT JOIN exam_seating st ON st.student_id = e.student_id AND st.academic_year = c.academic_year AND st.semester = c.semester
        AND st.period = CASE WHEN x.kind = 'midterm' THEN 'midterm' ELSE 'final' END
      WHERE e.student_id = ? AND x.published = 1 AND ${tf.sql}
      ORDER BY x.exam_date, x.start_time`).all(user.id, ...tf.params);
    // Exams locked behind an unanswered survey show the course only, without date/place/seat.
    const locks = new Map();
    const shown = rows.map((x) => {
      if (!locks.has(x.course_id)) locks.set(x.course_id, examsLock(user.id, x.course_id));
      const lock = locks.get(x.course_id);
      return lock ? { id: x.id, course_id: x.course_id, course_name: x.course_name, course_code: x.course_code, kind: x.kind, locked: lock } : x;
    });
    const seats = t ? db.prepare('SELECT period, seat_number, hall FROM exam_seating WHERE student_id = ? AND academic_year = ? AND semester = ?')
      .all(user.id, t.academic_year, t.semester) : [];
    return res.json({ exams: shown, seats: [...locks.values()].some(Boolean) ? [] : seats });
  }
  const rows = user.role === 'admin'
    ? db.prepare(`SELECT ${EXAM_COLUMNS} FROM exams x JOIN courses c ON c.id = x.course_id LEFT JOIN departments d ON d.id = c.department_id
        WHERE ${tf.sql} ORDER BY x.exam_date, x.start_time`).all(...tf.params)
    : db.prepare(`SELECT ${EXAM_COLUMNS} FROM course_staff cs JOIN exams x ON x.course_id = cs.course_id JOIN courses c ON c.id = x.course_id
        LEFT JOIN departments d ON d.id = c.department_id WHERE cs.user_id = ? AND ${tf.sql} ORDER BY x.exam_date, x.start_time`).all(user.id, ...tf.params);
  const counts = db.prepare('SELECT course_id, COUNT(*) AS n FROM enrollments GROUP BY course_id').all();
  const byCourse = new Map(counts.map((r) => [r.course_id, r.n]));
  res.json({ exams: rows.map((r) => ({ ...r, students: byCourse.get(r.course_id) || 0 })), seats: [] });
});

function insertExam(e, userId) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO exams (course_id, kind, exam_date, start_time, end_time, location, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (course_id, kind, exam_date, start_time) DO UPDATE SET end_time = excluded.end_time, location = excluded.location, notes = excluded.notes`)
    .run(e.course_id, e.kind, e.exam_date, e.start_time, e.end_time, e.location || null, e.notes || null, userId);
  return Number(lastInsertRowid);
}

router.post('/', (req, res) => {
  const e = parse(examSchema, req.body);
  assertCanManage(req.user, e.course_id);
  res.status(201).json({ id: insertExam(e, req.user.id) });
});

function loadExam(req) {
  const x = db.prepare('SELECT * FROM exams WHERE id = ?').get(toId(req.params.id));
  if (!x) throw notFound('الامتحان غير موجود');
  assertCanManage(req.user, x.course_id);
  return x;
}

router.put('/:id', (req, res) => {
  const x = loadExam(req);
  const e = parse(examSchema, req.body);
  assertCanManage(req.user, e.course_id);
  db.prepare(`UPDATE exams SET course_id = ?, kind = ?, exam_date = ?, start_time = ?, end_time = ?, location = ?, notes = ?, reminded_at = NULL WHERE id = ?`)
    .run(e.course_id, e.kind, e.exam_date, e.start_time, e.end_time, e.location || null, e.notes || null, x.id);
  if (x.published) {
    const course = db.prepare('SELECT name FROM courses WHERE id = ?').get(e.course_id);
    const students = db.prepare('SELECT student_id FROM enrollments WHERE course_id = ?').pluck().all(e.course_id);
    notify(students, { type: 'schedule', title: `⚠️ تعديل موعد امتحان ${course.name}`, body: `${EXAM_KINDS[e.kind]} · ${e.exam_date} · ${e.start_time}${e.location ? ` · ${e.location}` : ''}`, link: '/exams' });
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const x = loadExam(req);
  db.prepare('DELETE FROM exams WHERE id = ?').run(x.id);
  res.json({ ok: true });
});

/** Publishes exams (by ids) and sends each affected student one notification. */
router.post('/publish', (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).min(1) }), req.body);
  const exams = ids.map((id) => db.prepare('SELECT * FROM exams WHERE id = ?').get(id)).filter(Boolean);
  exams.forEach((x) => assertCanManage(req.user, x.course_id));
  const fresh = exams.filter((x) => !x.published);
  db.transaction(() => fresh.forEach((x) => db.prepare('UPDATE exams SET published = 1 WHERE id = ?').run(x.id)))();

  const perStudent = new Map();
  for (const x of fresh) {
    for (const sid of db.prepare('SELECT student_id FROM enrollments WHERE course_id = ?').pluck().all(x.course_id)) {
      if (!perStudent.has(sid)) perStudent.set(sid, new Set());
      perStudent.get(sid).add(x.kind);
    }
  }
  for (const [sid, kinds] of perStudent) {
    const label = [...kinds].map((k) => EXAM_KINDS[k]).join(' و');
    notify(sid, { type: 'schedule', title: `📝 نزل جدول امتحانات ${label}`, body: 'اعرف مواعيد امتحاناتك ورقم جلوسك ومكان اللجنة', link: '/exams' });
  }
  res.json({ published: fresh.length, students: perStudent.size });
});

// ───────────── Excel: timetable + seating ─────────────
const SHEET_EXAMS = 'جدول الامتحانات';
const SHEET_SEATS = 'أرقام الجلوس';

router.get('/template.xlsx', async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden();
  const t = currentTerm();
  const courses = t ? db.prepare('SELECT code, name FROM courses WHERE academic_year = ? AND semester = ? ORDER BY code').all(t.academic_year, t.semester) : [];
  const wb = new ExcelJS.Workbook();
  const style = (ws, cols) => {
    ws.columns = cols.map(([h, w]) => ({ header: h, width: w }));
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    ws.getRow(1).height = 26;
    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3FA8' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  };
  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  [
    ['📝 جدول الامتحانات وأرقام الجلوس', true],
    [`شيت "${SHEET_EXAMS}": صف لكل امتحان مادة. اختار كود المادة ونوع الامتحان من القائمة، والتاريخ بصيغة 2027-01-12 أو 12/1/2027، والوقت زي 9:00 أو 13:30.`],
    ['كل طلاب المادة هيشوفوا الموعد والمكان تلقائياً بعد ما تضغط "نشر".'],
    [`شيت "${SHEET_SEATS}" (اختياري): رقم جلوس ولجنة كل طالب — لو اتملى، كل طالب هيشوف رقم جلوسه ولجنته جنب كل امتحان.`],
    ['وأنت بترفع الملف هتختار أرقام الجلوس دي للميدترم ولا للفاينال.'],
  ].forEach(([text, bold]) => { help.addRow([text]).font = { name: 'Arial', bold: !!bold, size: bold ? 14 : 11 }; });

  const exams = wb.addWorksheet(SHEET_EXAMS);
  style(exams, [['كود المادة *', 16], ['اسم المادة', 32], ['النوع *', 12], ['التاريخ *', 14], ['من *', 10], ['إلى *', 10], ['المكان', 22], ['ملاحظات', 30]]);
  const seats = wb.addWorksheet(SHEET_SEATS);
  style(seats, [['الكود الجامعي *', 16], ['اسم الطالب', 30], ['رقم الجلوس *', 14], ['اللجنة / المكان', 22]]);
  const lists = wb.addWorksheet('قوائم', { state: 'hidden' });
  courses.forEach((c, i) => { lists.getCell(`A${i + 1}`).value = c.code; lists.getCell(`B${i + 1}`).value = c.name; });
  Object.values(EXAM_KINDS).forEach((k, i) => { lists.getCell(`C${i + 1}`).value = k; });
  for (let r = 2; r <= 1000; r++) {
    if (courses.length) {
      exams.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`'قوائم'!$A$1:$A$${courses.length}`] };
      exams.getCell(`B${r}`).value = { formula: `IFERROR(VLOOKUP(A${r},'قوائم'!$A$1:$B$${courses.length},2,FALSE),"")` };
    }
    exams.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`'قوائم'!$C$1:$C$4`] };
  }
  seats.getColumn(1).numFmt = '@';
  seats.getColumn(3).numFmt = '@';
  wb.views = [{ activeTab: 1 }];
  res.attachment('exam-timetable-template.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

const pick = (values, ...names) => {
  for (const n of names) if (values[n] !== undefined && values[n] !== '') return values[n];
  return '';
};

/** Imports the exam timetable and/or seat numbers from the template. */
router.post('/import', upload.single('file'), async (req, res) => {
  let sheets;
  try {
    if (req.user.role !== 'admin') throw forbidden();
    if (!req.file) throw badRequest('ارفع ملف الـ Excel');
    sheets = await readSheets(req.file.path, { skip: ['تعليمات', 'قوائم'] });
  } finally {
    if (req.file) removeUpload(storedName(req.file));
  }
  const { period } = parse(z.object({ period: z.enum(['midterm', 'final']).default('final') }), req.body);
  const t = currentTerm();
  if (!t) throw badRequest('حدد الترم الحالي أولاً');
  const courseByCode = new Map(db.prepare('SELECT id, code FROM courses WHERE academic_year = ? AND semester = ?')
    .all(t.academic_year, t.semester).map((c) => [c.code.toUpperCase(), c.id]));
  const studentByCode = new Map(db.prepare("SELECT id, username FROM users WHERE role = 'student'").all().map((u) => [u.username.toLowerCase(), u.id]));
  const errors = [];
  const created = [];
  let seated = 0;

  db.transaction(() => {
    for (const { row, values } of sheets[SHEET_EXAMS] || []) {
      const err = (msg) => errors.push({ sheet: SHEET_EXAMS, row, error: msg });
      const code = String(pick(values, 'كود المادة', 'course_code')).trim().toUpperCase();
      const courseId = courseByCode.get(code);
      if (!courseId) { err(`كود مادة غير موجود في الترم الحالي: ${code || '—'}`); continue; }
      const kindRaw = String(pick(values, 'النوع', 'kind')).trim();
      const kind = KIND_ALIASES[kindRaw] || (EXAM_KINDS[kindRaw] ? kindRaw : null);
      if (!kind) { err(`نوع امتحان غير معروف: ${kindRaw || '—'}`); continue; }
      const exam = examSchema.safeParse({
        course_id: courseId, kind, exam_date: parseDate(pick(values, 'التاريخ', 'date')),
        start_time: parseTime(pick(values, 'من', 'start')), end_time: parseTime(pick(values, 'إلى', 'الى', 'end')),
        location: String(pick(values, 'المكان', 'location')) || null, notes: String(pick(values, 'ملاحظات', 'notes')) || null,
      });
      if (!exam.success) { err(exam.error.issues[0].message); continue; }
      created.push(insertExam(exam.data, req.user.id));
    }
    const upsertSeat = db.prepare(`INSERT INTO exam_seating (academic_year, semester, period, student_id, seat_number, hall) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (academic_year, semester, period, student_id) DO UPDATE SET seat_number = excluded.seat_number, hall = excluded.hall`);
    for (const { row, values } of sheets[SHEET_SEATS] || []) {
      const code = String(pick(values, 'الكود الجامعي', 'الكود', 'code')).trim().toLowerCase();
      const sid = studentByCode.get(code);
      const seat = String(pick(values, 'رقم الجلوس', 'seat')).trim();
      if (!sid) { errors.push({ sheet: SHEET_SEATS, row, error: `كود طالب غير موجود: ${code || '—'}` }); continue; }
      if (!seat) { errors.push({ sheet: SHEET_SEATS, row, error: 'رقم الجلوس فاضي' }); continue; }
      upsertSeat.run(t.academic_year, t.semester, period, sid, seat, String(pick(values, 'اللجنة / المكان', 'اللجنة', 'المكان', 'hall')).trim() || null);
      seated += 1;
    }
  })();
  res.json({ exams: created.length, seats: seated, errors });
});

router.get('/seating', (req, res) => {
  if (req.user.role !== 'admin') throw forbidden();
  const { period } = parse(z.object({ period: z.enum(['midterm', 'final']) }), req.query);
  const t = currentTerm();
  if (!t) return res.json([]);
  res.json(db.prepare(`SELECT s.*, u.name, u.username FROM exam_seating s JOIN users u ON u.id = s.student_id
    WHERE s.academic_year = ? AND s.semester = ? AND s.period = ? ORDER BY s.seat_number`).all(t.academic_year, t.semester, period));
});

router.delete('/seating', (req, res) => {
  if (req.user.role !== 'admin') throw forbidden();
  const { period } = parse(z.object({ period: z.enum(['midterm', 'final']) }), req.query);
  const t = currentTerm();
  if (t) db.prepare('DELETE FROM exam_seating WHERE academic_year = ? AND semester = ? AND period = ?').run(t.academic_year, t.semester, period);
  res.json({ ok: true });
});

/** Scheduler hook: the evening before each exam, remind students (with their seat & hall). */
export function examReminders(now) {
  if (now.minutes < 18 * 60) return;
  const tomorrow = new Date(`${now.date}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = tomorrow.toISOString().slice(0, 10);
  const due = db.prepare(`SELECT x.*, c.name AS course_name, c.academic_year, c.semester FROM exams x JOIN courses c ON c.id = x.course_id
    WHERE x.published = 1 AND x.reminded_at IS NULL AND x.exam_date = ?`).all(day);
  for (const x of due) {
    const students = db.prepare(`
      SELECT e.student_id, st.seat_number, st.hall FROM enrollments e
      LEFT JOIN exam_seating st ON st.student_id = e.student_id AND st.academic_year = ? AND st.semester = ? AND st.period = ?
      WHERE e.course_id = ?`).all(x.academic_year, x.semester, periodOf(x.kind), x.course_id);
    for (const s of students) {
      const where = s.hall || x.location;
      notify(s.student_id, {
        type: 'schedule', title: `📝 بكرة امتحان ${EXAM_KINDS[x.kind]} ${x.course_name}`,
        body: [`الساعة ${x.start_time}`, where && `المكان: ${where}`, s.seat_number && `رقم الجلوس: ${s.seat_number}`].filter(Boolean).join(' · '),
        link: '/exams',
      });
    }
    db.prepare('UPDATE exams SET reminded_at = ? WHERE id = ?').run(nowIso(), x.id);
  }
}

export default router;

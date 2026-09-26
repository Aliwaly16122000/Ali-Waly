import ExcelJS from 'exceljs';
import db from '../db.js';
import { HttpError } from './http.js';
import { parseTime } from './excel.js';
import { toMinutes } from './clock.js';

/**
 * Department teaching plan: one workbook that creates a department's courses for a term,
 * links their doctors/TAs and builds the weekly timetable. Sheets:
 *   الدكاترة / المعيدين — staff accounts (same columns as the users template; existing usernames are kept as is)
 *   المواد             — one row per course
 *   الجدول             — one row per weekly slot
 * The whole file is applied in one transaction: any error and nothing changes.
 */

export const PLAN_SHEETS = { staff: ['الدكاترة', 'المعيدين'], courses: 'المواد', schedule: 'الجدول' };

const COURSE_COLS = [['كود المادة *', 16], ['اسم المادة *', 38], ['القسم *', 34], ['الفرقة *', 20], ['الساعات', 9], ['الدكاترة', 40], ['المعيدين', 40]];
const SLOT_COLS = [['كود المادة *', 16], ['النوع *', 10], ['اليوم *', 11], ['من *', 9], ['إلى *', 9], ['المكان', 14], ['السكشن', 10], ['المسؤول', 22], ['الحضور', 10], ['ملاحظات', 40]];
const STAFF_COLS = [['الاسم بالكامل *', 34], ['اسم المستخدم *', 24], ['القسم', 34], ['البريد', 26], ['الموبايل', 16], ['كلمة السر', 14]];

const KINDS = { محاضرة: 'lecture', سكشن: 'section', تمارين: 'section', تمرين: 'section', معمل: 'lab', عملي: 'lab', lecture: 'lecture', section: 'section', lab: 'lab' };
const DAYS = { الأحد: 0, الاحد: 0, الإثنين: 1, الاثنين: 1, الثلاثاء: 2, الأربعاء: 3, الاربعاء: 3, الخميس: 4, الجمعة: 5, السبت: 6 };
const MODES = { تذكير: 'remind', تلقائي: 'auto', بدون: 'off', remind: 'remind', auto: 'auto', off: 'off' };
const LEVELS = { 'الإعدادية': 0, 'الاعدادية': 0, 'الأولى': 1, 'الثانية': 2, 'الثالثة': 3, 'الرابعة': 4, 'الخامسة': 5 };
export const LEVEL_OPTIONS = ['0 - الإعدادية', '1 - الفرقة الأولى', '2 - الفرقة الثانية', '3 - الفرقة الثالثة', '4 - الفرقة الرابعة', '5 - الفرقة الخامسة'];

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const list = (v) => text(v).split(/[,،;\n]+/).map((s) => s.trim()).filter(Boolean);

function parseLevel(v) {
  const t = text(v);
  const lead = t.match(/^(\d)(\s|-|$)/);
  if (lead) return Number(lead[1]);
  const hit = Object.entries(LEVELS).find(([k]) => t.replace(/^الفرقة\s+/, '').startsWith(k));
  return hit ? hit[1] : null;
}

/**
 * "CIV" / "CIV - الهندسة المدنية" → department id. An unknown code that comes with a name
 * ("CIVCH - مدني ساعات معتمدة") creates the department in the faculty of `sibling` (or the first one).
 */
function resolveDepartment(value, createdDepts) {
  const [code, ...rest] = text(value).split(' - ');
  const name = rest.join(' - ').trim();
  const c = code.trim().toUpperCase();
  if (!c) return { error: 'القسم مطلوب' };
  const hit = db.prepare('SELECT id FROM departments WHERE upper(code) = ? OR name = ?').pluck().get(c, text(value));
  if (hit) return { id: hit };
  if (!name) return { error: `قسم غير معروف: ${c} — اكتب "الكود - الاسم" لإنشائه` };
  const facultyId = db.prepare("SELECT faculty_id FROM departments WHERE faculty_id IS NOT NULL AND upper(code) LIKE ? || '%' LIMIT 1").pluck().get(c.slice(0, 3))
    ?? db.prepare('SELECT id FROM faculties ORDER BY id LIMIT 1').pluck().get() ?? null;
  const { lastInsertRowid } = db.prepare('INSERT INTO departments (name, code, faculty_id) VALUES (?, ?, ?)').run(name, c, facultyId);
  createdDepts.push({ code: c, name });
  return { id: Number(lastInsertRowid) };
}

/**
 * Applies a plan read with readSheets(). `importUsers` is the admin users importer
 * (rows → { created, errors }). Returns a summary; throws 400 with every row error otherwise.
 */
export function applyPlan(sheets, { term, importUsers }) {
  const coursesRows = sheets[PLAN_SHEETS.courses] || [];
  const slotRows = sheets[PLAN_SHEETS.schedule] || [];
  if (!coursesRows.length && !slotRows.length) throw new HttpError(400, 'الملف مفيهوش شيت "المواد" أو "الجدول" — استخدم نموذج خطة القسم');
  if (!term) throw new HttpError(400, 'حدد الترم الحالي الأول من إعدادات النظام');

  const errors = [];
  const err = (sheet, row, error) => errors.push({ sheet, row, error });
  const summary = { departments: [], courses_created: 0, courses_updated: 0, staff_links: 0, slots: 0, created: [], skipped_users: 0 };

  const run = db.transaction(() => {
    // 1) Staff accounts. Usernames that already exist are left untouched (no duplicate error).
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?');
    const staffRows = [];
    for (const sheet of PLAN_SHEETS.staff) {
      for (const r of sheets[sheet] || []) {
        const username = text(r.values['اسم المستخدم']);
        if (username && exists.get(username)) { summary.skipped_users++; continue; }
        staffRows.push({ ...r.values, __row: r.row, __sheet: sheet, __role: sheet === 'الدكاترة' ? 'doctor' : 'ta' });
      }
    }
    if (staffRows.length) {
      const res = importUsers(staffRows);
      summary.created = res.created;
      errors.push(...res.errors);
    }

    // 2) Courses (matched by code within the term → updated, otherwise created) + staff links.
    const userByName = db.prepare('SELECT id, role FROM users WHERE username = ?');
    const findCourse = db.prepare('SELECT id FROM courses WHERE upper(code) = ? AND academic_year = ? AND semester = ?').pluck();
    const insCourse = db.prepare(`INSERT INTO courses (code, name, department_id, level, semester, academic_year, credit_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const updCourse = db.prepare('UPDATE courses SET name = ?, department_id = ?, level = ?, credit_hours = ? WHERE id = ?');
    const link = db.prepare('INSERT OR IGNORE INTO course_staff (course_id, user_id, role) VALUES (?, ?, ?)');
    const courseIds = new Map();
    const newStaff = new Map(); // courseId → user ids newly linked (for notifications)
    const addStaff = (courseId, userId, role) => {
      if (link.run(courseId, userId, role).changes) {
        summary.staff_links++;
        newStaff.set(courseId, [...(newStaff.get(courseId) || []), userId]);
      }
    };
    for (const { row, values } of coursesRows) {
      const S = PLAN_SHEETS.courses;
      const code = text(values['كود المادة']).toUpperCase();
      const name = text(values['اسم المادة']);
      if (!code || !name) { err(S, row, 'كود المادة واسمها مطلوبين'); continue; }
      if (courseIds.has(code)) { err(S, row, `الكود ${code} متكرر في الملف`); continue; }
      const dept = resolveDepartment(values['القسم'], summary.departments);
      if (dept.error) { err(S, row, dept.error); continue; }
      const level = parseLevel(values['الفرقة']);
      if (level === null) { err(S, row, `فرقة غير مفهومة: ${text(values['الفرقة'])}`); continue; }
      const hours = values['الساعات'] === '' || values['الساعات'] === undefined ? 3 : Number(values['الساعات']);
      if (!Number.isInteger(hours) || hours < 0 || hours > 12) { err(S, row, 'عدد الساعات غير صحيح'); continue; }
      let id = findCourse.get(code, term.academic_year, term.semester);
      if (id) { updCourse.run(name, dept.id, level, hours, id); summary.courses_updated++; } else {
        id = Number(insCourse.run(code, name, dept.id, level, term.semester, term.academic_year, hours).lastInsertRowid);
        summary.courses_created++;
      }
      courseIds.set(code, id);
      for (const [col, role] of [['الدكاترة', 'doctor'], ['المعيدين', 'ta']]) {
        for (const username of list(values[col])) {
          const u = userByName.get(username);
          if (!u) { err(S, row, `مستخدم غير موجود: ${username}`); continue; }
          if (u.role !== role) { err(S, row, `${username} مش ${role === 'doctor' ? 'دكتور' : 'معيد'}`); continue; }
          addStaff(id, u.id, role);
        }
      }
    }

    // 3) Timetable: every course that has rows here gets its weekly slots replaced by the file's.
    const S = PLAN_SHEETS.schedule;
    const slots = [];
    for (const { row, values } of slotRows) {
      const code = text(values['كود المادة']).toUpperCase();
      const courseId = courseIds.get(code) ?? findCourse.get(code, term.academic_year, term.semester);
      if (!courseId) { err(S, row, `مادة غير موجودة في الترم الحالي: ${code}`); continue; }
      const kind = KINDS[text(values['النوع'])];
      if (!kind) { err(S, row, `نوع غير معروف: ${text(values['النوع'])} (محاضرة / سكشن / معمل)`); continue; }
      const day = DAYS[text(values['اليوم'])];
      if (day === undefined) { err(S, row, `يوم غير معروف: ${text(values['اليوم'])}`); continue; }
      const start = parseTime(values['من']);
      const end = parseTime(values['إلى']);
      if (!start || !end || toMinutes(end) <= toMinutes(start)) { err(S, row, 'وقت البداية/النهاية غير صحيح'); continue; }
      const modeText = text(values['الحضور']);
      const mode = modeText ? MODES[modeText] : 'remind';
      if (!mode) { err(S, row, `وضع الحضور غير معروف: ${modeText} (تذكير / تلقائي / بدون)`); continue; }
      let staffId = null;
      const username = text(values['المسؤول']);
      if (username) {
        const u = userByName.get(username);
        if (!u || !['doctor', 'ta'].includes(u.role)) { err(S, row, `المسؤول غير موجود أو مش دكتور/معيد: ${username}`); continue; }
        addStaff(courseId, u.id, u.role);
        staffId = u.id;
      }
      slots.push([courseId, kind, day, start, end, text(values['المكان']) || null, text(values['السكشن']) || null, staffId, mode]);
    }
    if (errors.length) throw new HttpError(400, `في ${errors.length} خطأ في الملف — مفيش أي تغيير اتعمل`, { errors });

    const del = db.prepare('DELETE FROM course_schedule WHERE course_id = ?');
    for (const id of new Set(slots.map((s) => s[0]))) del.run(id);
    const ins = db.prepare(`INSERT INTO course_schedule (course_id, kind, day_of_week, start_time, end_time, location, section, staff_id, attendance_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    slots.forEach((s) => ins.run(...s));
    summary.slots = slots.length;
    return newStaff;
  });

  const newStaff = run();
  return { summary, newStaff };
}

/** Empty plan workbook with instructions and dropdowns. */
export async function planTemplate() {
  const depts = db.prepare('SELECT code, name FROM departments ORDER BY name').all();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EngPortal';
  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 120;
  [
    ['📋 خطة القسم — ملف واحد ينزّل مواد القسم وهيئة التدريس والجدول الأسبوعي', true],
    ['1) شيت "الدكاترة" و"المعيدين": الحسابات الجديدة (اسم المستخدم بالإنجليزي). لو اسم المستخدم موجود قبل كده بيتساب زي ما هو.'],
    ['2) شيت "المواد": كل صف مادة. الكود لازم يكون مختلف لكل مادة. القسم يتكتب "الكود - الاسم" (لو القسم مش موجود بيتعمل تلقائياً).'],
    ['   عمود الدكاترة/المعيدين: أسماء المستخدمين مفصولة بفاصلة (مثلاً: d.ahmed, d.sara).'],
    ['3) شيت "الجدول": كل صف = محاضرة أو سكشن أسبوعي. النوع: محاضرة / سكشن / معمل. اليوم: الأحد … الخميس. الوقت مثل 8:30 أو 13:45.'],
    ['   السكشن اختياري: لو كتبته (مثلاً 1 أو 2) التذكير والحضور بيروحوا لطلبة السكشن ده بس — لازم يطابق عمود السكشن في بيانات الطلاب.'],
    ['   الحضور: تذكير (الدكتور يتفكّر يفتح QR) / تلقائي (QR يفتح لوحده) / بدون.'],
    ['4) المواد بتتسجل في الترم الحالي. الجدول بتاع أي مادة في الملف بيتبدل بالكامل بالجدول اللي في الملف، فتقدر تعدل وترفع تاني.'],
    ['5) لو في أي خطأ مفيش حاجة بتتغير، وبيظهرلك رقم الصف والمشكلة.'],
    ['6) بعد الرفع: سجّل الطلبة في المواد من "إدارة المادة ← تسجيل دفعة كاملة".'],
  ].forEach(([t, bold]) => { const r = help.addRow([t]); r.font = { name: 'Arial', bold: !!bold, size: bold ? 14 : 11 }; });

  const sheet = (name, cols) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map(([h, w]) => ({ header: h, width: w }));
    ws.getRow(1).height = 24;
    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3FA8' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    return ws;
  };
  const doctors = sheet('الدكاترة', STAFF_COLS);
  const tas = sheet('المعيدين', STAFF_COLS);
  const courses = sheet('المواد', COURSE_COLS);
  const schedule = sheet('الجدول', SLOT_COLS);
  const lists = wb.addWorksheet('القوائم', { state: 'hidden' });
  const columns = [
    ['القسم', depts.map((d) => `${d.code} - ${d.name}`)], ['الفرقة', LEVEL_OPTIONS], ['النوع', ['محاضرة', 'سكشن', 'معمل']],
    ['اليوم', ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس']], ['الحضور', ['تذكير', 'تلقائي', 'بدون']],
  ];
  columns.forEach(([h, values], i) => {
    const col = String.fromCharCode(65 + i);
    lists.getCell(`${col}1`).value = h;
    values.forEach((v, j) => { lists.getCell(`${col}${j + 2}`).value = v; });
  });
  const validate = (ws, col, listCol, count, strict = true) => {
    for (let r = 2; r <= 1000; r++) {
      ws.getCell(`${col}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`'القوائم'!$${listCol}$2:$${listCol}$${Math.max(2, count + 1)}`], showErrorMessage: strict,
      };
    }
  };
  if (depts.length) [doctors, tas].forEach((ws) => validate(ws, 'C', 'A', depts.length));
  if (depts.length) validate(courses, 'C', 'A', depts.length, false); // a new "CODE - name" is allowed
  validate(courses, 'D', 'B', LEVEL_OPTIONS.length);
  validate(schedule, 'B', 'C', 3);
  validate(schedule, 'C', 'D', 6);
  validate(schedule, 'I', 'E', 3);
  [doctors, tas].forEach((ws) => { ws.getColumn(2).numFmt = '@'; ws.getColumn(5).numFmt = '@'; });
  [schedule.getColumn(4), schedule.getColumn(5), schedule.getColumn(7)].forEach((c) => { c.numFmt = '@'; });
  return wb;
}

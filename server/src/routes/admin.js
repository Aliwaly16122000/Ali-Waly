import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../db.js';
import { parse, badRequest, notFound, toId } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { notify } from '../lib/notify.js';
import { listTerms, setCurrentTerm, setTermDates, termInfo } from '../lib/term.js';
import { backupPath, listBackups, runBackup } from '../lib/backup.js';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upload, storedName, removeUpload } from '../lib/upload.js';

const router = Router();
router.use(requireRole('admin'));

const ROLES = ['admin', 'doctor', 'ta', 'student', 'leader'];

/** Readable temporary password without ambiguous characters. */
export function generatePassword(len = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const isUnique = (err) => err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';

// ───────────── Overview ─────────────
router.get('/overview', (_req, res) => {
  const count = (sql, ...a) => db.prepare(sql).pluck().get(...a);
  res.json({
    faculties: count('SELECT COUNT(*) FROM faculties'),
    departments: count('SELECT COUNT(*) FROM departments'),
    courses: count('SELECT COUNT(*) FROM courses'),
    students: count("SELECT COUNT(*) FROM users WHERE role = 'student'"),
    doctors: count("SELECT COUNT(*) FROM users WHERE role = 'doctor'"),
    tas: count("SELECT COUNT(*) FROM users WHERE role = 'ta'"),
    enrollments: count('SELECT COUNT(*) FROM enrollments'),
    by_department: db.prepare(`
      SELECT d.id, d.name, d.code,
        (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'student') AS students,
        (SELECT COUNT(*) FROM courses c WHERE c.department_id = d.id) AS courses
      FROM departments d ORDER BY d.name`).all(),
  });
});

// ───────────── Academic term ─────────────
router.get('/term', (_req, res) => res.json({ current: termInfo(), terms: listTerms() }));

router.put('/term', (req, res) => {
  const t = parse(z.object({
    academic_year: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'السنة الدراسية بصيغة 2026/2027'),
    semester: z.enum(['fall', 'spring', 'summer']),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  }).refine((v) => !v.start_date || !v.end_date || v.end_date > v.start_date, 'تاريخ نهاية الترم لازم يكون بعد بدايته'), req.body);
  setCurrentTerm(t);
  if (t.start_date && t.end_date) setTermDates(t, t.start_date, t.end_date);
  res.json({ ok: true });
});

/**
 * Starts a new term by copying selected courses with their staff, timetable and attendance
 * settings (no students, assessments or grades) into the target term.
 */
router.post('/term/clone', (req, res) => {
  const b = parse(z.object({
    course_ids: z.array(z.number().int().positive()).min(1),
    academic_year: z.string().trim().regex(/^\d{4}\/\d{4}$/),
    semester: z.enum(['fall', 'spring', 'summer']),
  }), req.body);
  const created = [];
  const skipped = [];
  db.transaction(() => {
    for (const id of b.course_ids) {
      const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
      if (!c) continue;
      const exists = db.prepare('SELECT 1 FROM courses WHERE code = ? AND academic_year = ? AND semester = ?').get(c.code, b.academic_year, b.semester);
      if (exists) { skipped.push(c.code); continue; }
      const newId = Number(db.prepare(`
        INSERT INTO courses (code, name, department_id, level, semester, academic_year, credit_hours, description,
          geo_enabled, geo_lat, geo_lng, geo_radius, geo_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.code, c.name, c.department_id, c.level, b.semester, b.academic_year,
        c.credit_hours, c.description, c.geo_enabled, c.geo_lat, c.geo_lng, c.geo_radius, c.geo_label).lastInsertRowid);
      db.prepare('INSERT INTO course_staff (course_id, user_id, role) SELECT ?, user_id, role FROM course_staff WHERE course_id = ?').run(newId, id);
      db.prepare(`INSERT INTO course_schedule (course_id, kind, day_of_week, start_time, end_time, location, section, staff_id,
          remind_before, attendance_mode, attendance_offset, attendance_duration)
        SELECT ?, kind, day_of_week, start_time, end_time, location, section, staff_id, remind_before, attendance_mode,
          attendance_offset, attendance_duration FROM course_schedule WHERE course_id = ?`).run(newId, id);
      created.push({ id: newId, code: c.code });
    }
  })();
  res.json({ created, skipped });
});

// ───────────── Backups ─────────────
router.get('/backups', (_req, res) => res.json(listBackups()));

router.post('/backups', async (_req, res) => {
  res.json(await runBackup());
});

router.get('/backups/:name', (req, res) => {
  const file = backupPath(req.params.name);
  if (!file) throw notFound('النسخة غير موجودة');
  res.download(file);
});

// ───────────── Departments ─────────────
const deptSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(1).max(12).toUpperCase(),
  faculty_id: z.number().int().positive().nullish(),
});

router.get('/departments', (_req, res) => {
  res.json(db.prepare(`
    SELECT d.*, f.name AS faculty_name,
           (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'student') AS students,
           (SELECT COUNT(*) FROM courses c WHERE c.department_id = d.id) AS courses,
           (SELECT group_concat(u.name, '، ') FROM oversight o JOIN users u ON u.id = o.user_id
              WHERE o.scope = 'department' AND o.scope_id = d.id) AS heads
    FROM departments d LEFT JOIN faculties f ON f.id = d.faculty_id ORDER BY f.name, d.name`).all());
});

router.post('/departments', (req, res) => {
  const d = parse(deptSchema, req.body);
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO departments (name, code, faculty_id) VALUES (?, ?, ?)').run(d.name, d.code, d.faculty_id ?? null);
    res.status(201).json({ id: Number(lastInsertRowid) });
  } catch (err) {
    if (isUnique(err)) throw badRequest('كود القسم مستخدم بالفعل');
    throw err;
  }
});

router.put('/departments/:id', (req, res) => {
  const d = parse(deptSchema, req.body);
  try {
    const r = db.prepare('UPDATE departments SET name = ?, code = ?, faculty_id = ? WHERE id = ?').run(d.name, d.code, d.faculty_id ?? null, toId(req.params.id));
    if (!r.changes) throw notFound();
  } catch (err) {
    if (isUnique(err)) throw badRequest('كود القسم مستخدم بالفعل');
    throw err;
  }
  res.json({ ok: true });
});

router.delete('/departments/:id', (req, res) => {
  const id = toId(req.params.id);
  db.transaction(() => {
    db.prepare("DELETE FROM oversight WHERE scope = 'department' AND scope_id = ?").run(id);
    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

// ───────────── Faculties ─────────────
const facultySchema = z.object({ name: z.string().trim().min(2, 'اسم الكلية قصير'), code: z.string().trim().min(1).max(12).toUpperCase() });

router.get('/faculties', (_req, res) => {
  res.json(db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM departments d WHERE d.faculty_id = f.id) AS departments,
      (SELECT COUNT(*) FROM users u JOIN departments d ON d.id = u.department_id WHERE d.faculty_id = f.id AND u.role = 'student') AS students,
      (SELECT group_concat(u.name, '، ') FROM oversight o JOIN users u ON u.id = o.user_id WHERE o.scope = 'faculty' AND o.scope_id = f.id) AS deans
    FROM faculties f ORDER BY f.name`).all());
});

router.post('/faculties', (req, res) => {
  const f = parse(facultySchema, req.body);
  try {
    res.status(201).json({ id: Number(db.prepare('INSERT INTO faculties (name, code) VALUES (?, ?)').run(f.name, f.code).lastInsertRowid) });
  } catch (err) {
    if (isUnique(err)) throw badRequest('كود الكلية مستخدم بالفعل');
    throw err;
  }
});

router.put('/faculties/:id', (req, res) => {
  const f = parse(facultySchema, req.body);
  try {
    if (!db.prepare('UPDATE faculties SET name = ?, code = ? WHERE id = ?').run(f.name, f.code, toId(req.params.id)).changes) throw notFound();
  } catch (err) {
    if (isUnique(err)) throw badRequest('كود الكلية مستخدم بالفعل');
    throw err;
  }
  res.json({ ok: true });
});

/** Deleting a faculty keeps its departments (they become unassigned) — nothing else is lost. */
router.delete('/faculties/:id', (req, res) => {
  const id = toId(req.params.id);
  db.transaction(() => {
    db.prepare("DELETE FROM oversight WHERE scope = 'faculty' AND scope_id = ?").run(id);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

// ───────────── Leadership (read-only follow-up rights) ─────────────
router.get('/oversight', (_req, res) => {
  res.json(db.prepare(`
    SELECT o.*, u.name, u.username, u.role,
      CASE o.scope WHEN 'department' THEN d.name WHEN 'faculty' THEN f.name ELSE 'الجامعة' END AS scope_name
    FROM oversight o JOIN users u ON u.id = o.user_id
    LEFT JOIN departments d ON o.scope = 'department' AND d.id = o.scope_id
    LEFT JOIN faculties f ON o.scope = 'faculty' AND f.id = o.scope_id
    ORDER BY CASE o.scope WHEN 'university' THEN 0 WHEN 'faculty' THEN 1 ELSE 2 END, scope_name`).all());
});

const DEFAULT_TITLES = { department: 'رئيس القسم', faculty: 'عميد الكلية', university: 'رئيس الجامعة' };

router.post('/oversight', (req, res) => {
  const o = parse(z.object({
    user_id: z.number().int().positive(),
    scope: z.enum(['department', 'faculty', 'university']),
    scope_id: z.number().int().min(0).default(0),
    title: z.string().trim().max(60).nullish(),
  }), req.body);
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(o.user_id);
  if (!user) throw notFound('المستخدم غير موجود');
  if (user.role === 'student') throw badRequest('لا يمكن إعطاء صلاحية متابعة لطالب');
  const table = { department: 'departments', faculty: 'faculties' }[o.scope];
  if (table && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(o.scope_id)) throw badRequest('اختر القسم أو الكلية');
  const scopeId = o.scope === 'university' ? 0 : o.scope_id;
  db.prepare(`INSERT INTO oversight (user_id, scope, scope_id, title) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, scope, scope_id) DO UPDATE SET title = excluded.title`).run(o.user_id, o.scope, scopeId, o.title || DEFAULT_TITLES[o.scope]);
  notify(o.user_id, { type: 'course', title: `تم تعيينك: ${o.title || DEFAULT_TITLES[o.scope]}`, body: 'تقدر تتابع الإحصائيات من "لوحة المتابعة"', link: '/oversight' });
  res.status(201).json({ ok: true });
});

router.delete('/oversight', (req, res) => {
  const o = parse(z.object({ user_id: z.coerce.number().int().positive(), scope: z.enum(['department', 'faculty', 'university']), scope_id: z.coerce.number().int().min(0) }), req.query);
  db.prepare('DELETE FROM oversight WHERE user_id = ? AND scope = ? AND scope_id = ?').run(o.user_id, o.scope, o.scope_id);
  res.json({ ok: true });
});

// ───────────── Users ─────────────
router.get('/users', (req, res) => {
  const { role, department_id, level, q } = req.query;
  const where = [];
  const args = [];
  if (role && ROLES.includes(role)) { where.push('u.role = ?'); args.push(role); }
  if (department_id) { where.push('u.department_id = ?'); args.push(Number(department_id)); }
  if (level !== undefined && level !== '') { where.push('u.level = ?'); args.push(Number(level)); }
  if (q) { where.push('(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.email, u.phone, u.role, u.department_id, u.level, u.section,
           u.is_active, u.must_change_password, u.last_login_at, u.created_at, d.name AS department_name,
           sd.bound_at AS device_bound_at, sd.label AS device_label
    FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN student_devices sd ON sd.user_id = u.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY u.role, u.name LIMIT 2000`).all(...args);
  res.json(rows);
});

const userSchema = z.object({
  name: z.string().trim().min(2, 'الاسم قصير جداً'),
  username: z.string().trim().min(3, 'اسم المستخدم قصير جداً').max(60).regex(/^[\w.@-]+$/, 'اسم المستخدم يحتوي على رموز غير مسموحة'),
  email: z.string().trim().email().or(z.literal('')).nullish(),
  phone: z.string().trim().max(30).nullish(),
  role: z.enum(ROLES),
  department_id: z.coerce.number().int().positive().nullish(),
  level: z.coerce.number().int().min(0).max(5).nullish(),
  section: z.coerce.string().trim().max(20).nullish(),
  password: z.string().min(6, 'كلمة المرور يجب ألا تقل عن 6 أحرف').optional().or(z.literal('')),
  is_active: z.boolean().optional(),
});

function createUser(u) {
  const password = u.password || generatePassword();
  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (name, username, email, phone, role, department_id, level, section, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    u.name, u.username, u.email || null, u.phone || null, u.role,
    u.department_id ?? null, u.role === 'student' ? (u.level ?? null) : null, u.role === 'student' ? (u.section || null) : null, hash,
  );
  return { id: Number(lastInsertRowid), password };
}

router.post('/users', (req, res) => {
  const u = parse(userSchema, req.body);
  try {
    res.status(201).json(createUser(u));
  } catch (err) {
    if (isUnique(err)) throw badRequest('اسم المستخدم مستخدم بالفعل');
    throw err;
  }
});

// Column headers accepted when importing (Arabic or English).
const HEADER_ALIASES = {
  name: ['name', 'الاسم', 'اسم الطالب', 'الاسم بالكامل'],
  username: ['username', 'code', 'الكود', 'كود الطالب', 'الكود الجامعي', 'اسم المستخدم', 'رقم الجلوس'],
  department: ['department', 'department_code', 'القسم', 'كود القسم'],
  level: ['level', 'الفرقة', 'السنة', 'المستوى'],
  email: ['email', 'البريد', 'البريد الإلكتروني', 'الايميل'],
  phone: ['phone', 'الموبايل', 'الهاتف', 'رقم الموبايل'],
  password: ['password', 'كلمة السر', 'كلمة المرور'],
  role: ['role', 'الصلاحية', 'النوع'],
  section: ['section', 'السكشن', 'المجموعة', 'الجروب'],
};

/** Template sheets → the role their rows get when there's no role column. */
const SHEET_ROLES = { 'الطلاب': 'student', 'الدكاترة': 'doctor', 'المعيدين': 'ta', students: 'student', doctors: 'doctor', tas: 'ta' };
const ROLE_ALIASES = { طالب: 'student', معيد: 'ta', دكتور: 'doctor', 'عضو هيئة تدريس': 'doctor' };

const LEVEL_NAMES = { 'الإعدادية': 0, 'إعدادي': 0, 'الاعدادية': 0, 'الأولى': 1, 'الفرقة الأولى': 1, 'الثانية': 2, 'الفرقة الثانية': 2,
  'الثالثة': 3, 'الفرقة الثالثة': 3, 'الرابعة': 4, 'الفرقة الرابعة': 4, 'الخامسة': 5, 'الفرقة الخامسة': 5 };
/** Accepts 0-5 or the Arabic year name picked from the template's dropdown. */
function parseLevel(v) {
  const t = String(v).trim();
  const lead = t.match(/^(\d)(\s|-|$)/);
  if (lead) return Number(lead[1]);
  const hit = Object.entries(LEVEL_NAMES).find(([k]) => t.startsWith(k));
  return hit ? hit[1] : t;
}

function normalizeRow(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key).replace(/\*/g, '').trim().toLowerCase();
    const field = Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(k))?.[0];
    if (field) out[field] = typeof value === 'string' ? value.trim() : value;
  }
  if (out.role && ROLE_ALIASES[out.role]) out.role = ROLE_ALIASES[out.role];
  return out;
}

/** Creates users from imported rows. Returns created accounts (with passwords) and per-row errors. */
function importUsers(rows) {
  const deptByCode = new Map(db.prepare('SELECT id, code, name FROM departments').all()
    .flatMap((d) => [[d.code.toUpperCase(), d.id], [d.name, d.id]]));
  const created = [];
  const errors = [];
  db.transaction(() => {
    rows.forEach((input, i) => {
      const raw = normalizeRow(input);
      if (!raw.name && !raw.username) return; // blank line
      const dept = raw.department === undefined || raw.department === null ? raw.department : String(raw.department).split(' - ')[0].trim();
      const department_id = dept === undefined || dept === null || dept === '' ? null
        : Number.isInteger(Number(dept)) ? Number(dept) : deptByCode.get(String(dept).trim().toUpperCase()) ?? deptByCode.get(String(dept).trim()) ?? -1;
      if (department_id === -1) { errors.push({ row: input.__row ?? i + 2, sheet: input.__sheet, error: `قسم غير معروف: ${dept}` }); return; }
      const result = userSchema.safeParse({
        name: raw.name, username: String(raw.username ?? '').trim(), email: raw.email || null,
        phone: raw.phone ? String(raw.phone) : null, role: raw.role || input.__role || 'student', department_id,
        level: raw.level === undefined || raw.level === '' || raw.level === null ? null : parseLevel(raw.level),
        section: raw.section === undefined || raw.section === '' ? null : String(raw.section),
        password: raw.password ? String(raw.password) : undefined,
      });
      if (!result.success) { errors.push({ row: input.__row ?? i + 2, sheet: input.__sheet, error: result.error.issues[0].message }); return; }
      try {
        const { id, password } = createUser(result.data);
        created.push({ id, name: result.data.name, username: result.data.username, password });
      } catch (err) {
        errors.push({ row: input.__row ?? i + 2, sheet: input.__sheet, error: isUnique(err) ? `الكود ${result.data.username} مسجل بالفعل` : err.message });
      }
    });
  })();
  return { created, errors };
}

async function readSpreadsheet(file) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.csv') {
    const text = (await fs.readFile(file.path, 'utf8')).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') && !lines[0].includes(',') ? ';' : ',';
    const split = (l) => l.split(sep).map((v) => v.replace(/^"|"$/g, '').trim());
    const header = split(lines[0] || '');
    return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [header[i], v])));
  }
  if (ext !== '.xlsx') throw badRequest('الملف يجب أن يكون .xlsx أو .csv');
  await wb.xlsx.readFile(file.path);
  const cellText = (c) => {
    const v = c.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
    return v;
  };
  // Every data sheet is read; in the template each sheet name decides the role.
  const rows = [];
  for (const ws of wb.worksheets) {
    const name = ws.name.trim();
    if (['تعليمات', 'الأقسام', 'instructions', 'lists'].includes(name.toLowerCase()) || ws.state !== 'visible') continue;
    const header = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = String(cellText(c)).trim(); });
    if (!header.some(Boolean)) continue;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const obj = { __row: n, __sheet: name, __role: SHEET_ROLES[name.toLowerCase()] };
      row.eachCell({ includeEmpty: true }, (c, i) => { if (header[i]) obj[header[i]] = cellText(c); });
      rows.push(obj);
    });
  }
  return rows;
}

const LEVEL_OPTIONS = ['0 - الإعدادية', '1 - الفرقة الأولى', '2 - الفرقة الثانية', '3 - الفرقة الثالثة', '4 - الفرقة الرابعة', '5 - الفرقة الخامسة'];

/** Excel template with one sheet per role and dropdowns for department and year. */
router.get('/users/template.xlsx', async (_req, res) => {
  const depts = db.prepare('SELECT code, name FROM departments ORDER BY name').all();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EngPortal';
  const header = (ws, cols) => {
    ws.columns = cols.map(([h, w]) => ({ header: h, width: w }));
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    ws.getRow(1).height = 26;
    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3FA8' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  };
  const listFormula = (col, count) => `'الأقسام'!$${col}$2:$${col}$${Math.max(2, count + 1)}`;
  const validate = (ws, col, formula, prompt) => {
    for (let r = 2; r <= 3000; r++) {
      ws.getCell(`${col}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorTitle: 'قيمة غير صحيحة', error: prompt,
      };
    }
  };

  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  [
    ['📋 طريقة الاستخدام', true],
    ['1) املأ شيت "الطلاب" و"الدكاترة" و"المعيدين" — كل صف = شخص واحد. سيب أي شيت فاضي لو مش محتاجه.'],
    ['2) الأعمدة اللي عليها * إجبارية. القسم والفرقة اختارهم من القائمة اللي بتظهر في الخانة.'],
    ['3) الكود: للطالب الكود الجامعي، وللدكتور/المعيد اسم مستخدم بالإنجليزي (مثلاً d.ahmed أو ta.mona). ده اللي هيسجلوا بيه الدخول.'],
    ['4) كلمة السر اختيارية — لو سبتها فاضية هتتولد تلقائياً وتقدر تحملها بعد الرفع. أي حد هيُطلب منه يغيرها أول دخول.'],
    ['5) السكشن اختياري للطلاب (مثلاً: سكشن 1). لما تسجل دفعة كاملة في مادة، كل طالب بيتحط في السكشن بتاعه.'],
    ['6) احفظ الملف وارفعه من: المستخدمون ← استيراد من Excel.'],
    [''],
    ['مثال صف طالب:  محمد أحمد علي | 2024001 | CSE - هندسة الحاسبات | 2 - الفرقة الثانية | سكشن 1 | m.ahmed@mail.com | 01000000000'],
    ['مثال صف دكتور:  أحمد عبد الرحمن | d.ahmed | CSE - هندسة الحاسبات | a.rahman@eng.edu.eg'],
  ].forEach(([t, bold]) => { const r = help.addRow([t]); r.font = { name: 'Arial', bold: !!bold, size: bold ? 14 : 11 }; });

  const students = wb.addWorksheet('الطلاب');
  header(students, [['الاسم بالكامل *', 32], ['الكود الجامعي *', 16], ['القسم *', 34], ['الفرقة *', 20], ['السكشن', 12], ['البريد', 28], ['الموبايل', 16], ['كلمة السر', 14]]);
  const staffCols = [['الاسم بالكامل *', 32], ['اسم المستخدم *', 18], ['القسم', 34], ['البريد', 28], ['الموبايل', 16], ['كلمة السر', 14]];
  const doctors = wb.addWorksheet('الدكاترة');
  header(doctors, staffCols);
  const tas = wb.addWorksheet('المعيدين');
  header(tas, staffCols);

  const lists = wb.addWorksheet('الأقسام', { state: 'hidden' });
  lists.getCell('A1').value = 'القسم';
  depts.forEach((d, i) => { lists.getCell(`A${i + 2}`).value = `${d.code} - ${d.name}`; });
  lists.getCell('B1').value = 'الفرقة';
  LEVEL_OPTIONS.forEach((l, i) => { lists.getCell(`B${i + 2}`).value = l; });

  if (depts.length) {
    validate(students, 'C', listFormula('A', depts.length), 'اختار القسم من القائمة');
    validate(doctors, 'C', listFormula('A', depts.length), 'اختار القسم من القائمة');
    validate(tas, 'C', listFormula('A', depts.length), 'اختار القسم من القائمة');
  }
  validate(students, 'D', listFormula('B', LEVEL_OPTIONS.length), 'اختار الفرقة من القائمة');
  [students, doctors, tas].forEach((ws) => {
    ws.getColumn(2).numFmt = '@'; // keep codes like 2024001 / 0100… as text
    ws.getColumn(ws === students ? 7 : 5).numFmt = '@';
  });
  wb.views = [{ activeTab: 1 }];

  res.attachment('engportal-users-template.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

/** Import from an uploaded .xlsx/.csv file, or from pasted rows ({ rows: [...] }). */
router.post('/users/import', upload.single('file'), async (req, res) => {
  let rows;
  try {
    rows = req.file ? await readSpreadsheet(req.file) : parse(z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(5000) }), req.body).rows;
  } finally {
    if (req.file) removeUpload(storedName(req.file));
  }
  if (!rows.length) throw badRequest('الملف فارغ');
  if (rows.length > 5000) throw badRequest('الحد الأقصى 5000 صف في المرة');
  res.json(importUsers(rows));
});

router.post('/users/bulk', (req, res) => {
  const rows = parse(z.object({ users: z.array(z.record(z.string(), z.any())).min(1).max(5000) }), req.body).users;
  res.json(importUsers(rows));
});

// ───────────── Faculty-wide announcements ─────────────
router.post('/broadcast', (req, res) => {
  const b = parse(z.object({
    title: z.string().trim().min(2, 'العنوان مطلوب').max(200),
    body: z.string().trim().max(2000).optional(),
    roles: z.array(z.enum(['student', 'ta', 'doctor'])).min(1, 'اختر فئة واحدة على الأقل'),
    department_id: z.number().int().positive().nullish(),
    level: z.number().int().min(0).max(5).nullish(),
  }), req.body);
  const where = [`role IN (${b.roles.map(() => '?').join(',')})`, 'is_active = 1'];
  const args = [...b.roles];
  if (b.department_id) { where.push('department_id = ?'); args.push(b.department_id); }
  if (b.level !== null && b.level !== undefined) { where.push("(level = ? OR role != 'student')"); args.push(b.level); }
  const ids = db.prepare(`SELECT id FROM users WHERE ${where.join(' AND ')}`).pluck().all(...args);
  notify(ids, { type: 'announcement', title: `📢 ${b.title}`, body: b.body || 'إعلان من إدارة الكلية', link: '/notifications' });
  res.json({ sent: ids.length });
});

router.put('/users/:id', (req, res) => {
  const id = toId(req.params.id);
  const u = parse(userSchema.partial({ password: true }), req.body);
  if (id === req.user.id && (u.role !== 'admin' || u.is_active === false)) {
    throw badRequest('لا يمكنك تغيير صلاحيتك أو إيقاف حسابك');
  }
  try {
    const r = db.prepare(`
      UPDATE users SET name = ?, username = ?, email = ?, phone = ?, role = ?, department_id = ?, level = ?, section = ?,
             is_active = COALESCE(?, is_active)
      WHERE id = ?`).run(
      u.name, u.username, u.email || null, u.phone || null, u.role, u.department_id ?? null,
      u.role === 'student' ? (u.level ?? null) : null, u.role === 'student' ? (u.section || null) : null,
      u.is_active === undefined ? null : Number(u.is_active), id,
    );
    if (!r.changes) throw notFound();
  } catch (err) {
    if (isUnique(err)) throw badRequest('اسم المستخدم مستخدم بالفعل');
    throw err;
  }
  if (u.password) {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(bcrypt.hashSync(u.password, 10), id);
  }
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', (req, res) => {
  const id = toId(req.params.id);
  const password = generatePassword();
  const r = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), id);
  if (!r.changes) throw notFound();
  res.json({ password });
});

/** Unbinds a student's phone (lost/changed phone) so the next check-in binds the new one. */
router.delete('/users/:id/device', (req, res) => {
  db.prepare('DELETE FROM student_devices WHERE user_id = ?').run(toId(req.params.id));
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = toId(req.params.id);
  if (id === req.user.id) throw badRequest('لا يمكنك حذف حسابك');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ───────────── Courses ─────────────
const courseSchema = z.object({
  code: z.string().trim().min(2).max(20).toUpperCase(),
  name: z.string().trim().min(2),
  department_id: z.coerce.number().int().positive().nullish(),
  level: z.coerce.number().int().min(0).max(5).nullish(),
  semester: z.enum(['fall', 'spring', 'summer']),
  academic_year: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'السنة الدراسية بصيغة 2025/2026'),
  credit_hours: z.coerce.number().int().min(0).max(12).default(3),
  description: z.string().trim().max(2000).nullish(),
});

router.get('/courses', (req, res) => {
  const { department_id } = req.query;
  res.json(db.prepare(`
    SELECT c.*, d.name AS department_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
      (SELECT json_group_array(json_object('id', u.id, 'name', u.name, 'role', cs.role))
         FROM course_staff cs JOIN users u ON u.id = cs.user_id WHERE cs.course_id = c.id) AS staff
    FROM courses c LEFT JOIN departments d ON d.id = c.department_id
    ${department_id ? 'WHERE c.department_id = ?' : ''}
    ORDER BY c.academic_year DESC, c.level, c.code`).all(...(department_id ? [Number(department_id)] : []))
    .map((c) => ({ ...c, staff: JSON.parse(c.staff) })));
});

router.post('/courses', (req, res) => {
  const c = parse(courseSchema, req.body);
  try {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO courses (code, name, department_id, level, semester, academic_year, credit_hours, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(c.code, c.name, c.department_id ?? null, c.level ?? null, c.semester,
      c.academic_year, c.credit_hours, c.description ?? null);
    res.status(201).json({ id: Number(lastInsertRowid) });
  } catch (err) {
    if (isUnique(err)) throw badRequest('هذه المادة موجودة بالفعل في نفس الترم');
    throw err;
  }
});

router.put('/courses/:id', (req, res) => {
  const c = parse(courseSchema, req.body);
  try {
    const r = db.prepare(`
      UPDATE courses SET code = ?, name = ?, department_id = ?, level = ?, semester = ?, academic_year = ?,
             credit_hours = ?, description = ? WHERE id = ?`).run(c.code, c.name, c.department_id ?? null, c.level ?? null,
      c.semester, c.academic_year, c.credit_hours, c.description ?? null, toId(req.params.id));
    if (!r.changes) throw notFound();
  } catch (err) {
    if (isUnique(err)) throw badRequest('هذه المادة موجودة بالفعل في نفس الترم');
    throw err;
  }
  res.json({ ok: true });
});

router.delete('/courses/:id', (req, res) => {
  db.prepare('DELETE FROM courses WHERE id = ?').run(toId(req.params.id));
  res.json({ ok: true });
});

router.put('/courses/:id/staff', (req, res) => {
  const courseId = toId(req.params.id);
  const { doctors, tas } = parse(
    z.object({ doctors: z.array(z.number().int()).default([]), tas: z.array(z.number().int()).default([]) }),
    req.body,
  );
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course) throw notFound();
  const roleOf = db.prepare('SELECT role FROM users WHERE id = ?').pluck();
  for (const id of doctors) if (roleOf.get(id) !== 'doctor') throw badRequest('يجب اختيار أعضاء هيئة تدريس فقط');
  for (const id of tas) if (roleOf.get(id) !== 'ta') throw badRequest('يجب اختيار معيدين فقط');

  const before = new Set(db.prepare('SELECT user_id FROM course_staff WHERE course_id = ?').pluck().all(courseId));
  db.transaction(() => {
    db.prepare('DELETE FROM course_staff WHERE course_id = ?').run(courseId);
    const ins = db.prepare('INSERT OR IGNORE INTO course_staff (course_id, user_id, role) VALUES (?, ?, ?)');
    doctors.forEach((id) => ins.run(courseId, id, 'doctor'));
    tas.forEach((id) => ins.run(courseId, id, 'ta'));
  })();
  const added = [...doctors, ...tas].filter((id) => !before.has(id));
  notify(added, { type: 'course', title: `تم إسنادك لمادة ${course.name}`, body: course.code, link: `/courses/${courseId}` });
  res.json({ ok: true });
});

router.get('/courses/:id/enrollments', (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name, u.username, u.level, d.name AS department_name, e.section, e.enrolled_at
    FROM enrollments e JOIN users u ON u.id = e.student_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE e.course_id = ? ORDER BY u.name`).all(toId(req.params.id)));
});

function enroll(courseId, studentIds, section) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course) throw notFound();
  const student = db.prepare("SELECT id, section FROM users WHERE id = ? AND role = 'student'");
  const ins = db.prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id, section) VALUES (?, ?, ?)');
  // An explicit section wins; otherwise each student goes into their own default section.
  const added = db.transaction(() => studentIds.filter((id) => {
    const st = student.get(id);
    return st && ins.run(courseId, id, section || st.section || null).changes;
  }))();
  notify(added, { type: 'course', title: `تم تسجيلك في مادة ${course.name}`, body: course.code, link: `/courses/${courseId}` });
  return added.length;
}

router.post('/courses/:id/enrollments', (req, res) => {
  const { student_ids, section } = parse(
    z.object({ student_ids: z.array(z.number().int()).min(1), section: z.string().trim().max(20).nullish() }),
    req.body,
  );
  res.json({ added: enroll(toId(req.params.id), student_ids, section) });
});

/** Enrolls every student of a department + level (a whole cohort) in one click. */
router.post('/courses/:id/enroll-cohort', (req, res) => {
  const { department_id, level } = parse(
    z.object({ department_id: z.number().int().positive(), level: z.number().int().min(0).max(5) }),
    req.body,
  );
  const ids = db.prepare("SELECT id FROM users WHERE role = 'student' AND is_active = 1 AND department_id = ? AND level = ?")
    .pluck().all(department_id, level);
  res.json({ added: enroll(toId(req.params.id), ids) });
});

router.put('/courses/:id/enrollments/:studentId', (req, res) => {
  const { section } = parse(z.object({ section: z.string().trim().max(20).nullish() }), req.body);
  db.prepare('UPDATE enrollments SET section = ? WHERE course_id = ? AND student_id = ?')
    .run(section || null, toId(req.params.id), toId(req.params.studentId));
  res.json({ ok: true });
});

router.delete('/courses/:id/enrollments/:studentId', (req, res) => {
  db.prepare('DELETE FROM enrollments WHERE course_id = ? AND student_id = ?').run(toId(req.params.id), toId(req.params.studentId));
  res.json({ ok: true });
});

export default router;

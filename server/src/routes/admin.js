import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../db.js';
import { parse, badRequest, notFound, toId } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { notify } from '../lib/notify.js';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upload, storedName, removeUpload } from '../lib/upload.js';

const router = Router();
router.use(requireRole('admin'));

const ROLES = ['admin', 'doctor', 'ta', 'student'];

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

// ───────────── Departments ─────────────
const deptSchema = z.object({ name: z.string().trim().min(2), code: z.string().trim().min(1).max(12).toUpperCase() });

router.get('/departments', (_req, res) => {
  res.json(db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'student') AS students,
           (SELECT COUNT(*) FROM courses c WHERE c.department_id = d.id) AS courses
    FROM departments d ORDER BY d.name`).all());
});

router.post('/departments', (req, res) => {
  const d = parse(deptSchema, req.body);
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run(d.name, d.code);
    res.status(201).json({ id: Number(lastInsertRowid) });
  } catch (err) {
    if (isUnique(err)) throw badRequest('كود القسم مستخدم بالفعل');
    throw err;
  }
});

router.put('/departments/:id', (req, res) => {
  const d = parse(deptSchema, req.body);
  try {
    const r = db.prepare('UPDATE departments SET name = ?, code = ? WHERE id = ?').run(d.name, d.code, toId(req.params.id));
    if (!r.changes) throw notFound();
  } catch (err) {
    if (isUnique(err)) throw badRequest('كود القسم مستخدم بالفعل');
    throw err;
  }
  res.json({ ok: true });
});

router.delete('/departments/:id', (req, res) => {
  db.prepare('DELETE FROM departments WHERE id = ?').run(toId(req.params.id));
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
    SELECT u.id, u.name, u.username, u.email, u.phone, u.role, u.department_id, u.level,
           u.is_active, u.must_change_password, u.last_login_at, u.created_at, d.name AS department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
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
  password: z.string().min(6, 'كلمة المرور يجب ألا تقل عن 6 أحرف').optional().or(z.literal('')),
  is_active: z.boolean().optional(),
});

function createUser(u) {
  const password = u.password || generatePassword();
  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (name, username, email, phone, role, department_id, level, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    u.name, u.username, u.email || null, u.phone || null, u.role,
    u.department_id ?? null, u.role === 'student' ? (u.level ?? null) : null, hash,
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
};
const ROLE_ALIASES = { طالب: 'student', معيد: 'ta', دكتور: 'doctor', 'عضو هيئة تدريس': 'doctor' };

function normalizeRow(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key).trim().toLowerCase();
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
      const dept = raw.department;
      const department_id = dept === undefined || dept === null || dept === '' ? null
        : Number.isInteger(Number(dept)) ? Number(dept) : deptByCode.get(String(dept).trim().toUpperCase()) ?? deptByCode.get(String(dept).trim()) ?? -1;
      if (department_id === -1) { errors.push({ row: i + 2, error: `قسم غير معروف: ${dept}` }); return; }
      const result = userSchema.safeParse({
        name: raw.name, username: String(raw.username ?? '').trim(), email: raw.email || null,
        phone: raw.phone ? String(raw.phone) : null, role: raw.role || 'student', department_id,
        level: raw.level === undefined || raw.level === '' || raw.level === null ? null : raw.level,
        password: raw.password ? String(raw.password) : undefined,
      });
      if (!result.success) { errors.push({ row: i + 2, error: result.error.issues[0].message }); return; }
      try {
        const { id, password } = createUser(result.data);
        created.push({ id, name: result.data.name, username: result.data.username, password });
      } catch (err) {
        errors.push({ row: i + 2, error: isUnique(err) ? `الكود ${result.data.username} مسجل بالفعل` : err.message });
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
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const cellText = (c) => {
    const v = c.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
    return v;
  };
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = String(cellText(c)).trim(); });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {};
    row.eachCell({ includeEmpty: true }, (c, i) => { if (header[i]) obj[header[i]] = cellText(c); });
    rows.push(obj);
  });
  return rows;
}

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
      UPDATE users SET name = ?, username = ?, email = ?, phone = ?, role = ?, department_id = ?, level = ?,
             is_active = COALESCE(?, is_active)
      WHERE id = ?`).run(
      u.name, u.username, u.email || null, u.phone || null, u.role, u.department_id ?? null,
      u.role === 'student' ? (u.level ?? null) : null,
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
  const isStudent = db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'student'").pluck();
  const ins = db.prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id, section) VALUES (?, ?, ?)');
  const added = db.transaction(() => studentIds.filter((id) => isStudent.get(id) && ins.run(courseId, id, section ?? null).changes))();
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

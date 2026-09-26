import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import db from '../db.js';
import { gradesLock } from '../lib/visibility.js';
import { parse, badRequest, toId } from '../lib/http.js';
import { courseAccess, READERS } from '../lib/access.js';
import { describe, histogram, letterGrade, LETTERS, round } from '../lib/stats.js';
import { buildGradebook, attendanceRates } from '../lib/gradebook.js';
import { TYPE_LABELS } from './assessments.js';

/** Mounted under /api/courses/:courseId */
const router = Router({ mergeParams: true });

router.get('/gradebook', (req, res) => {
  const courseId = toId(req.params.courseId);
  courseAccess(req.user, courseId, READERS);
  res.json(buildGradebook(courseId));
});

/** A student's own published grades in a course. */
router.get('/my-grades', (req, res) => {
  const courseId = toId(req.params.courseId);
  const { course } = courseAccess(req.user, courseId, ['student']);
  const lock = gradesLock(req.user.id, course);
  if (lock) return res.json({ locked: lock, items: [], total: null, max: null, percentage: null, letter: null, attendance: attendanceRates(courseId).get(req.user.id) ?? null });
  const items = db.prepare(`
    SELECT a.id, a.title, a.type, a.max_score, a.published_at, s.score, s.feedback,
      (SELECT AVG(s2.score) FROM submissions s2 WHERE s2.assessment_id = a.id AND s2.score IS NOT NULL) AS class_avg,
      (SELECT MAX(s2.score) FROM submissions s2 WHERE s2.assessment_id = a.id) AS class_max
    FROM assessments a LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = ?
    WHERE a.course_id = ? AND a.status = 'published' ORDER BY a.published_at`).all(req.user.id, courseId)
    .map((i) => ({ ...i, class_avg: round(i.class_avg) }));
  const total = items.reduce((s, i) => s + (i.score ?? 0), 0);
  const max = items.reduce((s, i) => s + i.max_score, 0);
  const pct = max ? (total / max) * 100 : null;
  res.json({ items, total: round(total), max, percentage: round(pct), letter: letterGrade(pct), attendance: attendanceRates(courseId).get(req.user.id) ?? null });
});

/** Analytics for the doctor: distribution, pass rates, grading progress, attendance trend. */
router.get('/stats', (req, res) => {
  const courseId = toId(req.params.courseId);
  courseAccess(req.user, courseId, READERS);
  const { assessments, rows, total_max, assessed_max, scheme, final_max } = buildGradebook(courseId);

  const perAssessment = assessments.map((a) => {
    const values = rows.map((r) => r.grades[a.id].score).filter((v) => v !== null);
    const submitted = rows.filter((r) => r.grades[a.id].submitted).length;
    return {
      id: a.id, title: a.title, type: a.type, type_label: TYPE_LABELS[a.type], status: a.status, max_score: a.max_score,
      ...describe(values, a.max_score),
      mean_pct: values.length ? round((values.reduce((s, v) => s + v, 0) / values.length / a.max_score) * 100, 1) : null,
      graded: values.length, submitted, students: rows.length,
      histogram: histogram(values, a.max_score),
    };
  });

  const graded = assessed_max ? rows : [];
  const totals = graded.map((r) => r.assessed_total);
  // With a grading scheme, grade bands follow the weighted final grade.
  const letterOf = (r) => (scheme ? r.final?.letter : r.letter);
  const letters = LETTERS.map((l) => ({ letter: l, count: graded.filter((r) => letterOf(r) === l).length }));
  const finals = scheme ? rows.map((r) => r.final?.total).filter((v) => v !== null && v !== undefined) : [];

  const sessions = db.prepare(`
    SELECT s.id, s.title, s.started_at,
      (SELECT COUNT(*) FROM attendance_records r WHERE r.session_id = s.id) AS present
    FROM attendance_sessions s WHERE s.course_id = ? ORDER BY s.started_at`).all(courseId)
    .map((s) => ({ ...s, rate: rows.length ? round((s.present / rows.length) * 100, 1) : 0 }));

  const bySection = {};
  for (const r of graded) {
    const key = r.section || 'بدون سكشن';
    const p = scheme ? r.final?.percentage : r.percentage;
    if (p !== null && p !== undefined) (bySection[key] ||= []).push(p);
  }

  const pctOf = (r) => (scheme ? r.final?.percentage ?? 0 : r.percentage ?? 0);
  const ranked = [...graded].sort((x, y) => pctOf(y) - pctOf(x));
  res.json({
    students: rows.length,
    total_max,
    assessed_max,
    overall: { ...describe(totals, assessed_max), histogram: histogram(totals, assessed_max || 1) },
    letters,
    final: scheme ? { max: final_max, ...describe(finals, final_max), histogram: histogram(finals, final_max || 1) } : null,
    assessments: perAssessment,
    attendance: {
      sessions,
      average_rate: sessions.length ? round(sessions.reduce((s, x) => s + x.rate, 0) / sessions.length, 1) : null,
    },
    sections: Object.entries(bySection).map(([section, pcts]) => ({
      section, students: pcts.length, mean_pct: round(pcts.reduce((s, p) => s + p, 0) / pcts.length, 1),
    })),
    top: ranked.slice(0, 5).map((r) => ({ id: r.id, name: r.name, username: r.username, total: r.assessed_total, percentage: pctOf(r) })),
    at_risk: ranked.filter((r) => pctOf(r) < 50 || (r.attendance && r.attendance.rate < 75))
      .slice(-10).reverse()
      .map((r) => ({ id: r.id, name: r.name, username: r.username, percentage: pctOf(r), attendance_rate: r.attendance?.rate ?? null })),
  });
});

// ───────────── Grading scheme (توزيع الدرجات) ─────────────
router.get('/grading-scheme', (req, res) => {
  const courseId = toId(req.params.courseId);
  courseAccess(req.user, courseId, READERS);
  const { scheme, final_max } = buildGradebook(courseId);
  res.json({ scheme, final_max });
});

const schemeSchema = z.object({
  components: z.array(z.object({
    key: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1, 'اسم البند مطلوب').max(80),
    weight: z.number().min(0).max(1000),
    assessment_ids: z.array(z.number().int().positive()).min(1, 'اختر تقييم واحد على الأقل لكل بند'),
    best_of: z.number().int().positive().nullish(),
  })).max(30),
  attendance: z.object({ enabled: z.boolean(), weight: z.number().min(0).max(1000) }),
});

router.put('/grading-scheme', (req, res) => {
  const courseId = toId(req.params.courseId);
  courseAccess(req.user, courseId, ['doctor', 'ta']);
  const scheme = req.body?.scheme === null ? null : parse(schemeSchema, req.body?.scheme);
  if (scheme) {
    const valid = new Set(db.prepare('SELECT id FROM assessments WHERE course_id = ?').pluck().all(courseId));
    const used = new Set();
    for (const c of scheme.components) {
      for (const id of c.assessment_ids) {
        if (!valid.has(id)) throw badRequest('تقييم غير موجود في المادة');
        if (used.has(id)) throw badRequest('لا يمكن استخدام نفس التقييم في أكثر من بند');
        used.add(id);
      }
      if (c.best_of && c.best_of > c.assessment_ids.length) throw badRequest(`"أفضل ${c.best_of}" أكبر من عدد تقييمات بند ${c.name}`);
    }
  }
  db.prepare('UPDATE courses SET grading_scheme = ? WHERE id = ?').run(scheme ? JSON.stringify(scheme) : null, courseId);
  res.json({ ok: true });
});

// ───────────── Excel export ─────────────
const BRAND = 'FF1D3FA8';
const thin = { style: 'thin', color: { argb: 'FFD9DEE8' } };
const border = { top: thin, bottom: thin, left: thin, right: thin };

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = border;
  });
  row.height = 36;
}

const colLetter = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/**
 * Real .xlsx export. Options (query string, all default on):
 *   raw=0         hide the individual assessment columns
 *   attendance=0  hide attendance columns
 *   stats=0       skip the statistics sheet
 * With a grading scheme, each component is a column and the final total is an Excel
 * SUM formula over them, so edits in Excel recalculate automatically.
 */
router.get('/gradebook.xlsx', async (req, res) => {
  const courseId = toId(req.params.courseId);
  const { course } = courseAccess(req.user, courseId, READERS);
  const gb = buildGradebook(courseId);
  const opt = (k) => req.query[k] !== '0';
  const includeRaw = opt('raw');
  const includeAtt = opt('attendance');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'EngPortal';
  wb.created = new Date();
  const ws = wb.addWorksheet('الدرجات', { views: [{ rightToLeft: true, state: 'frozen', xSplit: 3, ySplit: 3 }] });

  ws.mergeCells(1, 1, 1, 8);
  ws.getCell(1, 1).value = `${course.name} (${course.code}) — ${course.academic_year}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, name: 'Arial', color: { argb: BRAND } };
  ws.getCell(2, 1).value = `تاريخ التصدير: ${new Date().toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' }, name: 'Arial' };

  const cols = [
    { header: 'م', width: 5 }, { header: 'الكود', width: 12 }, { header: 'الاسم', width: 30 }, { header: 'السكشن', width: 10 },
  ];
  const rawCols = includeRaw ? gb.assessments.map((a) => ({ header: `${a.title}\n(${a.max_score})`, width: 11, a })) : [];
  const attCols = includeAtt ? [{ header: 'محاضرات حضرها', width: 11 }, { header: 'نسبة الحضور %', width: 11 }] : [];
  const scheme = gb.scheme;
  const compCols = scheme ? [
    ...scheme.components.map((c) => ({ header: `${c.name}\n(${c.weight})`, width: 12, key: c.key })),
    ...(scheme.attendance?.enabled ? [{ header: `الحضور\n(${scheme.attendance.weight})`, width: 11, key: 'attendance' }] : []),
  ] : [];
  const totalHeader = scheme ? `المجموع النهائي\n(${gb.final_max})` : `المجموع\n(${gb.total_max})`;
  const all = [...cols, ...rawCols, ...attCols, ...compCols, { header: totalHeader, width: 13 }, { header: 'النسبة %', width: 10 }, { header: 'التقدير', width: 12 }];

  const headerRow = ws.getRow(3);
  all.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
    ws.getColumn(i + 1).width = c.width;
  });
  styleHeader(headerRow);

  const firstComp = cols.length + rawCols.length + attCols.length + 1;
  const firstRaw = cols.length + 1;
  const totalCol = all.length - 2;
  const pctCol = all.length - 1;
  const gradeCol = all.length;
  const maxForPct = scheme ? gb.final_max : gb.assessed_max;

  gb.rows.forEach((r, i) => {
    const row = ws.getRow(4 + i);
    const values = [i + 1, r.username, r.name, r.section || ''];
    for (const c of rawCols) values.push(r.grades[c.a.id].score ?? null);
    if (includeAtt) values.push(r.attendance ? r.attendance.attended : null, r.attendance ? r.attendance.rate : null);
    for (const c of compCols) values.push(r.final?.parts[c.key] ?? null);
    values.forEach((v, j) => { row.getCell(j + 1).value = v; });

    const n = 4 + i;
    // Total is a live formula: the sum of the components (or of raw scores without a scheme).
    const [from, to] = scheme ? [firstComp, firstComp + compCols.length - 1] : [firstRaw, firstRaw + rawCols.length - 1];
    if (to >= from) {
      row.getCell(totalCol).value = { formula: `SUM(${colLetter(from)}${n}:${colLetter(to)}${n})`, result: scheme ? r.final?.total : r.total };
    } else {
      row.getCell(totalCol).value = scheme ? r.final?.total : r.total;
    }
    const t = `${colLetter(totalCol)}${n}`;
    if (maxForPct) {
      // In Excel the percentage is always out of the full total, so the file is the final sheet.
      const totalValue = (scheme ? r.final?.total : r.total) ?? 0;
      const pctValue = round((totalValue / maxForPct) * 100, 1);
      row.getCell(pctCol).value = { formula: `ROUND(${t}/${maxForPct}*100,1)`, result: pctValue };
      const p = `${colLetter(pctCol)}${n}`;
      row.getCell(gradeCol).value = {
        formula: `IF(${p}>=85,"امتياز",IF(${p}>=75,"جيد جداً",IF(${p}>=65,"جيد",IF(${p}>=50,"مقبول",IF(${p}>=30,"ضعيف","ضعيف جداً")))))`,
        result: letterGrade(pctValue),
      };
    }
    row.eachCell({ includeEmpty: true }, (cell, j) => {
      cell.border = border;
      cell.font = { name: 'Arial', bold: j >= totalCol };
      cell.alignment = { horizontal: j === 3 ? 'right' : 'center', vertical: 'middle' };
      if (j >= firstComp && compCols.length && j < totalCol) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FF' } };
      if (j >= totalCol) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
    });
    if (i % 2) row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + gb.rows.length, column: all.length } };

  // Sheet 2: how the grade is distributed.
  if (scheme) {
    const s2 = wb.addWorksheet('توزيع الدرجات', { views: [{ rightToLeft: true }] });
    s2.columns = [{ width: 24 }, { width: 10 }, { width: 50 }, { width: 14 }];
    styleHeader(s2.addRow(['البند', 'الدرجة', 'التقييمات المحسوبة', 'طريقة الحساب']));
    const titles = new Map(gb.assessments.map((a) => [a.id, a.title]));
    for (const c of scheme.components) {
      s2.addRow([c.name, c.weight, c.assessment_ids.map((id) => titles.get(id)).join('، '), c.best_of ? `أفضل ${c.best_of}` : 'الكل']);
    }
    if (scheme.attendance?.enabled) s2.addRow(['الحضور', scheme.attendance.weight, 'نسبة حضور المحاضرات × الدرجة', '']);
    s2.addRow(['الإجمالي', gb.final_max, '', '']).font = { bold: true };
  }

  // Sheet 3: statistics per assessment.
  if (opt('stats')) {
    const s3 = wb.addWorksheet('إحصائيات', { views: [{ rightToLeft: true }] });
    s3.columns = [{ width: 24 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];
    styleHeader(s3.addRow(['التقييم', 'العظمى', 'تم رصدهم', 'المتوسط', 'الوسيط', 'أقل', 'أعلى', 'نسبة النجاح %']));
    for (const a of gb.assessments) {
      const d = describe(gb.rows.map((r) => r.grades[a.id].score).filter((v) => v !== null), a.max_score);
      s3.addRow([a.title, a.max_score, d.count, d.mean, d.median, d.min, d.max, d.pass_rate]);
    }
  }

  res.attachment(`${course.code}-grades.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;

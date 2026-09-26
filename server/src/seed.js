/**
 * Resets the database and fills it with realistic demo data.
 *   npm run seed
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

const dbFile = process.env.DB_PATH || path.join(DATA_DIR, 'engportal.db');
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });

const { default: db } = await import('./db.js');
const { default: bcrypt } = await import('bcryptjs');

const hash = (p) => bcrypt.hashSync(p, 8);
const iso = (d) => d.toISOString();
const daysFromNow = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; };
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const YEAR = '2026/2027';

const departments = [
  ['السنة الإعدادية', 'PREP'],
  ['هندسة الحاسبات والتحكم', 'CSE'],
  ['هندسة الإلكترونيات والاتصالات', 'ECE'],
  ['الهندسة المدنية', 'CIV'],
  ['هندسة القوى الميكانيكية', 'MEP'],
  ['هندسة القوى والآلات الكهربية', 'EPM'],
  ['الهندسة المعمارية', 'ARC'],
];

const insDept = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)');
const dept = Object.fromEntries(departments.map(([name, code]) => [code, Number(insDept.run(name, code).lastInsertRowid)]));

const insUser = db.prepare(`INSERT INTO users (name, username, email, role, department_id, level, password_hash, must_change_password)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
const addUser = (name, username, role, deptCode, level, password) =>
  Number(insUser.run(name, username, `${username.replace(/[^\w.]/g, '')}@eng.edu.eg`, role, deptCode ? dept[deptCode] : null, level ?? null, hash(password)).lastInsertRowid);

addUser('مدير النظام', 'admin', 'admin', null, null, 'admin123');

const doctors = {
  ahmed: addUser('أحمد عبد الرحمن', 'd.ahmed', 'doctor', 'CSE', null, 'doctor123'),
  samia: addUser('سامية فتحي', 'd.samia', 'doctor', 'ECE', null, 'doctor123'),
  khaled: addUser('خالد منصور', 'd.khaled', 'doctor', 'CIV', null, 'doctor123'),
  hany: addUser('هاني الشربيني', 'd.hany', 'doctor', 'PREP', null, 'doctor123'),
};
const tas = {
  mona: addUser('منى حسن', 'ta.mona', 'ta', 'CSE', null, 'ta123456'),
  omar: addUser('عمر سليمان', 'ta.omar', 'ta', 'CSE', null, 'ta123456'),
  nour: addUser('نور الهدى علي', 'ta.nour', 'ta', 'ECE', null, 'ta123456'),
  youssef: addUser('يوسف كمال', 'ta.youssef', 'ta', 'CIV', null, 'ta123456'),
  salma: addUser('سلمى إبراهيم', 'ta.salma', 'ta', 'PREP', null, 'ta123456'),
};

const first = ['محمد', 'أحمد', 'محمود', 'مصطفى', 'عمر', 'يوسف', 'كريم', 'زياد', 'مريم', 'سارة', 'نورهان', 'هبة', 'آية', 'ملك', 'ندى', 'علي', 'حسن', 'إسلام', 'رنا', 'فاطمة', 'عبد الله', 'مازن', 'جنى', 'ياسمين'];
const fathers = ['محمد', 'أحمد', 'محمود', 'مصطفى', 'عمر', 'إبراهيم', 'خالد', 'طارق', 'سامح', 'علي', 'حسن', 'وليد', 'هشام', 'عبد الله', 'أشرف', 'ياسر'];
const last = ['السيد', 'عبد العزيز', 'الشافعي', 'حسين', 'رمضان', 'فرج', 'النجار', 'عثمان', 'البنا', 'سعيد', 'جمال', 'عادل', 'الدسوقي', 'زكي', 'شاهين', 'فوزي'];

const students = {};
let serial = 1;
function cohort(code, level, count, prefix) {
  students[code] = [];
  for (let i = 0; i < count; i++) {
    const name = `${pick(first)} ${pick(fathers)} ${pick(last)}`;
    const username = `${prefix}${String(serial++).padStart(3, '0')}`;
    students[code].push(addUser(name, username, 'student', code, level, 'student123'));
  }
}
cohort('CSE', 3, 24, '2023');
cohort('ECE', 3, 18, '2023');
cohort('CIV', 3, 18, '2023');
cohort('PREP', 0, 20, '2026');
// Keep the first CSE student with a memorable name for the demo.
db.prepare("UPDATE users SET name = 'محمد أشرف السيد' WHERE id = ?").run(students.CSE[0]);

const insCourse = db.prepare(`INSERT INTO courses (code, name, department_id, level, semester, academic_year, credit_hours, description)
  VALUES (?, ?, ?, ?, 'fall', ?, ?, ?)`);
const insStaff = db.prepare('INSERT INTO course_staff (course_id, user_id, role) VALUES (?, ?, ?)');
const insEnroll = db.prepare('INSERT INTO enrollments (course_id, student_id, section) VALUES (?, ?, ?)');

function course(code, name, deptCode, level, hours, description, doctorIds, taIds, studentIds) {
  const id = Number(insCourse.run(code, name, dept[deptCode], level, YEAR, hours, description).lastInsertRowid);
  doctorIds.forEach((d) => insStaff.run(id, d, 'doctor'));
  taIds.forEach((t) => insStaff.run(id, t, 'ta'));
  studentIds.forEach((s, i) => insEnroll.run(id, s, `سكشن ${(i % 3) + 1}`));
  return id;
}

const c = {
  ds: course('CSE321', 'هياكل البيانات والخوارزميات', 'CSE', 3, 3, 'تحليل الخوارزميات، القوائم، الأشجار، الرسوم البيانية، الترتيب والبحث.', [doctors.ahmed], [tas.mona, tas.omar], students.CSE),
  os: course('CSE331', 'نظم التشغيل', 'CSE', 3, 3, 'العمليات، الجدولة، إدارة الذاكرة، أنظمة الملفات، التزامن.', [doctors.ahmed], [tas.mona], students.CSE),
  micro: course('CSE341', 'المعالجات الدقيقة', 'CSE', 3, 3, 'معمارية المعالجات، لغة التجميع، الواجهات والمقاطعات.', [doctors.samia], [tas.omar], students.CSE),
  comm: course('ECE311', 'الاتصالات التناظرية', 'ECE', 3, 3, 'التعديل السعوي والترددي، الضوضاء، المستقبلات.', [doctors.samia], [tas.nour], students.ECE),
  em: course('ECE321', 'الموجات الكهرومغناطيسية', 'ECE', 3, 3, 'معادلات ماكسويل، انتشار الموجات، خطوط النقل.', [doctors.samia], [tas.nour], students.ECE),
  rc: course('CIV331', 'تصميم المنشآت الخرسانية', 'CIV', 3, 4, 'تصميم البلاطات والكمرات والأعمدة طبقاً للكود المصري.', [doctors.khaled], [tas.youssef], students.CIV),
  soil: course('CIV341', 'ميكانيكا التربة', 'CIV', 3, 3, 'خواص التربة، الانضغاط، مقاومة القص، الضغط الجانبي.', [doctors.khaled], [tas.youssef], students.CIV),
  math: course('MTH011', 'رياضيات (1)', 'PREP', 0, 4, 'التفاضل والتكامل، الجبر الخطي.', [doctors.hany], [tas.salma], students.PREP),
  phys: course('PHY011', 'فيزياء (1)', 'PREP', 0, 3, 'الميكانيكا، الخواص الحرارية للمادة.', [doctors.hany], [tas.salma], students.PREP),
};

// ───────────── Assessments & grades ─────────────
const insA = db.prepare(`INSERT INTO assessments (course_id, title, type, description, max_score, due_at, accepts_submissions, status,
  created_by, created_at, submitted_by, submitted_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insS = db.prepare(`INSERT INTO submissions (assessment_id, student_id, file_name, file_size, submitted_at, score, feedback, graded_by, graded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const feedbacks = [null, null, 'حل ممتاز 👏', 'راجع الجزء الثاني', 'اهتم بتنظيم الحل', 'خطأ في الوحدات', 'أحسنت'];

function assessment(courseId, { title, type = 'sheet', desc = null, max, due, submissions = true, status, doctor, ta, submitRate = 0.9, gradeRate = 1, skill = 0.72 }) {
  const created = daysFromNow(due - 7);
  const id = Number(insA.run(courseId, title, type, desc, max, iso(daysFromNow(due, 23)), Number(submissions), status, ta, iso(created),
    status !== 'open' ? ta : null, status !== 'open' ? iso(daysFromNow(due + 3)) : null, status === 'published' ? iso(daysFromNow(due + 4)) : null).lastInsertRowid);
  const roster = db.prepare('SELECT student_id FROM enrollments WHERE course_id = ?').pluck().all(courseId);
  for (const sid of roster) {
    const submitted = !submissions || rand() < submitRate;
    if (!submitted) continue;
    const graded = rand() < gradeRate;
    const ability = Math.min(1, Math.max(0.2, skill + 0.08 + (rand() - 0.5) * 0.5 + ((sid % 7) - 3) * 0.03));
    const score = graded ? Math.round(ability * max * 2) / 2 : null;
    insS.run(id, sid, submissions ? `${title}.pdf` : null, submissions ? 250_000 + Math.floor(rand() * 900_000) : null,
      submissions ? iso(daysFromNow(due - 1, 20)) : null, score, graded ? pick(feedbacks) : null, graded ? ta : null, graded ? iso(daysFromNow(due + 2)) : null);
  }
  return id;
}

for (const [key, doc, ta] of [['ds', doctors.ahmed, tas.mona], ['os', doctors.ahmed, tas.mona], ['micro', doctors.samia, tas.omar],
  ['comm', doctors.samia, tas.nour], ['em', doctors.samia, tas.nour], ['rc', doctors.khaled, tas.youssef],
  ['soil', doctors.khaled, tas.youssef], ['math', doctors.hany, tas.salma], ['phys', doctors.hany, tas.salma]]) {
  const cid = c[key];
  assessment(cid, { title: 'شيت 1', max: 10, due: -28, status: 'published', doctor: doc, ta, skill: 0.78 });
  assessment(cid, { title: 'كويز 1', type: 'quiz', max: 5, due: -21, submissions: false, status: 'published', doctor: doc, ta, skill: 0.7 });
  assessment(cid, { title: 'شيت 2', max: 10, due: -14, status: 'published', doctor: doc, ta, skill: 0.68 });
  assessment(cid, { title: 'شيت 3', max: 10, due: -6, status: 'submitted', doctor: doc, ta, skill: 0.74 });
  assessment(cid, { title: 'ميدترم', type: 'midterm', max: 20, due: -3, submissions: false, status: 'open', doctor: doc, ta, gradeRate: 0.4, skill: 0.65 });
  assessment(cid, { title: 'شيت 4', desc: 'حل المسائل من 1 إلى 8 في الفصل الخامس. التسليم PDF واحد مكتوب بخط واضح.', max: 10, due: 2, status: 'open', doctor: doc, ta, submitRate: 0.45, gradeRate: 0.3 });
  assessment(cid, { title: 'مشروع المادة', type: 'project', desc: 'مشروع جماعي (3-4 طلاب). سلّم التقرير والكود في ملف مضغوط.', max: 15, due: 21, status: 'open', doctor: doc, ta, submitRate: 0, gradeRate: 0 });
}
// Keep the demo student's upcoming sheet un-submitted so they have something to do.
db.prepare(`DELETE FROM submissions WHERE student_id = ? AND assessment_id IN
  (SELECT id FROM assessments WHERE title IN ('شيت 4', 'مشروع المادة'))`).run(students.CSE[0]);

// ───────────── Attendance history ─────────────
const insSession = db.prepare(`INSERT INTO attendance_sessions (course_id, title, created_by, secret, rotate_seconds, started_at, closes_at, closed_at)
  VALUES (?, ?, ?, ?, 15, ?, ?, ?)`);
const insRecord = db.prepare('INSERT INTO attendance_records (session_id, student_id, method, recorded_at) VALUES (?, ?, ?, ?)');
for (const [key, doc] of Object.entries({ ds: doctors.ahmed, os: doctors.ahmed, micro: doctors.samia, comm: doctors.samia, em: doctors.samia, rc: doctors.khaled, soil: doctors.khaled, math: doctors.hany, phys: doctors.hany })) {
  const roster = db.prepare('SELECT student_id FROM enrollments WHERE course_id = ?').pluck().all(c[key]);
  for (let week = 1; week <= 6; week++) {
    const start = daysFromNow(-7 * (7 - week), 9);
    const sid = Number(insSession.run(c[key], `محاضرة ${week}`, doc, crypto.randomBytes(32).toString('hex'), iso(start),
      iso(new Date(start.getTime() + 15 * 60_000)), iso(new Date(start.getTime() + 15 * 60_000))).lastInsertRowid);
    const rate = 0.95 - week * 0.04;
    for (const st of roster) {
      if (rand() < rate) insRecord.run(sid, st, rand() < 0.93 ? 'qr' : 'manual', iso(new Date(start.getTime() + rand() * 10 * 60_000)));
    }
  }
}

db.prepare('UPDATE attendance_sessions SET warnings_sent_at = closed_at').run();

// ───────────── Grading scheme (أعمال السنة = 60) ─────────────
for (const cid of Object.values(c)) {
  const ids = (titles) => db.prepare(`SELECT id FROM assessments WHERE course_id = ? AND title IN (${titles.map(() => '?').join(',')})`).pluck().all(cid, ...titles);
  db.prepare('UPDATE courses SET grading_scheme = ? WHERE id = ?').run(JSON.stringify({
    components: [
      { key: 'sheets', name: 'الشيتات', weight: 10, assessment_ids: ids(['شيت 1', 'شيت 2', 'شيت 3', 'شيت 4']), best_of: 3 },
      { key: 'quizzes', name: 'الكويزات', weight: 5, assessment_ids: ids(['كويز 1']), best_of: null },
      { key: 'midterm', name: 'الميدترم', weight: 20, assessment_ids: ids(['ميدترم']), best_of: null },
      { key: 'project', name: 'المشروع', weight: 15, assessment_ids: ids(['مشروع المادة']), best_of: null },
    ],
    attendance: { enabled: true, weight: 10 },
  }), cid);
}

// ───────────── Weekly timetable ─────────────
const { localNow } = await import('./lib/clock.js');
const today = localNow().dow === 5 ? 6 : localNow().dow; // no classes on Friday
const insSlot = db.prepare(`INSERT INTO course_schedule (course_id, kind, day_of_week, start_time, end_time, location, section, staff_id,
  remind_before, attendance_mode, attendance_offset, attendance_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 30, ?, 10, 15)`);
const WEEK = [6, 0, 1, 2, 3, 4];
const timetable = [
  ['ds', today, '09:00', '11:00', 'مدرج 1', tas.mona], ['os', WEEK[(WEEK.indexOf(today) + 1) % 6], '11:15', '13:15', 'مدرج 2', tas.mona],
  ['micro', WEEK[(WEEK.indexOf(today) + 2) % 6], '09:00', '11:00', 'مدرج 1', tas.omar], ['comm', 0, '09:00', '11:00', 'مدرج 4', tas.nour],
  ['em', 2, '11:15', '13:15', 'مدرج 4', tas.nour], ['rc', 1, '09:00', '12:00', 'مدرج المدني', tas.youssef],
  ['soil', 3, '09:00', '11:00', 'مدرج المدني', tas.youssef], ['math', 6, '08:30', '10:30', 'المدرج الكبير', tas.salma],
  ['phys', 0, '12:00', '14:00', 'المدرج الكبير', tas.salma],
];
for (const [key, day, start, end, room, ta] of timetable) {
  insSlot.run(c[key], 'lecture', day, start, end, room, null, null, 'remind');
  ['سكشن 1', 'سكشن 2', 'سكشن 3'].forEach((sec, i) => {
    const d = WEEK[(WEEK.indexOf(day) + 1 + i) % 6];
    insSlot.run(c[key], key === 'micro' ? 'lab' : 'section', d, ['12:30', '14:00', '15:30'][i], ['14:00', '15:30', '17:00'][i], `قاعة ${3 + i}`, sec, ta, 'auto');
  });
}

// ───────────── Posts ─────────────
const insPost = db.prepare('INSERT INTO posts (course_id, author_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)');
insPost.run(c.ds, doctors.ahmed, 'announcement', 'موعد الميدترم', 'الميدترم يوم الأحد القادم الساعة 10 صباحاً في المدرج الكبير. المنهج حتى نهاية الأشجار (Trees).', iso(daysFromNow(-10)));
insPost.run(c.ds, tas.mona, 'announcement', 'سكشن إضافي', 'هيكون في سكشن إضافي يوم الأربعاء الساعة 12 في معمل 3 لحل مسائل الشيت الرابع.', iso(daysFromNow(-1)));
insPost.run(c.ds, doctors.ahmed, 'material', 'محاضرة 6 - Graphs', 'سلايدات المحاضرة السادسة: BFS, DFS, Topological Sort.', iso(daysFromNow(-2)));
insPost.run(c.os, doctors.ahmed, 'material', 'محاضرة 5 - Memory Management', 'Paging, Segmentation, TLB.', iso(daysFromNow(-4)));
insPost.run(c.comm, doctors.samia, 'announcement', 'تأجيل المحاضرة', 'محاضرة الثلاثاء اتأجلت للخميس نفس الميعاد.', iso(daysFromNow(-3)));

// ───────────── A sample conversation ─────────────
const [u1, u2] = [students.CSE[0], tas.mona].sort((a, b) => a - b);
const convId = Number(db.prepare('INSERT INTO conversations (user1_id, user2_id, created_at, last_message_at) VALUES (?, ?, ?, ?)')
  .run(u1, u2, iso(daysFromNow(-2)), iso(daysFromNow(-1, 18))).lastInsertRowid);
const insMsg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at, read_at) VALUES (?, ?, ?, ?, ?)');
insMsg.run(convId, students.CSE[0], 'السلام عليكم يا بشمهندسة، هو في شيت 4 المسألة 5 مطلوب نحلها recursive ولا iterative؟', iso(daysFromNow(-2, 17)), iso(daysFromNow(-2, 18)));
insMsg.run(convId, tas.mona, 'وعليكم السلام، الاتنين مقبولين بس لازم تكتب الـ complexity في الحالتين.', iso(daysFromNow(-1, 18)), null);

const insNotif = db.prepare('INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)');
insNotif.run(students.CSE[0], 'grades_published', 'نزلت درجات شيت 2', 'هياكل البيانات والخوارزميات', `/courses/${c.ds}`, iso(daysFromNow(-10)));
insNotif.run(students.CSE[0], 'announcement', 'إعلان جديد - هياكل البيانات والخوارزميات', 'سكشن إضافي', `/courses/${c.ds}?tab=announcements`, iso(daysFromNow(-1)));
insNotif.run(doctors.ahmed, 'grades_submitted', 'درجات بانتظار اعتمادك - هياكل البيانات والخوارزميات', 'منى حسن رفعت درجات شيت 3', `/courses/${c.ds}`, iso(daysFromNow(-3)));

console.log('✅ Demo data created\n');
console.table([
  { role: 'Admin (شؤون الطلاب)', username: 'admin', password: 'admin123' },
  { role: 'Doctor (د. أحمد)', username: 'd.ahmed', password: 'doctor123' },
  { role: 'TA (م. منى)', username: 'ta.mona', password: 'ta123456' },
  { role: 'Student (CSE - الفرقة الثالثة)', username: '2023001', password: 'student123' },
]);

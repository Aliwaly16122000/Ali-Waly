import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, pdf } from './helpers.js';

let srv;
let student;
let student2;
let otherStudent;
let ta;
let doctor;
let admin;

before(async () => {
  srv = await startServer();
  student = await client(srv.base, '2023001', 'student123'); // CSE, enrolled in course 1
  student2 = await client(srv.base, '2023002', 'student123');
  otherStudent = await client(srv.base, '2023030', 'student123'); // ECE, not in course 1
  ta = await client(srv.base, 'ta.mona', 'ta123456');
  doctor = await client(srv.base, 'd.ahmed', 'doctor123');
  admin = await client(srv.base, 'admin', 'admin123');
});
after(() => srv?.stop());

const assessmentId = async (courseId, title) =>
  (await doctor.get(`/courses/${courseId}/assessments`)).data.find((a) => a.title === title).id;

test('auth: wrong password is rejected, anonymous /me is empty', async () => {
  const anon = await client(srv.base);
  assert.equal((await anon.post('/auth/login', { username: '2023001', password: 'nope' })).status, 401);
  assert.deepEqual((await anon.get('/auth/me')).data, { user: null });
  assert.equal((await anon.get('/courses')).status, 401);
});

test('access control: students only see their own courses and data', async () => {
  const mine = (await student.get('/courses')).data.map((c) => c.code);
  assert.ok(mine.includes('CSE321'));
  assert.ok(!mine.includes('ECE311'));
  assert.equal((await otherStudent.get('/courses/1')).status, 403);
  assert.equal((await student.get('/courses/1/gradebook')).status, 403);
  assert.equal((await student.get('/admin/users')).status, 403);
  assert.equal((await ta.get('/admin/users')).status, 403);
  assert.equal((await student.put('/assessments/1/grades', { grades: [{ student_id: 11, score: 10 }] })).status, 403);
});

test('grading workflow: submit → grade → send to doctor → publish, grade hidden until published', async () => {
  const id = await assessmentId(1, 'شيت 4');
  const sub = await student.post(`/assessments/${id}/submit`, pdf());
  assert.equal(sub.status, 200, JSON.stringify(sub.data));

  const saved = await ta.put(`/assessments/${id}/grades`, { grades: [{ student_id: student.user.id, score: 9, feedback: 'ممتاز' }] });
  assert.equal(saved.status, 200);
  assert.equal((await ta.put(`/assessments/${id}/grades`, { grades: [{ student_id: student.user.id, score: 99 }] })).status, 400);

  let view = (await student.get(`/assessments/${id}`)).data;
  assert.equal(view.submission.score, null, 'score must stay hidden before publishing');

  assert.equal((await ta.post(`/assessments/${id}/submit-to-doctor`)).status, 200);
  assert.equal((await ta.put(`/assessments/${id}/grades`, { grades: [{ student_id: student.user.id, score: 8 }] })).status, 403);
  assert.equal((await ta.post(`/assessments/${id}/publish`)).status, 403);
  assert.equal((await doctor.post(`/assessments/${id}/publish`)).status, 200);

  view = (await student.get(`/assessments/${id}`)).data;
  assert.equal(view.submission.score, 9);
  assert.equal(view.submission.feedback, 'ممتاز');

  // another student can't download this submission
  const subId = (await ta.get(`/assessments/${id}`)).data.roster.find((r) => r.student_id === student.user.id).submission_id;
  assert.equal((await student2.get(`/submissions/${subId}/file`)).status, 403);
  assert.equal((await ta.get(`/submissions/${subId}/file`)).status, 200);
});

test('audit log: editing a published grade needs a reason, is logged and notifies the student', async () => {
  const id = await assessmentId(1, 'شيت 1');
  const noReason = await doctor.put(`/assessments/${id}/grades`, { grades: [{ student_id: student.user.id, score: 3 }] });
  assert.equal(noReason.status, 400);
  const ok = await doctor.put(`/assessments/${id}/grades`, { grades: [{ student_id: student.user.id, score: 3 }], reason: 'مراجعة' });
  assert.equal(ok.status, 200);
  const history = (await doctor.get(`/assessments/${id}/history?student_id=${student.user.id}`)).data;
  const last = history.find((h) => h.action === 'grade');
  assert.equal(last.new_score, 3);
  assert.equal(last.reason, 'مراجعة');
  assert.equal(last.changed_by, doctor.user.id);
  const notes = (await student.get('/notifications?limit=5')).data.items.map((n) => n.title);
  assert.ok(notes.some((t) => t.includes('تم تعديل درجتك')));
});

test('gradebook: weighted scheme totals stay within bounds and export as xlsx', async () => {
  const gb = (await doctor.get('/courses/1/gradebook')).data;
  assert.equal(gb.final_max, 60);
  for (const r of gb.rows) {
    assert.ok(r.final.total <= r.final.available + 1e-9, 'final total exceeds available marks');
    assert.ok(r.percentage === null || (r.percentage >= 0 && r.percentage <= 100));
  }
  const x = await doctor.get('/courses/1/gradebook.xlsx');
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.ok(x.data.byteLength > 1000);
  assert.equal((await student.get('/courses/1/gradebook.xlsx')).status, 403);
});

test('grading scheme: the same assessment cannot be counted twice', async () => {
  const r = await doctor.put('/courses/1/grading-scheme', {
    scheme: { components: [{ key: 'a', name: 'x', weight: 5, assessment_ids: [1, 1] }], attendance: { enabled: false, weight: 0 } },
  });
  assert.equal(r.status, 400);
});

test('late policy: closed deadlines reject submissions, grace periods accept them', async () => {
  const due = new Date(Date.now() - 2 * 3600_000).toISOString();
  const make = async (title, extra) => {
    const fd = new FormData();
    Object.entries({ title, max_score: '10', due_at: due, ...extra }).forEach(([k, v]) => fd.append(k, v));
    return (await doctor.post('/courses/1/assessments', fd)).data.id;
  };
  const closed = await make('مغلق', { late_policy: 'closed' });
  const grace = await make('مهلة', { late_policy: 'grace', grace_hours: '5' });
  assert.equal((await student.post(`/assessments/${closed}/submit`, pdf())).status, 400);
  const g = await student.post(`/assessments/${grace}/submit`, pdf());
  assert.equal(g.status, 200);
  assert.equal(g.data.late, true);
});

test('attendance: rotating code, device binding and one device per student', async () => {
  const { id } = (await doctor.post('/courses/1/attendance', { title: 'اختبار' })).data;
  const { code, token } = (await doctor.get(`/attendance/${id}/token`)).data;
  assert.match(code, /^\d{6}$/);

  assert.equal((await student.post('/attendance/scan', { code })).data.code, 'device_required');
  const ok = await student.post('/attendance/scan', { token, device_id: 'device-student-one-0001' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.already, false);

  const friend = await student2.post('/attendance/scan', { code, device_id: 'device-student-one-0001' });
  assert.equal(friend.status, 403);
  assert.equal(friend.data.code, 'device_used');

  assert.equal((await otherStudent.post('/attendance/scan', { code, device_id: 'device-other-student-01' })).status, 400);
  assert.equal((await student.post('/attendance/scan', { token: `${id}.1.forged`, device_id: 'device-student-one-0001' })).status, 400);

  // same student, new phone → refused until admin unbinds
  const { id: id2 } = (await doctor.post('/courses/1/attendance', { title: 'اختبار 2' })).data;
  const code2 = (await doctor.get(`/attendance/${id2}/token`)).data.code;
  assert.equal((await student.post('/attendance/scan', { code: code2, device_id: 'device-student-one-NEW1' })).data.code, 'device_mismatch');
  assert.equal((await admin.del(`/admin/users/${student.user.id}/device`)).status, 200);
  assert.equal((await student.post('/attendance/scan', { code: code2, device_id: 'device-student-one-NEW1' })).status, 200);
});

test('attendance: a TA deletes only sessions they opened; the doctor deletes any', async () => {
  const mine = (await ta.post('/courses/1/attendance', { title: 'تجربة معيد', duration_minutes: 5 })).data.id;
  const doctors = (await doctor.post('/courses/1/attendance', { title: 'محاضرة دكتور', duration_minutes: 5 })).data.id;
  assert.equal((await ta.del(`/attendance/${doctors}`)).status, 403);
  assert.equal((await ta.del(`/attendance/${mine}`)).status, 200);
  assert.equal((await doctor.del(`/attendance/${doctors}`)).status, 200);
  assert.equal((await student.del(`/attendance/${doctors}`)).status, 404);
});

test('attendance: optional geofence asks for location and rejects far-away phones', async () => {
  assert.equal((await doctor.put('/courses/1/attendance-settings', { geo_enabled: true, geo_lat: 30.0266, geo_lng: 31.2105, geo_radius: 200 })).status, 200);
  const { id } = (await doctor.post('/courses/1/attendance', { title: 'موقع' })).data;
  const { code } = (await doctor.get(`/attendance/${id}/token`)).data;
  const device = { device_id: 'device-student-two-0002' };

  const first = await student2.post('/attendance/scan', { code, ...device });
  assert.equal(first.status, 428);
  assert.ok(first.data.ticket);
  const far = await student2.post('/attendance/scan', { ticket: first.data.ticket, ...device, location: { lat: 30.06, lng: 31.25, accuracy: 20 } });
  assert.equal(far.data.code, 'too_far');
  const near = await student2.post('/attendance/scan', { ticket: first.data.ticket, ...device, location: { lat: 30.0268, lng: 31.2107, accuracy: 25 } });
  assert.equal(near.status, 200, JSON.stringify(near.data));

  // a ticket belongs to one student
  assert.equal((await student.post('/attendance/scan', { ticket: first.data.ticket, device_id: 'x'.repeat(20), location: { lat: 30.0268, lng: 31.2107 } })).status, 400);
  await doctor.put('/courses/1/attendance-settings', { geo_enabled: false });
});

test('terms: archived courses are read-only', async () => {
  assert.equal((await admin.put('/admin/term', { academic_year: '2027/2028', semester: 'fall' })).status, 200);
  assert.equal((await student.get('/courses')).data.length, 0);
  assert.ok((await student.get('/courses?term=all')).data.every((c) => c.archived));
  const id = await assessmentId(1, 'مشروع المادة');
  assert.equal((await student.post(`/assessments/${id}/submit`, pdf())).status, 400);
  assert.equal((await doctor.post('/courses/1/attendance', { title: 'x' })).status, 400);
  assert.equal((await student.get('/courses/1')).status, 200, 'archive stays readable');
  await admin.put('/admin/term', { academic_year: '2026/2027', semester: 'fall' });
});

test('admin: bulk import creates accounts with passwords and reports bad rows', async () => {
  const r = await admin.post('/admin/users/import', {
    rows: [
      { 'الاسم': 'طالب جديد', 'الكود': '2099001', 'القسم': 'CSE', 'الفرقة': '1' },
      { 'الاسم': 'طالب خطأ', 'الكود': '2099002', 'القسم': 'XXX', 'الفرقة': '1' },
      { 'الاسم': 'مكرر', 'الكود': '2023001', 'القسم': 'CSE', 'الفرقة': '1' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.created.length, 1);
  assert.equal(r.data.errors.length, 2);
  const fresh = await client(srv.base, '2099001', r.data.created[0].password);
  assert.equal(fresh.user.must_change_password, true);
});

test('backups: admin can snapshot and download, names are validated', async () => {
  const b = await admin.post('/admin/backups');
  assert.equal(b.status, 200);
  const dl = await admin.get(`/admin/backups/${b.data.name}`);
  assert.equal(dl.status, 200);
  assert.ok(dl.data.byteLength > 10000);
  assert.equal((await admin.get('/admin/backups/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await doctor.post('/admin/backups')).status, 403);
});

test('chat: students can message their course staff but not other students', async () => {
  const conv = await student.post('/chat/conversations', { user_id: ta.user.id });
  assert.equal(conv.status, 200);
  const sent = await student.post(`/chat/conversations/${conv.data.id}/messages`, (() => { const f = new FormData(); f.append('body', 'سؤال'); return f; })());
  assert.equal(sent.status, 201);
  assert.equal((await student.post('/chat/conversations', { user_id: student2.user.id })).status, 403);
  assert.equal((await student2.get(`/chat/conversations/${conv.data.id}`)).status, 404);
});

test('chat: admin can message anyone, find students by search, and get replies', async () => {
  const contacts = (await admin.get('/chat/contacts')).data;
  assert.ok(contacts.some((g) => g.course_id === 'doctor' && g.members.some((m) => m.id === doctor.user.id)));
  assert.ok(!contacts.some((g) => g.course_id === 'student'), 'students only appear when searching');
  const found = (await admin.get('/chat/contacts?q=2023030')).data.find((g) => g.course_id === 'student');
  assert.equal(found.members[0].id, otherStudent.user.id);

  const conv = await admin.post('/chat/conversations', { user_id: otherStudent.user.id });
  assert.equal(conv.status, 200);
  const msg = (body) => { const f = new FormData(); f.append('body', body); return f; };
  assert.equal((await admin.post(`/chat/conversations/${conv.data.id}/messages`, msg('راجع شئون الطلاب'))).status, 201);
  assert.equal((await otherStudent.post(`/chat/conversations/${conv.data.id}/messages`, msg('حاضر'))).status, 201);
  assert.equal((await otherStudent.post('/chat/conversations', { user_id: admin.user.id })).status, 200, 'the student can reply to the admin');
});

test('push: test notification explains when no device is subscribed', async () => {
  const r = await student2.post('/notifications/push/test', { delay: 0 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /تفعيل الإشعارات/);
});

test('admin: Excel template round-trip imports students, doctors and TAs with sections', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const tpl = await admin.get('/admin/users/template.xlsx');
  assert.equal(tpl.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.data);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['تعليمات', 'الطلاب', 'الدكاترة', 'المعيدين', 'الأقسام']);
  const deptOption = wb.getWorksheet('الأقسام').getCell('A2').value; // e.g. "ARC - الهندسة المعمارية"
  const cse = wb.getWorksheet('الأقسام').getColumn(1).values.find((v) => typeof v === 'string' && v.startsWith('CSE'));

  // Type into the rows right under the header, like a person filling the sheet.
  const fill = (sheet, row, values) => values.forEach((v, i) => { wb.getWorksheet(sheet).getCell(row, i + 1).value = v; });
  fill('الطلاب', 2, ['طالبة من الشيت', '2098001', cse, '2 - الفرقة الثانية', 'سكشن 2', 'x@y.com', '01000000000']);
  fill('الطلاب', 3, ['بدون قسم صحيح', '2098002', 'ZZZ - غلط', '1 - الفرقة الأولى']);
  fill('الدكاترة', 2, ['دكتور من الشيت', 'd.sheet', deptOption, 'd@eng.edu.eg']);
  fill('المعيدين', 2, ['معيد من الشيت', 'ta.sheet', cse]);
  const buf = await wb.xlsx.writeBuffer();

  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'users.xlsx');
  const r = await admin.post('/admin/users/import', fd);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.created.map((c) => c.username).sort(), ['2098001', 'd.sheet', 'ta.sheet']);
  assert.equal(r.data.errors.length, 1);
  assert.equal(r.data.errors[0].sheet, 'الطلاب');
  assert.equal(r.data.errors[0].row, 3);

  const users = (await admin.get('/admin/users?q=الشيت')).data;
  const st = users.find((u) => u.username === '2098001');
  assert.equal(st.role, 'student');
  assert.equal(st.level, 2);
  assert.equal(st.section, 'سكشن 2');
  assert.equal(users.find((u) => u.username === 'd.sheet').role, 'doctor');
  assert.equal(users.find((u) => u.username === 'ta.sheet').role, 'ta');

  // cohort enrollment puts the student in their own section
  const course = (await admin.post('/admin/courses', { code: 'CSE201', name: 'مادة تجربة', department_id: st.department_id, level: 2, semester: 'fall', academic_year: '2026/2027' })).data;
  await admin.post(`/admin/courses/${course.id}/enroll-cohort`, { department_id: st.department_id, level: 2 });
  const enrolled = (await admin.get(`/admin/courses/${course.id}/enrollments`)).data;
  assert.equal(enrolled.find((e) => e.username === '2098001').section, 'سكشن 2');
});

test('admin: department plan creates courses, staff and timetable in one go (all or nothing)', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const tpl = await admin.get('/admin/plan/template.xlsx');
  assert.equal(tpl.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.data);
  const fill = (sheet, row, values) => values.forEach((v, i) => { wb.getWorksheet(sheet).getCell(row, i + 1).value = v; });
  fill('الدكاترة', 2, ['دكتور الخطة', 'd.plan', 'CIV']);
  fill('الدكاترة', 3, ['موجود قبل كده', 'd.ahmed']); // existing username → skipped, not an error
  fill('المعيدين', 2, ['معيد الخطة', 'ta.plan', 'CIV']);
  fill('المواد', 2, ['PLN101', 'مادة الخطة', 'PLNCH - قسم جديد بالخطة', '1 - الفرقة الأولى', 2, 'd.plan', 'ta.plan']);
  fill('الجدول', 2, ['PLN101', 'محاضرة', 'الأحد', '8:30', '10:00', 'مدرج 2', '', 'd.plan', 'تذكير']);
  fill('الجدول', 3, ['PLN101', 'سكشن', 'الاثنين', '12:15', '13:30', '415', '1', '', 'تلقائي']);
  fill('الجدول', 4, ['PLN101', 'سكشن', 'يوم غلط', '12:15', '13:30']);
  const upload = async () => {
    const fd = new FormData();
    fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'plan.xlsx');
    return admin.post('/admin/plan/import', fd);
  };

  const bad = await upload();
  assert.equal(bad.status, 400);
  assert.equal(bad.data.errors[0].sheet, 'الجدول');
  assert.equal(bad.data.errors[0].row, 4);
  assert.ok(!(await admin.get('/admin/users?q=الخطة')).data.length, 'nothing is created when the file has errors');

  fill('الجدول', 4, ['PLN101', 'معمل', 'الأربعاء', '13:45', '15:00', 'معمل', '2']);
  const ok = await upload();
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.created.map((c) => c.username).sort(), ['d.plan', 'ta.plan']);
  assert.equal(ok.data.skipped_users, 1);
  assert.equal(ok.data.courses_created, 1);
  assert.equal(ok.data.slots, 3);
  assert.deepEqual(ok.data.departments.map((d) => d.code), ['PLNCH']);

  const course = (await admin.get('/admin/courses')).data.find((c) => c.code === 'PLN101');
  assert.equal(course.level, 1);
  assert.equal(course.credit_hours, 2);
  assert.deepEqual(course.staff.map((s) => s.role).sort(), ['doctor', 'ta']);
  const slots = (await admin.get(`/courses/${course.id}/schedule`)).data;
  assert.deepEqual(slots.map((s) => [s.kind, s.day_of_week, s.start_time, s.section, s.attendance_mode]),
    [['lecture', 0, '08:30', null, 'remind'], ['section', 1, '12:15', '1', 'auto'], ['lab', 3, '13:45', '2', 'remind']]);

  // Uploading again updates in place: no duplicate course or slots.
  const again = await upload();
  assert.equal(again.data.courses_updated, 1);
  assert.equal((await admin.get(`/courses/${course.id}/schedule`)).data.length, 3);

  // Credit hours: students get accounts and are registered course by course.
  fill('الطلاب', 2, ['طالب ساعات', 'CH9001', 'PLNCH', '2 - الفرقة الثانية']);
  fill('الطلاب', 3, ['طالب ساعات بسكشن', 'CH9002', 'PLNCH', '2 - الفرقة الثانية', '2']);
  fill('التسجيل', 2, ['CH9001', 'PLN101']);
  fill('التسجيل', 3, ['CH9002', 'PLN101']);
  const withStudents = await upload();
  assert.equal(withStudents.status, 200, JSON.stringify(withStudents.data));
  assert.equal(withStudents.data.enrolled, 2);
  const enrolled = (await admin.get(`/admin/courses/${course.id}/enrollments`)).data;
  assert.deepEqual(enrolled.map((e) => [e.username, e.section]).sort(), [['CH9001', null], ['CH9002', '2']]);
  assert.equal((await upload()).data.enrolled, 0, 're-uploading does not register twice');
});

test('calendar: term week, holidays cancel classes and stop timetable reminders', async () => {
  const term = (await student.get('/calendar/term')).data;
  assert.equal(term.status, 'running');
  assert.ok(term.week >= 1 && term.week <= term.weeks);

  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1);
  const day = d.toISOString().slice(0, 10);
  const r = await admin.post('/calendar/events', { title: 'إجازة اختبار', kind: 'holiday', start_date: day, end_date: day, notify: true });
  assert.equal(r.status, 201);
  assert.equal((await student.post('/calendar/events', { title: 'x', kind: 'event', start_date: day, end_date: day })).status, 403);

  const cal = (await student.get(`/calendar?from=${day}&to=${day}`)).data.items;
  assert.ok(cal.some((i) => i.type === 'holiday'));
  for (const c of cal.filter((i) => ['lecture', 'section', 'lab'].includes(i.type))) assert.equal(c.cancelled, 'إجازة اختبار');
  const notes = (await student.get('/notifications?limit=3')).data.items.map((n) => n.title);
  assert.ok(notes.some((t) => t.includes('إجازة اختبار')));
});

test('exams: Excel timetable + seating, visible to enrolled students only after publishing', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const tpl = await admin.get('/exams/template.xlsx');
  assert.equal(tpl.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.data);
  const put = (sheet, row, values) => values.forEach((v, i) => { wb.getWorksheet(sheet).getCell(row, i + 1).value = v; });
  put('جدول الامتحانات', 2, ['CSE321', '', 'فاينال', '2026-11-20', '9:00', '12:00', 'مدرج 5']);
  put('جدول الامتحانات', 3, ['XXX999', '', 'فاينال', '2026-11-21', '9:00', '12:00']);
  put('جدول الامتحانات', 4, ['CSE331', '', 'فاينال', '21/11/2026', '1:00 م', '3:00 م']);
  put('أرقام الجلوس', 2, ['2023001', '', '5001', 'لجنة 7']);
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'exams.xlsx');
  fd.append('period', 'final');
  const r = await admin.post('/exams/import', fd);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.exams, 2);
  assert.equal(r.data.seats, 1);
  assert.equal(r.data.errors.length, 1);

  const finals = (await admin.get('/exams/me')).data.exams.filter((x) => x.kind === 'final');
  const os = finals.find((x) => x.course_code === 'CSE331');
  assert.equal(os.start_time, '13:00');
  assert.equal(os.exam_date, '2026-11-21');

  assert.ok(!(await student.get('/exams/me')).data.exams.some((x) => x.kind === 'final'), 'drafts are hidden from students');
  const pub = await admin.post('/exams/publish', { ids: finals.map((x) => x.id) });
  assert.equal(pub.status, 200);
  const mine = (await student.get('/exams/me')).data.exams.filter((x) => x.kind === 'final');
  const ds = mine.find((x) => x.course_code === 'CSE321');
  assert.equal(ds.seat_number, '5001');
  assert.equal(ds.hall, 'لجنة 7');
  assert.ok(!(await otherStudent.get('/exams/me')).data.exams.some((x) => x.course_code === 'CSE321'));

  // doctors manage only their own courses' exams
  assert.equal((await doctor.post('/exams', { course_id: 1, kind: 'oral', exam_date: '2026-11-25', start_time: '10:00', end_time: '11:00' })).status, 201);
  assert.equal((await doctor.post('/exams', { course_id: 4, kind: 'oral', exam_date: '2026-11-25', start_time: '10:00', end_time: '11:00' })).status, 403);
  assert.equal((await student.post('/exams/publish', { ids: [ds.id] })).status, 403);
});

test('branding: public name, admin-only changes and logo upload', async () => {
  const anon = await client(srv.base);
  assert.equal((await anon.get('/branding')).data.university, 'جامعة بورسعيد');
  assert.equal((await doctor.put('/branding', { university: 'x', faculty: 'y' })).status, 403);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png');
  const up = await admin.post('/branding/logo', fd);
  assert.equal(up.status, 200);
  assert.ok(up.data.logo_url);
  const img = await anon.get(up.data.logo_url.replace('/api', ''));
  assert.equal(img.status, 200);
  const bad = new FormData();
  bad.append('logo', new Blob(['hi']), 'x.txt');
  assert.equal((await admin.post('/branding/logo', bad)).status, 400);
});

test('leadership: president → faculties, dean → own faculty, head → own department, read-only', async () => {
  const president = await client(srv.base, 'president', 'leader123');
  const dean = await client(srv.base, 'dean.eng', 'leader123');
  const uni = (await president.get('/oversight/university')).data;
  assert.ok(uni.faculties.length >= 2);
  const eng = uni.faculties.find((f) => f.name === 'كلية الهندسة');
  assert.ok(eng.courses > 0 && eng.students > 0);

  assert.equal((await dean.get('/oversight/university')).status, 403);
  assert.equal((await dean.get(`/oversight/faculty/${eng.id}`)).status, 200);
  const other = uni.faculties.find((f) => f.id !== eng.id);
  assert.equal((await dean.get(`/oversight/faculty/${other.id}`)).status, 403);

  // d.ahmed heads CSE (department 2) only
  assert.equal((await doctor.get('/oversight/department/2')).status, 200);
  assert.equal((await doctor.get('/oversight/department/3')).status, 403);
  assert.equal((await ta.get('/oversight/department/2')).status, 403);

  // observers can read course stats/gradebook but not change anything
  assert.equal((await dean.get('/courses/4/stats')).status, 200);
  assert.equal((await dean.get('/courses/4/gradebook')).status, 200);
  assert.equal((await dean.put('/courses/4/grading-scheme', { scheme: null })).status, 403);
  assert.equal((await dean.put('/assessments/1/grades', { grades: [{ student_id: 11, score: 1 }] })).status, 403);
  assert.equal((await dean.post('/courses/4/attendance', { title: 'x' })).status, 403);
});

test('admin: faculties CRUD and leadership assignment', async () => {
  const f = await admin.post('/admin/faculties', { name: 'كلية التجارة', code: 'COM' });
  assert.equal(f.status, 201);
  assert.equal((await admin.post('/admin/faculties', { name: 'مكرر', code: 'COM' })).status, 400);
  const d = await admin.post('/admin/departments', { name: 'المحاسبة', code: 'ACC', faculty_id: f.data.id });
  assert.equal(d.status, 201);
  assert.equal((await admin.post('/admin/oversight', { user_id: student.user.id, scope: 'university' })).status, 400);
  assert.equal((await admin.post('/admin/oversight', { user_id: ta.user.id, scope: 'faculty', scope_id: f.data.id })).status, 201);
  assert.equal((await ta.get(`/oversight/faculty/${f.data.id}`)).status, 200);
  await admin.del(`/admin/faculties/${f.data.id}`);
  assert.equal((await ta.get(`/oversight/faculty/${f.data.id}`)).status, 403);
  assert.equal((await doctor.get('/admin/faculties')).status, 403);
});

test('grade visibility: doctor hides grades until a date; students see nothing, staff still do', async () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  assert.equal((await ta.put('/courses/2/grade-visibility', { hidden: true })).status, 403);
  assert.equal((await doctor.put('/courses/2/grade-visibility', { hidden: true, visible_from: future })).status, 200);
  const mine = (await student.get('/courses/2/my-grades')).data;
  assert.equal(mine.locked.reason, 'hidden');
  assert.equal(mine.locked.until, future);
  assert.ok((await student.get('/courses/2/assessments')).data.every((a) => a.score === null));
  assert.equal((await student.get('/courses')).data.find((c) => c.id === 2).my_total, null);
  assert.ok((await doctor.get('/courses/2/gradebook')).data.rows.length > 0);

  assert.equal((await doctor.put('/courses/2/grade-visibility', { hidden: false })).status, 200);
  assert.equal((await student.get('/courses/2/my-grades')).data.locked, undefined);
  const notes = (await student.get('/notifications?limit=3')).data.items.map((n) => n.title);
  assert.ok(notes.some((t) => t.includes('متاحة دلوقتي')));
});

test('surveys: required survey unlocks grades and exam timetable per course', async () => {
  const template = (await admin.get('/surveys/template')).data;
  const created = await admin.post('/surveys', {
    title: 'تقييم المواد', questions: template, gate_grades: true, gate_exams: true, target: { course_ids: [1, 2] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  // drafts don't lock anything
  assert.equal((await student.get('/courses/1/my-grades')).data.locked, undefined);
  await admin.post(`/surveys/${id}/status`, { status: 'open' });

  assert.equal((await student.get('/courses/1/my-grades')).data.locked.reason, 'survey');
  const exams = (await student.get('/exams/me')).data.exams.filter((x) => x.course_id === 1);
  assert.ok(exams.length && exams.every((x) => x.locked && !x.exam_date), 'exam details hidden until survey answered');
  assert.equal((await student.get('/surveys/pending')).data.filter((p) => p.id === id).length, 2);

  // validation: required answers
  assert.equal((await student.post(`/surveys/${id}/respond`, { course_id: 1, answers: { q1: 5 } })).status, 400);
  const answers = { q1: 5, q2: 4, q3: 4, q4: 5, q5: 3, q6: 'مناسبة', q7: 'شكراً' };
  assert.equal((await student.post(`/surveys/${id}/respond`, { course_id: 1, answers })).status, 200);
  assert.equal((await student.get('/courses/1/my-grades')).data.locked, undefined);
  assert.ok((await student.get('/exams/me')).data.exams.filter((x) => x.course_id === 1).every((x) => !x.locked));
  assert.equal((await student.get('/courses/2/my-grades')).data.locked.reason, 'survey', 'other course still locked');
  assert.equal((await otherStudent.post(`/surveys/${id}/respond`, { course_id: 1, answers })).status, 403);

  // anonymous aggregated results for the course doctor; students can't read results
  const r = (await doctor.get(`/surveys/${id}/results?course_id=1`)).data;
  assert.equal(r.responses, 1);
  assert.equal(r.results.find((q) => q.id === 'q1').mean, 5);
  assert.ok(!JSON.stringify(r).includes('2023001'));
  assert.equal((await student.get(`/surveys/${id}/results?course_id=1`)).status, 403);
  await admin.post(`/surveys/${id}/status`, { status: 'closed' });
  assert.equal((await student.get('/courses/2/my-grades')).data.locked, undefined, 'closing a survey removes the gate');
});

test('login cards: issue temporary passwords for a course, skipping people already using the system', async () => {
  const r = await admin.post('/admin/users/issue-credentials', { course_id: 3 });
  assert.equal(r.status, 200);
  assert.ok(r.data.skipped >= 1, 'already-active users are skipped by default');
  assert.ok(!r.data.cards.some((c) => c.username === '2023001'));
  const card = r.data.cards.find((c) => c.role === 'student');
  assert.match(card.password, /^[a-z0-9]{8}$/);
  const fresh = await client(srv.base, card.username, card.password);
  assert.equal(fresh.user.must_change_password, true);
  assert.equal((await doctor.post('/admin/users/issue-credentials', { course_id: 3 })).status, 403);
});

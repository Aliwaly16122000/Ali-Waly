import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, UserPlus, Users, Trash2, Save, Search, GraduationCap, ExternalLink, Printer } from 'lucide-react';
import { openCards } from '../../lib/cards';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { LEVEL_LABELS } from '../../lib/format';
import { Button, Card, CardHeader, ConfirmModal, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Table, Td, Th, cx } from '../../components/ui';

function StaffPicker({ label, users, selected, onChange }) {
  const [q, setQ] = useState('');
  const list = users.filter((u) => !q || u.name.includes(q));
  return (
    <div>
      <p className="text-sm font-semibold mb-2">{label}</p>
      <Input className="mb-2 h-9" placeholder="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-56 overflow-y-auto rounded-xl border border-line divide-y divide-line">
        {list.map((u) => (
          <label key={u.id} className={cx('flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2', selected.includes(u.id) && 'bg-brand-50 dark:bg-brand-500/10')}>
            <input type="checkbox" className="size-4 accent-brand-600" checked={selected.includes(u.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} />
            <span className="flex-1 text-sm font-semibold">{u.name}</span>
            <span className="text-xs text-muted">{u.department_name}</span>
          </label>
        ))}
        {!list.length && <p className="text-sm text-muted p-3">لا يوجد</p>}
      </div>
    </div>
  );
}

function EnrollModal({ course, departments, onClose, onDone }) {
  const [mode, setMode] = useState('cohort');
  const [cohort, setCohort] = useState({ department_id: course.department_id ?? '', level: course.level ?? '' });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [section, setSection] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: students } = useApi(mode === 'pick' ? `/admin/users?role=student${q ? `&q=${encodeURIComponent(q)}` : ''}` : null);

  const run = async () => {
    setBusy(true);
    try {
      const res = mode === 'cohort'
        ? await api.post(`/admin/courses/${course.id}/enroll-cohort`, { department_id: Number(cohort.department_id), level: Number(cohort.level) })
        : await api.post(`/admin/courses/${course.id}/enrollments`, { student_ids: picked, section: section || null });
      toast.success(`تم تسجيل ${res.added} طالب`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="تسجيل طلاب في المادة" subtitle={course.name}
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button icon={UserPlus} loading={busy} onClick={run}
        disabled={mode === 'cohort' ? cohort.department_id === '' || cohort.level === '' : !picked.length}>تسجيل</Button></>}>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {[['cohort', 'دفعة كاملة', 'كل طلاب قسم وفرقة'], ['pick', 'طلاب محددين', 'اختيار بالاسم أو الكود']].map(([v, t, d]) => (
          <button key={v} onClick={() => setMode(v)} className={cx('rounded-xl border p-3 text-right', mode === v ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line')}>
            <p className="font-bold">{t}</p><p className="text-xs text-muted">{d}</p>
          </button>
        ))}
      </div>
      {mode === 'cohort' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="القسم">{(id) => <Select id={id} value={cohort.department_id} onChange={(e) => setCohort({ ...cohort, department_id: e.target.value })}><option value="">اختر</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
          <Field label="الفرقة">{(id) => <Select id={id} value={cohort.level} onChange={(e) => setCohort({ ...cohort, level: e.target.value })}><option value="">اختر</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</Select>}</Field>
        </div>
      ) : (
        <>
          <div className="flex gap-3 mb-3">
            <div className="relative flex-1"><Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" /><Input className="pr-9" placeholder="ابحث بالاسم أو الكود" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Input className="w-36" placeholder="السكشن (اختياري)" value={section} onChange={(e) => setSection(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line divide-y divide-line">
            {(students || []).slice(0, 200).map((s) => (
              <label key={s.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2">
                <input type="checkbox" className="size-4 accent-brand-600" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                <span className="flex-1 text-sm font-semibold">{s.name}</span>
                <span className="text-xs text-muted ltr">{s.username}</span>
                <span className="text-xs text-muted">{s.department_name} · {LEVEL_LABELS[s.level] ?? ''}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">تم اختيار {picked.length}</p>
        </>
      )}
    </Modal>
  );
}

export default function CourseManage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: courses, error, loading, reload: reloadCourses } = useApi('/admin/courses');
  const { data: doctors } = useApi('/admin/users?role=doctor');
  const { data: tas } = useApi('/admin/users?role=ta');
  const { data: departments } = useApi('/admin/departments');
  const { data: enrolled, reload } = useApi(`/admin/courses/${id}/enrollments`);
  const course = courses?.find((c) => c.id === Number(id));
  const [staff, setStaff] = useState(null);
  const [savingStaff, setSavingStaff] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [q, setQ] = useState('');
  const [removing, setRemoving] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [includeActive, setIncludeActive] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const issueCards = async () => {
    setIssuing(true);
    try {
      const r = await api.post('/admin/users/issue-credentials', { course_id: Number(id), include_active: includeActive });
      if (!r.cards.length) toast.info(`كل المستخدمين دخلوا قبل كده (${r.skipped}) — فعّل الاختيار لو عايز تعمل لهم كلمات سر جديدة`);
      else { openCards(r.cards); setCardsOpen(false); }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIssuing(false);
    }
  };

  const current = useMemo(() => staff ?? (course ? {
    doctors: course.staff.filter((s) => s.role === 'doctor').map((s) => s.id),
    tas: course.staff.filter((s) => s.role === 'ta').map((s) => s.id),
  } : null), [staff, course]);

  if (loading && !courses) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reloadCourses} />;
  if (!course) return <EmptyState title="المادة غير موجودة" />;

  const saveStaff = async () => {
    setSavingStaff(true);
    try {
      await api.put(`/admin/courses/${id}/staff`, current);
      toast.success('تم حفظ هيئة التدريس');
      setStaff(null);
      reloadCourses(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingStaff(false);
    }
  };
  const updateSection = async (studentId, section) => {
    await api.put(`/admin/courses/${id}/enrollments/${studentId}`, { section });
  };
  const unenroll = async () => {
    await api.del(`/admin/courses/${id}/enrollments/${removing.id}`);
    setRemoving(null);
    reload(true);
    reloadCourses(true);
  };
  const deleteCourse = async () => {
    await api.del(`/admin/courses/${id}`);
    toast.success('تم حذف المادة');
    navigate('/admin/courses');
  };

  const list = (enrolled || []).filter((s) => !q || s.name.includes(q) || s.username.includes(q));
  return (
    <>
      <Link to="/admin/courses" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4"><ChevronRight className="size-4" /> المواد</Link>
      <PageHeader title={course.name} subtitle={`${course.code} · ${course.department_name ?? ''} · ${LEVEL_LABELS[course.level] ?? ''}`}
        actions={<>
          <Button variant="secondary" icon={ExternalLink} to={`/courses/${id}`}>صفحة المادة</Button>
          <Button variant="secondary" icon={Printer} onClick={() => setCardsOpen(true)}>كروت دخول المادة</Button>
          <Button variant="ghost" icon={Trash2} className="hover:text-rose-600" onClick={() => setDeleting(true)}>حذف المادة</Button>
        </>} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="h-fit">
          <CardHeader icon={GraduationCap} title="هيئة التدريس" subtitle="الدكتور والمعيدين المسؤولين عن المادة" />
          <div className="px-5 pb-5 space-y-5">
            <StaffPicker label="الدكاترة" users={doctors || []} selected={current.doctors} onChange={(doctorsSel) => setStaff({ ...current, doctors: doctorsSel })} />
            <StaffPicker label="المعيدون" users={tas || []} selected={current.tas} onChange={(tasSel) => setStaff({ ...current, tas: tasSel })} />
            <Button icon={Save} className="w-full" loading={savingStaff} disabled={!staff} onClick={saveStaff}>حفظ</Button>
          </div>
        </Card>
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader icon={Users} title={`الطلاب المسجلون (${enrolled?.length ?? 0})`} action={<Button icon={UserPlus} onClick={() => setEnrolling(true)}>تسجيل طلاب</Button>} />
          <div className="px-5 pb-3"><Input placeholder="بحث" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {!list.length ? <EmptyState icon={Users} title="لا يوجد طلاب مسجلون" /> : (
            <Table className="max-h-[60vh]">
              <thead className="sticky top-0"><tr><Th>الطالب</Th><Th>القسم</Th><Th className="w-36">السكشن</Th><Th /></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <Td><p className="font-semibold">{s.name}</p><p className="text-xs text-muted ltr text-right">{s.username}</p></Td>
                    <Td className="text-muted text-xs">{s.department_name} · {LEVEL_LABELS[s.level] ?? ''}</Td>
                    <Td><Input className="h-8" defaultValue={s.section ?? ''} placeholder="—" onBlur={(e) => e.target.value !== (s.section ?? '') && updateSection(s.id, e.target.value)} /></Td>
                    <Td><button className="p-2 rounded-lg text-muted hover:text-rose-600" onClick={() => setRemoving(s)} title="إلغاء التسجيل"><Trash2 className="size-4" /></button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      {enrolling && <EnrollModal course={course} departments={departments || []} onClose={() => setEnrolling(false)} onDone={() => { setEnrolling(false); reload(true); reloadCourses(true); }} />}
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={unenroll} title="إلغاء تسجيل الطالب" message={`إلغاء تسجيل ${removing?.name} من المادة؟`} confirmLabel="إلغاء التسجيل" />
      <Modal open={cardsOpen} onClose={() => setCardsOpen(false)} title="كروت دخول المادة" subtitle="كارت لكل طالب ولهيئة التدريس فيه اسم المستخدم وكلمة سر مؤقتة وكود QR"
        footer={<><Button variant="secondary" onClick={() => setCardsOpen(false)}>إلغاء</Button><Button icon={Printer} loading={issuing} onClick={issueCards}>إنشاء وطباعة</Button></>}>
        <p className="text-sm text-muted mb-3">هيتعمل كلمة سر مؤقتة جديدة لكل واحد، وأول ما يدخل هيغيرها. الكروت بتتفتح في صفحة جديدة جاهزة للطباعة (8 كروت في الورقة).</p>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-brand-600" checked={includeActive} onChange={(e) => setIncludeActive(e.target.checked)} />
          تشمل اللي دخلوا قبل كده (كلمة السر الحالية بتاعتهم هتتلغي)
        </label>
      </Modal>
      <ConfirmModal open={deleting} onClose={() => setDeleting(false)} onConfirm={deleteCourse} title="حذف المادة" message="هيتم حذف المادة وكل الشيتات والدرجات والحضور الخاص بيها نهائياً." confirmLabel="حذف نهائياً" />
    </>
  );
}

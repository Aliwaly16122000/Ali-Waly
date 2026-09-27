import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Library, Users, Pencil, ChevronLeft, Upload, Download, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../../lib/api';
import { CredentialsModal } from './Users';
import { useApi } from '../../lib/useApi';
import { LEVEL_LABELS, SEMESTER_LABELS, titled } from '../../lib/format';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, FileDrop, Input, Modal, PageHeader, PageLoader, Select, Table, Td, Textarea, Th } from '../../components/ui';

const currentYear = () => {
  const d = new Date();
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
};

export function CourseForm({ initial, departments, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ?? {
    code: '', name: '', department_id: '', level: '', semester: new Date().getMonth() >= 7 || new Date().getMonth() < 1 ? 'fall' : 'spring',
    academic_year: currentYear(), credit_hours: 3, description: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      code: form.code, name: form.name, semester: form.semester, academic_year: form.academic_year,
      department_id: form.department_id ? Number(form.department_id) : null,
      level: form.level === '' || form.level === null ? null : Number(form.level),
      credit_hours: Number(form.credit_hours), description: form.description || null,
    };
    try {
      const res = initial?.id ? await api.put(`/admin/courses/${initial.id}`, body) : await api.post('/admin/courses', body);
      toast.success('تم الحفظ');
      onSaved(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={initial?.id ? 'تعديل المادة' : 'مادة جديدة'}
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="course-form" type="submit" loading={saving}>حفظ</Button></>}>
      <form id="course-form" onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        <Field label="اسم المادة" className="sm:col-span-2">{(id) => <Input id={id} value={form.name} onChange={set('name')} required placeholder="هياكل البيانات" />}</Field>
        <Field label="كود المادة">{(id) => <Input id={id} dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required placeholder="CSE321" />}</Field>
        <Field label="الساعات المعتمدة">{(id) => <Input id={id} type="number" min="0" max="12" dir="ltr" value={form.credit_hours} onChange={set('credit_hours')} />}</Field>
        <Field label="القسم">{(id) => <Select id={id} value={form.department_id ?? ''} onChange={set('department_id')}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="الفرقة">{(id) => <Select id={id} value={form.level ?? ''} onChange={set('level')}><option value="">—</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</Select>}</Field>
        <Field label="الترم">{(id) => <Select id={id} value={form.semester} onChange={set('semester')}>{Object.entries(SEMESTER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="العام الدراسي">{(id) => <Input id={id} dir="ltr" value={form.academic_year} onChange={set('academic_year')} required pattern="\d{4}/\d{4}" />}</Field>
        <Field label="وصف المادة" className="sm:col-span-2">{(id) => <Textarea id={id} value={form.description ?? ''} onChange={set('description')} />}</Field>
      </form>
    </Modal>
  );
}

/** One workbook → a department's courses, their doctors/TAs and the weekly timetable. */
function PlanImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [result, setResult] = useState(null);

  const run = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const res = await api.post('/admin/plan/import', toForm({ file }));
      setResult(res);
      onDone(res);
    } catch (err) {
      setErrors(err.data?.errors || []);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="استيراد خطة القسم" subtitle="المواد + الدكاترة والمعيدين + الجدول الأسبوعي في ملف واحد"
      footer={<><Button variant="secondary" onClick={onClose}>إغلاق</Button>{!result && <Button icon={Upload} loading={busy} disabled={!file} onClick={run}>استيراد</Button>}</>}>
      {result ? (
        <Alert tone="green" icon={CheckCircle2} title="تم تنزيل الخطة">
          {result.courses_created} مادة جديدة · {result.courses_updated} مادة اتحدثت · {result.slots} ميعاد في الجدول · {result.staff_links} إسناد لهيئة التدريس
          {result.enrolled > 0 && ` · ${result.enrolled} تسجيل طالب في مادة`}
          {result.created.length > 0 && ` · ${result.created.length} حساب جديد`}
          {result.departments.length > 0 && ` · قسم جديد: ${result.departments.map((d) => d.name).join('، ')}`}
          <p className="mt-2">الخطوة الجاية: سجّل الطلبة من "إدارة" المادة ← تسجيل دفعة كاملة.</p>
        </Alert>
      ) : (
        <>
          <div className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-4 mb-4 flex flex-wrap items-center gap-4">
            <FileSpreadsheet className="size-10 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-56">
              <p className="font-bold">1) حمّل النموذج واملأه</p>
              <p className="text-sm text-muted">شيت للدكاترة والمعيدين، شيت للمواد، وشيت للجدول. المواد بتتسجل في الترم الحالي، ولو رفعت الملف تاني بيتحدث من غير تكرار.</p>
            </div>
            <Button as="a" href="/api/admin/plan/template.xlsx" icon={Download}>تحميل النموذج</Button>
          </div>
          <p className="font-bold mb-2">2) ارفع الملف</p>
          <FileDrop file={file} onChange={setFile} accept=".xlsx" hint="ملف خطة القسم (.xlsx) — لو فيه أي خطأ مفيش حاجة بتتغير" />
          {errors.length > 0 && (
            <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-500/30 max-h-56 overflow-y-auto">
              {errors.map((e, i) => <p key={i} className="text-sm px-3 py-1.5 border-b border-line last:border-0"><b>{e.sheet ? `شيت ${e.sheet} · ` : ''}صف {e.row}:</b> {e.error}</p>)}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function AdminCourses() {
  const { data, error, loading, reload } = useApi('/admin/courses');
  const { data: departments } = useApi('/admin/departments');
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [creds, setCreds] = useState(null);
  const list = useMemo(() => (data || []).filter((c) => (!dept || c.department_id === Number(dept)) && (!q || c.name.includes(q) || c.code.includes(q.toUpperCase()))), [data, dept, q]);

  return (
    <>
      <PageHeader title="المواد والتسجيل" subtitle="أنشئ المواد، أسند الدكاترة والمعيدين، وسجّل الطلاب" actions={<><Button variant="secondary" icon={Upload} onClick={() => setPlanOpen(true)}>استيراد خطة القسم</Button><Button icon={Plus} onClick={() => setEditing({})}>مادة جديدة</Button></>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 p-4 border-b border-line">
          <div className="relative flex-1 min-w-48">
            <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input className="pr-9" placeholder="بحث بالاسم أو الكود" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-56" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">كل الأقسام</option>{(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !list.length ? <EmptyState icon={Library} title="لا توجد مواد" /> : (
          <Table>
            <thead><tr><Th>المادة</Th><Th>القسم / الفرقة</Th><Th>الترم</Th><Th>هيئة التدريس</Th><Th>الطلاب</Th><Th /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <Td><p className="font-semibold">{c.name}</p><p className="text-xs text-muted ltr text-right">{c.code} · {c.credit_hours} ساعات</p></Td>
                  <Td className="text-muted"><p>{c.department_name || '—'}</p><p className="text-xs">{LEVEL_LABELS[c.level] ?? ''}</p></Td>
                  <Td className="text-muted whitespace-nowrap text-xs">{SEMESTER_LABELS[c.semester]}<br /><span className="ltr">{c.academic_year}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1 max-w-72">
                      {c.staff.length ? c.staff.map((s) => <Badge key={s.id} tone={s.role === 'doctor' ? 'blue' : 'violet'}>{titled(s)}</Badge>) : <Badge tone="red">بدون دكتور</Badge>}
                    </div>
                  </Td>
                  <Td><Badge tone={c.students_count ? 'green' : 'amber'}><Users className="size-3" /> {c.students_count}</Badge></Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <button className="p-2 rounded-lg text-muted hover:bg-surface-2" onClick={() => setEditing(c)} title="تعديل"><Pencil className="size-4" /></button>
                      <Button size="sm" variant="soft" to={`/admin/courses/${c.id}`}>إدارة <ChevronLeft className="size-4" /></Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <CourseForm initial={editing.id ? editing : null} departments={departments || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(true); }} />}
      {planOpen && <PlanImportModal onClose={() => setPlanOpen(false)} onDone={(r) => { reload(true); if (r.created.length) setCreds(r.created); }} />}
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
    </>
  );
}

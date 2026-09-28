import { useMemo, useState } from 'react';
import { Landmark, Plus, Pencil, Trash2, Crown, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ROLE_LABELS } from '../../lib/format';
import { Alert, Badge, Button, Card, CardHeader, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Table, Td, Th } from '../../components/ui';

const SCOPES = { university: 'رئيس الجامعة / نوابه', faculty: 'عميد / وكيل كلية', department: 'رئيس قسم' };

function FacultyForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial ?? { name: '', code: '' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (initial?.id) await api.put(`/admin/faculties/${initial.id}`, { name: form.name, code: form.code });
      else await api.post('/admin/faculties', { name: form.name, code: form.code });
      toast.success('تم الحفظ');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={initial?.id ? 'تعديل الكلية' : 'كلية جديدة'}
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="fac" type="submit" loading={saving}>حفظ</Button></>}>
      <form id="fac" onSubmit={save} className="space-y-4">
        <Field label="اسم الكلية">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="كلية الهندسة" />}</Field>
        <Field label="الكود المختصر">{(id) => <Input id={id} dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required placeholder="ENG" />}</Field>
      </form>
    </Modal>
  );
}

function LeaderForm({ faculties, departments, onClose, onSaved }) {
  const [q, setQ] = useState('');
  const { data: users } = useApi(`/admin/users?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState({ user_id: '', scope: 'department', scope_id: '', title: '' });
  const [saving, setSaving] = useState(false);
  const candidates = (users || []).filter((u) => u.role !== 'student').slice(0, 50);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/admin/oversight', {
        user_id: Number(form.user_id), scope: form.scope, scope_id: form.scope === 'university' ? 0 : Number(form.scope_id), title: form.title || null,
      });
      toast.success('تم التعيين — يقدر يتابع من "لوحة المتابعة"');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="تعيين صلاحية متابعة" subtitle="عرض فقط: إحصائيات ومتابعة من غير تعديل"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="lead" type="submit" loading={saving} disabled={!form.user_id}>تعيين</Button></>}>
      <form id="lead" onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="ابحث عن الشخص" className="sm:col-span-2">
          {(id) => (
            <>
              <div className="relative mb-2"><Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" /><Input id={id} className="pr-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الدكتور أو اسم المستخدم" /></div>
              <Select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required>
                <option value="">اختر…</option>
                {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABELS[u.role]} · {u.username}</option>)}
              </Select>
            </>
          )}
        </Field>
        <Field label="الصلاحية">{(id) => <Select id={id} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, scope_id: '' })}>{Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        {form.scope === 'faculty' && <Field label="الكلية">{(id) => <Select id={id} value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} required><option value="">اختر</option>{faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>}
        {form.scope === 'department' && <Field label="القسم">{(id) => <Select id={id} value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} required><option value="">اختر</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.faculty_name ? ` · ${d.faculty_name}` : ''}</option>)}</Select>}</Field>}
        {form.scope === 'university' && <div />}
        <Field label="المسمى" hint="اختياري — مثلاً: وكيل الكلية لشئون التعليم" className="sm:col-span-2">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
      </form>
      <Alert tone="blue" className="mt-4">لو الشخص مش دكتور (مثلاً رئيس الجامعة)، أضفه الأول من "المستخدمون" بنوع "قيادات".</Alert>
    </Modal>
  );
}

export default function Faculties() {
  const { data: faculties, loading, reload } = useApi('/admin/faculties');
  const { data: departments } = useApi('/admin/departments');
  const { data: leaders, reload: reloadLeaders } = useApi('/admin/oversight');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [leading, setLeading] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const deptsByFaculty = useMemo(() => {
    const m = new Map();
    for (const d of departments || []) { if (!m.has(d.faculty_id)) m.set(d.faculty_id, []); m.get(d.faculty_id).push(d); }
    return m;
  }, [departments]);

  if (loading && !faculties) return <PageLoader />;
  return (
    <>
      <PageHeader title="الكليات والقيادات" subtitle="هيكل الجامعة: كليات ← أقسام ← فرق، وصلاحيات المتابعة لرؤساء الأقسام والعمداء ورئيس الجامعة"
        actions={<><Button variant="secondary" icon={Crown} onClick={() => setLeading(true)}>تعيين قيادة</Button><Button icon={Plus} onClick={() => setEdit({})}>كلية جديدة</Button></>} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {faculties.map((f) => (
          <Card key={f.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="size-11 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 grid place-items-center shrink-0"><Landmark className="size-5" /></div>
              <div className="flex-1 min-w-0"><p className="font-bold">{f.name}</p><p className="text-sm text-muted ltr text-right">{f.code}</p></div>
              <button className="p-2 rounded-lg text-muted hover:bg-surface-2" onClick={() => setEdit(f)} aria-label="تعديل"><Pencil className="size-4" /></button>
              <button className="p-2 rounded-lg text-muted hover:text-rose-600" onClick={() => setDel(f)} aria-label="حذف"><Trash2 className="size-4" /></button>
            </div>
            <div className="flex gap-4 mt-3 text-sm"><span><b>{f.departments}</b> <span className="text-muted">قسم</span></span><span><b>{f.students}</b> <span className="text-muted">طالب</span></span></div>
            {f.deans && <p className="text-xs text-muted mt-2">العميد: {f.deans}</p>}
            <div className="flex flex-wrap gap-1 mt-3">{(deptsByFaculty.get(f.id) || []).map((d) => <Badge key={d.id}>{d.name}</Badge>)}</div>
          </Card>
        ))}
        {!faculties.length && <Card className="md:col-span-2 xl:col-span-3"><EmptyState icon={Landmark} title="لا توجد كليات" /></Card>}
      </div>

      <Card className="overflow-hidden">
        <CardHeader icon={Crown} title="القيادات وصلاحيات المتابعة" subtitle="بيشوفوا الإحصائيات والمتابعة فقط، من غير أي تعديل" />
        {!leaders?.length ? <EmptyState title="لم يتم تعيين قيادات بعد" /> : (
          <Table>
            <thead><tr><Th>الاسم</Th><Th>المسمى</Th><Th>نطاق المتابعة</Th><Th /></tr></thead>
            <tbody>
              {leaders.map((o) => (
                <tr key={`${o.user_id}-${o.scope}-${o.scope_id}`}>
                  <Td><p className="font-semibold">{o.name}</p><p className="text-xs text-muted">{ROLE_LABELS[o.role]} · <span className="ltr">{o.username}</span></p></Td>
                  <Td>{o.title}</Td>
                  <Td><Badge tone={o.scope === 'university' ? 'violet' : o.scope === 'faculty' ? 'blue' : 'slate'}>{o.scope_name}</Badge></Td>
                  <Td className="text-left"><Button size="sm" variant="ghost" className="hover:text-rose-600" onClick={() => setRevoke(o)}>إلغاء</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {edit && <FacultyForm initial={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(true); }} />}
      {leading && <LeaderForm faculties={faculties} departments={departments || []} onClose={() => setLeading(false)} onSaved={() => { setLeading(false); reloadLeaders(true); reload(true); }} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="حذف الكلية" confirmLabel="حذف"
        message={`حذف "${del?.name}"؟ الأقسام والطلاب والمواد مش هيتحذفوا، بس الأقسام هتبقى من غير كلية لحد ما تنقلها.`}
        onConfirm={async () => { await api.del(`/admin/faculties/${del.id}`); setDel(null); reload(true); }} />
      <ConfirmModal open={!!revoke} onClose={() => setRevoke(null)} title="إلغاء صلاحية المتابعة" confirmLabel="إلغاء الصلاحية"
        message={`إلغاء صلاحية "${revoke?.title}" من ${revoke?.name}؟`}
        onConfirm={async () => { await api.del(`/admin/oversight?user_id=${revoke.user_id}&scope=${revoke.scope}&scope_id=${revoke.scope_id}`); setRevoke(null); reloadLeaders(true); reload(true); }} />
    </>
  );
}

import { useState } from 'react';
import { Building2, Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select } from '../../components/ui';

export default function Departments() {
  const { data, error, loading, reload } = useApi('/admin/departments');
  const { data: faculties } = useApi('/admin/faculties');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: edit.name, code: edit.code, faculty_id: edit.faculty_id ? Number(edit.faculty_id) : null };
      if (edit.id) await api.put(`/admin/departments/${edit.id}`, body);
      else await api.post('/admin/departments', body);
      toast.success('تم الحفظ');
      setEdit(null);
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    await api.del(`/admin/departments/${del.id}`);
    setDel(null);
    reload(true);
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="الأقسام" subtitle="أقسام الكلية والسنة الإعدادية" actions={<Button icon={Plus} onClick={() => setEdit({ name: '', code: '', faculty_id: faculties?.[0]?.id ?? '' })}>قسم جديد</Button>} />
      {!data.length ? <Card><EmptyState icon={Building2} title="لا توجد أقسام" /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="size-11 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 grid place-items-center shrink-0"><Building2 className="size-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold">{d.name}</p>
                  <p className="text-sm text-muted"><span className="ltr">{d.code}</span>{d.faculty_name && ` · ${d.faculty_name}`}</p>
                  {d.heads && <p className="text-xs text-muted mt-0.5">رئيس القسم: {d.heads}</p>}
                </div>
                <button className="p-2 rounded-lg text-muted hover:bg-surface-2" onClick={() => setEdit(d)} aria-label="تعديل"><Pencil className="size-4" /></button>
                <button className="p-2 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => setDel(d)} aria-label="حذف"><Trash2 className="size-4" /></button>
              </div>
              <div className="flex gap-4 mt-4 text-sm">
                <span><b>{d.students}</b> <span className="text-muted">طالب</span></span>
                <span><b>{d.courses}</b> <span className="text-muted">مادة</span></span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل القسم' : 'قسم جديد'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button><Button form="dept" type="submit" loading={saving}>حفظ</Button></>}>
        {edit && (
          <form id="dept" onSubmit={save} className="space-y-4">
            <Field label="اسم القسم">{(id) => <Input id={id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required placeholder="هندسة الحاسبات والتحكم" />}</Field>
            <Field label="الكلية">{(id) => <Select id={id} value={edit.faculty_id ?? ''} onChange={(e) => setEdit({ ...edit, faculty_id: e.target.value })}><option value="">—</option>{(faculties || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
            <Field label="الكود المختصر" hint="يُستخدم في استيراد الطلاب من Excel">{(id) => <Input id={id} dir="ltr" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} required placeholder="CSE" />}</Field>
          </form>
        )}
      </Modal>
      <ConfirmModal open={!!del} onClose={() => setDel(null)} onConfirm={remove} title="حذف القسم" message={`حذف "${del?.name}"؟ الطلاب والمواد لن يُحذفوا لكن سيصبحوا بدون قسم.`} confirmLabel="حذف" />
    </>
  );
}

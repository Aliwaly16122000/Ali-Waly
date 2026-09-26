import { useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { LEVEL_LABELS } from '../../lib/format';
import { Button, Card, Field, Input, PageHeader, Select, Textarea, cx } from '../../components/ui';

const ROLE_OPTS = [['student', 'الطلاب'], ['ta', 'المعيدون'], ['doctor', 'أعضاء هيئة التدريس']];

export default function Broadcast() {
  const { data: departments } = useApi('/admin/departments');
  const [form, setForm] = useState({ title: '', body: '', roles: ['student'], department_id: '', level: '' });
  const [sending, setSending] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const { sent } = await api.post('/admin/broadcast', {
        title: form.title, body: form.body || undefined, roles: form.roles,
        department_id: form.department_id ? Number(form.department_id) : null, level: form.level === '' ? null : Number(form.level),
      });
      toast.success(`تم الإرسال إلى ${sent} مستخدم`);
      setForm({ ...form, title: '', body: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };
  const toggleRole = (r) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));
  return (
    <div className="max-w-2xl">
      <PageHeader title="إعلانات الكلية" subtitle="إشعار فوري لكل الكلية أو لقسم أو فرقة معينة (إجازات، مواعيد امتحانات، تعليمات…)" />
      <Card className="p-6">
        <form onSubmit={send} className="space-y-4">
          <Field label="إرسال إلى">
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTS.map(([k, v]) => (
                <button key={k} type="button" onClick={() => toggleRole(k)}
                  className={cx('rounded-full border px-4 py-1.5 text-sm font-semibold', form.roles.includes(k) ? 'bg-brand-600 text-white border-brand-600' : 'border-line text-muted')}>{v}</button>
              ))}
            </div>
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="القسم">{(id) => <Select id={id} value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}><option value="">كل الأقسام</option>{(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
            <Field label="الفرقة" hint="تُطبَّق على الطلاب فقط">{(id) => <Select id={id} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}><option value="">كل الفرق</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</Select>}</Field>
          </div>
          <Field label="العنوان">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="جدول امتحانات الترم الأول" />}</Field>
          <Field label="التفاصيل">{(id) => <Textarea id={id} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}</Field>
          <Button type="submit" icon={Send} loading={sending} disabled={!form.roles.length}>إرسال الإشعار</Button>
        </form>
      </Card>
      <p className="text-sm text-muted mt-4 flex items-center gap-2"><Megaphone className="size-4" /> الإشعار بيوصل داخل التطبيق وعلى الموبايل لكل من فعّل الإشعارات.</p>
    </div>
  );
}

import { useState } from 'react';
import { toast } from 'sonner';
import { api, toForm } from '../../lib/api';
import { TYPE_LABELS } from '../../lib/format';
import { Button, Field, FileDrop, Input, Modal, Select, Textarea } from '../../components/ui';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Create / edit modal for a sheet, quiz, midterm, project… */
export default function AssessmentForm({ open, onClose, courseId, initial, onSaved }) {
  const editing = !!initial;
  const [form, setForm] = useState(() => ({
    title: initial?.title ?? '',
    type: initial?.type ?? 'sheet',
    max_score: initial?.max_score ?? 10,
    due_at: toLocalInput(initial?.due_at),
    accepts_submissions: initial ? !!initial.accepts_submissions : true,
    description: initial?.description ?? '',
    attachment: null,
  }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = toForm({
        title: form.title, type: form.type, max_score: form.max_score, description: form.description,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : '', accepts_submissions: String(form.accepts_submissions),
        attachment: form.attachment,
      });
      if (!form.due_at) body.append('due_at', '');
      const res = editing ? await api.put(`/assessments/${initial.id}`, body) : await api.post(`/courses/${courseId}/assessments`, body);
      toast.success(editing ? 'تم حفظ التعديلات' : 'تم النشر وإرسال إشعار للطلاب');
      onSaved?.(res);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const noSubmissionTypes = ['quiz', 'midterm', 'final'];
  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? 'تعديل التقييم' : 'تقييم جديد'}
      subtitle={editing ? undefined : 'شيت، كويز، ميدترم، مشروع… الطلاب هيوصلهم إشعار'}
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" form="assessment-form" loading={saving}>{editing ? 'حفظ' : 'نشر'}</Button></>}>
      <form id="assessment-form" onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        <Field label="العنوان" className="sm:col-span-2">{(id) => <Input id={id} value={form.title} onChange={set('title')} required placeholder="شيت 5 - Sorting" />}</Field>
        <Field label="النوع">
          {(id) => (
            <Select id={id} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, accepts_submissions: editing ? form.accepts_submissions : !noSubmissionTypes.includes(e.target.value) })}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="الدرجة العظمى">{(id) => <Input id={id} type="number" min="0.5" step="0.5" dir="ltr" value={form.max_score} onChange={set('max_score')} required />}</Field>
        <Field label="آخر موعد للتسليم" hint="اتركه فارغاً لو مفيش موعد">{(id) => <Input id={id} type="datetime-local" dir="ltr" value={form.due_at} onChange={set('due_at')} />}</Field>
        <label className="flex items-center gap-3 rounded-xl border border-line p-3 cursor-pointer self-end h-[42px] sm:h-auto">
          <input type="checkbox" className="size-4 accent-brand-600" checked={form.accepts_submissions} onChange={set('accepts_submissions')} />
          <span className="text-sm font-semibold">الطلاب يرفعوا حلولهم أونلاين</span>
        </label>
        <Field label="التعليمات" className="sm:col-span-2">{(id) => <Textarea id={id} value={form.description} onChange={set('description')} placeholder="حل المسائل 1-8 من الفصل الخامس…" />}</Field>
        <Field label="ملف الشيت (اختياري)" className="sm:col-span-2">
          <FileDrop file={form.attachment} onChange={(attachment) => setForm({ ...form, attachment })} hint={initial?.attachment_name ? `الملف الحالي: ${initial.attachment_name}` : 'PDF أو صورة'} />
        </Field>
      </form>
    </Modal>
  );
}

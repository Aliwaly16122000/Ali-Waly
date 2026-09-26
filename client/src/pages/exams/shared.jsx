import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';

export const EXAM_KINDS = { midterm: 'ميدترم', final: 'فاينال', practical: 'عملي', oral: 'شفوي' };
export const EXAM_TONES = { midterm: 'amber', final: 'red', practical: 'violet', oral: 'blue' };

const dateFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
export const examDay = (d) => dateFmt.format(new Date(`${d}T12:00:00`));

export function daysUntil(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${d}T00:00:00`) - today) / 86400000);
}

export function untilLabel(d) {
  const n = daysUntil(d);
  if (n < 0) return 'انتهى';
  if (n === 0) return 'النهارده';
  if (n === 1) return 'بكرة';
  return `بعد ${n} يوم`;
}

/** Create / edit one course exam (admin, or the course doctor). */
export function ExamForm({ initial, courses, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ?? {
    course_id: courses[0]?.id ?? '', kind: 'final', exam_date: '', start_time: '09:00', end_time: '12:00', location: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      course_id: Number(form.course_id), kind: form.kind, exam_date: form.exam_date, start_time: form.start_time, end_time: form.end_time,
      location: form.location || null, notes: form.notes || null,
    };
    try {
      if (initial?.id) await api.put(`/exams/${initial.id}`, body);
      else await api.post('/exams', body);
      toast.success(initial?.published ? 'تم التعديل وإبلاغ الطلاب' : 'تم الحفظ — اضغط "نشر" عشان يظهر للطلاب');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={initial?.id ? 'تعديل موعد امتحان' : 'إضافة امتحان'} subtitle="الموعد بيظهر لكل طلاب المادة"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="exam-form" type="submit" loading={saving}>حفظ</Button></>}>
      <form id="exam-form" onSubmit={save} className="grid sm:grid-cols-2 gap-4">
        <Field label="المادة" className="sm:col-span-2">
          {(id) => <Select id={id} value={form.course_id} onChange={set('course_id')} required>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>}
        </Field>
        <Field label="النوع">{(id) => <Select id={id} value={form.kind} onChange={set('kind')}>{Object.entries(EXAM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="التاريخ">{(id) => <Input id={id} type="date" dir="ltr" value={form.exam_date} onChange={set('exam_date')} required />}</Field>
        <Field label="من">{(id) => <Input id={id} type="time" dir="ltr" value={form.start_time} onChange={set('start_time')} required />}</Field>
        <Field label="إلى">{(id) => <Input id={id} type="time" dir="ltr" value={form.end_time} onChange={set('end_time')} required />}</Field>
        <Field label="المكان" hint="لو الطلاب ليهم لجان، كل طالب هيشوف لجنته" className="sm:col-span-2">{(id) => <Input id={id} value={form.location ?? ''} onChange={set('location')} placeholder="المدرج الكبير" />}</Field>
        <Field label="ملاحظات" className="sm:col-span-2">{(id) => <Textarea id={id} className="min-h-16" value={form.notes ?? ''} onChange={set('notes')} placeholder="مسموح بالآلة الحاسبة، الكتاب مغلق…" />}</Field>
      </form>
    </Modal>
  );
}

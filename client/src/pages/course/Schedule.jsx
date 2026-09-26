import { useState } from 'react';
import { Plus, Clock, MapPin, Pencil, Trash2, CalendarDays, BellRing, QrCode, User } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { DAY_LABELS, KIND_LABELS, KIND_TONES, WEEK_ORDER, clock12, titled } from '../../lib/format';
import { Alert, Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Select } from '../../components/ui';

const ATT_MODES = {
  remind: 'تذكير المحاضر بفتح الحضور (ضغطة واحدة)',
  auto: 'فتح الحضور تلقائياً',
  off: 'بدون حضور',
};

function SlotForm({ course, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ?? {
    kind: 'lecture', day_of_week: 6, start_time: '09:00', end_time: '11:00', location: '', section: '', staff_id: '',
    remind_before: 30, attendance_mode: 'remind', attendance_offset: 10, attendance_duration: 15,
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      kind: form.kind, day_of_week: Number(form.day_of_week), start_time: form.start_time, end_time: form.end_time,
      location: form.location || null, section: form.section || null, staff_id: form.staff_id ? Number(form.staff_id) : null,
      remind_before: Number(form.remind_before), attendance_mode: form.attendance_mode,
      attendance_offset: Number(form.attendance_offset), attendance_duration: Number(form.attendance_duration),
    };
    try {
      if (initial?.id) await api.put(`/schedule/${initial.id}`, body);
      else await api.post(`/courses/${course.id}/schedule`, body);
      toast.success('تم حفظ الموعد');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const staff = course.staff.filter((s) => (form.kind === 'lecture' ? s.role === 'doctor' : true));
  return (
    <Modal open onClose={onClose} size="lg" title={initial?.id ? 'تعديل الموعد' : 'موعد جديد'} subtitle="موعد أسبوعي ثابت طول الترم"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="slot-form" type="submit" loading={saving}>حفظ</Button></>}>
      <form id="slot-form" onSubmit={submit} className="grid sm:grid-cols-3 gap-4">
        <Field label="النوع">{(id) => <Select id={id} value={form.kind} onChange={set('kind')}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="اليوم">{(id) => <Select id={id} value={form.day_of_week} onChange={set('day_of_week')}>{WEEK_ORDER.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}</Select>}</Field>
        <Field label="المكان">{(id) => <Input id={id} value={form.location ?? ''} onChange={set('location')} placeholder="مدرج 1" />}</Field>
        <Field label="من">{(id) => <Input id={id} type="time" dir="ltr" value={form.start_time} onChange={set('start_time')} required />}</Field>
        <Field label="إلى">{(id) => <Input id={id} type="time" dir="ltr" value={form.end_time} onChange={set('end_time')} required />}</Field>
        <Field label="السكشن / المجموعة" hint="فارغ = كل الطلاب">{(id) => <Input id={id} value={form.section ?? ''} onChange={set('section')} placeholder="سكشن 1" />}</Field>
        <Field label={form.kind === 'lecture' ? 'المحاضر' : 'المعيد المسؤول'} className="sm:col-span-3" hint="فارغ = كل دكاترة المادة للمحاضرة، وكل المعيدين للسكشن">
          {(id) => <Select id={id} value={form.staff_id ?? ''} onChange={set('staff_id')}><option value="">الكل</option>{staff.map((s) => <option key={s.id} value={s.id}>{titled(s)}</option>)}</Select>}
        </Field>

        <div className="sm:col-span-3 rounded-2xl border border-line p-4 grid sm:grid-cols-3 gap-4 bg-surface-2">
          <p className="sm:col-span-3 font-bold flex items-center gap-2"><BellRing className="size-4 text-brand-500" /> التذكير والحضور التلقائي</p>
          <Field label="تذكير قبلها بـ (دقيقة)" hint="0 = بدون تذكير">{(id) => <Input id={id} type="number" min="0" dir="ltr" value={form.remind_before} onChange={set('remind_before')} />}</Field>
          <Field label="الحضور" className="sm:col-span-2">{(id) => <Select id={id} value={form.attendance_mode} onChange={set('attendance_mode')}>{Object.entries(ATT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          {form.attendance_mode !== 'off' && (
            <>
              <Field label="بعد بداية الموعد بـ (دقيقة)">{(id) => <Input id={id} type="number" min="0" dir="ltr" value={form.attendance_offset} onChange={set('attendance_offset')} />}</Field>
              <Field label="يقفل بعد (دقيقة)">{(id) => <Input id={id} type="number" min="1" dir="ltr" value={form.attendance_duration} onChange={set('attendance_duration')} />}</Field>
              <p className="text-xs text-muted self-center">
                {form.attendance_mode === 'auto'
                  ? `الساعة ${clock12(addMinutes(form.start_time, form.attendance_offset))} الحضور هيتفتح لوحده ويوصل للمحاضر إشعار يعرض الـ QR.`
                  : `الساعة ${clock12(addMinutes(form.start_time, form.attendance_offset))} المحاضر هيوصله إشعار — ضغطة واحدة تفتح الحضور وتعرض الـ QR.`}
              </p>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function addMinutes(t, m) {
  const [h, mm] = t.split(':').map(Number);
  const total = h * 60 + mm + Number(m || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function Schedule({ course }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/schedule`);
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);
  const staff = ['doctor', 'ta', 'admin'].includes(course.my_role);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const remove = async () => {
    await api.del(`/schedule/${del.id}`);
    setDel(null);
    reload(true);
  };

  const byDay = WEEK_ORDER.map((d) => ({ day: d, slots: data.filter((s) => s.day_of_week === d) })).filter((d) => d.slots.length);
  return (
    <>
      {staff && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <Alert tone="blue" icon={BellRing} className="flex-1 min-w-64 !py-2.5">الطلاب والمحاضر بيوصلهم تذكير قبل كل موعد، والحضور بيتفتح في الوقت اللي تحدده ويتقفل لوحده.</Alert>
          <Button icon={Plus} onClick={() => setEditing({})}>إضافة موعد</Button>
        </div>
      )}
      {!byDay.length ? <Card><EmptyState icon={CalendarDays} title="لم يتم تحديد مواعيد بعد" description={staff ? 'أضف مواعيد المحاضرات والسكاشن' : undefined} /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {byDay.map(({ day, slots }) => (
            <Card key={day} className="overflow-hidden">
              <p className="px-5 py-3 font-extrabold border-b border-line bg-surface-2">{DAY_LABELS[day]}</p>
              {slots.map((s) => (
                <div key={s.id} className="px-5 py-4 border-b border-line last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONES[s.kind]}>{KIND_LABELS[s.kind]}</Badge>
                      {s.section && <Badge>{s.section}</Badge>}
                    </div>
                    {staff && (
                      <div className="flex -m-1">
                        <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2" onClick={() => setEditing(s)} aria-label="تعديل"><Pencil className="size-4" /></button>
                        <button className="p-1.5 rounded-lg text-muted hover:text-rose-600" onClick={() => setDel(s)} aria-label="حذف"><Trash2 className="size-4" /></button>
                      </div>
                    )}
                  </div>
                  <p className="font-bold mt-2 flex items-center gap-1.5"><Clock className="size-4 text-muted" /> {clock12(s.start_time)} – {clock12(s.end_time)}</p>
                  {s.location && <p className="text-sm text-muted flex items-center gap-1.5 mt-1"><MapPin className="size-4" /> {s.location}</p>}
                  {s.staff_name && <p className="text-sm text-muted flex items-center gap-1.5 mt-1"><User className="size-4" /> {titled({ name: s.staff_name, role: s.staff_role })}</p>}
                  {staff && s.attendance_mode !== 'off' && (
                    <p className="text-xs text-muted flex items-center gap-1.5 mt-2"><QrCode className="size-3.5" />
                      {s.attendance_mode === 'auto' ? 'حضور تلقائي' : 'تذكير بالحضور'} بعد {s.attendance_offset} د · يقفل بعد {s.attendance_duration} د</p>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
      {editing && <SlotForm course={course} initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(true); }} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} onConfirm={remove} title="حذف الموعد" message="حذف هذا الموعد من جدول المادة؟" confirmLabel="حذف" />
    </>
  );
}

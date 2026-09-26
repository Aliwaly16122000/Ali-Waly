import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QrCode, Play, CalendarCheck, CheckCircle2, XCircle, Radio, ChevronDown, ChevronUp, MapPin, Crosshair, Smartphone } from 'lucide-react';
import { getLocation } from '../../lib/device';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { fmtDateTime, pctTone, timeAgo } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Progress, Select, StatCard, Table, Td, Th, Spinner, cx } from '../../components/ui';

function GeoSettings({ course }) {
  const [form, setForm] = useState({
    geo_enabled: !!course.geo_enabled, geo_lat: course.geo_lat, geo_lng: course.geo_lng,
    geo_radius: course.geo_radius || 300, geo_label: course.geo_label || '',
  });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const useHere = async () => {
    setLocating(true);
    try {
      const p = await getLocation();
      set({ geo_lat: Number(p.lat.toFixed(6)), geo_lng: Number(p.lng.toFixed(6)) });
      toast.success(`تم تحديد الموقع (دقة ±${Math.round(p.accuracy)} متر)`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLocating(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/courses/${course.id}/attendance-settings`, {
        geo_enabled: form.geo_enabled, geo_lat: form.geo_lat ?? null, geo_lng: form.geo_lng ?? null,
        geo_radius: Number(form.geo_radius), geo_label: form.geo_label || null,
      });
      toast.success(form.geo_enabled ? 'تم تفعيل التحقق من الموقع' : 'تم إيقاف التحقق من الموقع');
      setDirty(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const hasPoint = form.geo_lat != null && form.geo_lng != null;
  return (
    <Card className="mb-6">
      <CardHeader icon={MapPin} title="التحقق من الموقع (اختياري)" subtitle="الطالب لازم يكون جوه المدرج أو الكلية عشان يسجل حضوره" />
      <div className="px-5 pb-5 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer w-fit">
          <input type="checkbox" className="size-5 accent-brand-600" checked={form.geo_enabled} onChange={(e) => set({ geo_enabled: e.target.checked })} />
          <span className="font-semibold">تفعيل التحقق من الموقع في المادة دي</span>
        </label>
        {form.geo_enabled && (
          <div className="grid sm:grid-cols-3 gap-4 items-end">
            <Field label="المكان">{(id) => <Input id={id} value={form.geo_label} onChange={(e) => set({ geo_label: e.target.value })} placeholder="مدرج 1 / مبنى الكلية" />}</Field>
            <Field label="المسافة المسموحة">
              {(id) => (
                <Select id={id} value={form.geo_radius} onChange={(e) => set({ geo_radius: e.target.value })}>
                  {[100, 200, 300, 500, 800, 1000].map((m) => <option key={m} value={m}>{m} متر</option>)}
                </Select>
              )}
            </Field>
            <Button variant="secondary" icon={Crosshair} loading={locating} onClick={useHere}>{hasPoint ? 'تحديث بموقعي الحالي' : 'استخدم موقعي الحالي'}</Button>
            <p className="sm:col-span-3 text-xs text-muted">
              {hasPoint
                ? <>الموقع المحدد: <a className="underline ltr" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${form.geo_lat},${form.geo_lng}`}>{form.geo_lat}, {form.geo_lng}</a> — افتح الصفحة دي وأنت في المدرج واضغط "استخدم موقعي الحالي" لأدق نتيجة. يُنصح بـ 300 متر على الأقل لأن الـ GPS جوه المباني أقل دقة.</>
                : 'اضغط "استخدم موقعي الحالي" وأنت موجود في المدرج.'}
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button loading={saving} disabled={!dirty} onClick={save}>حفظ</Button>
          <p className="text-xs text-muted flex items-center gap-1"><Smartphone className="size-3.5" /> وبشكل تلقائي: كل طالب مربوط بموبايل واحد، ومينفعش موبايل واحد يسجل لطالبين.</p>
        </div>
      </div>
    </Card>
  );
}

function SessionRoster({ sessionId, onChanged, readOnly }) {
  const { data, loading, reload } = useApi(`/attendance/${sessionId}`);
  if (loading && !data) return <div className="py-6 grid place-items-center"><Spinner /></div>;
  const toggle = async (s) => {
    try {
      await api.put(`/attendance/${sessionId}/records/${s.id}`, { present: !s.recorded_at });
      reload(true);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Table className="max-h-96">
      <tbody>
        {data.students.map((s) => (
          <tr key={s.id}>
            <Td><span className="font-semibold">{s.name}</span> <span className="text-xs text-muted ltr">{s.username}</span></Td>
            <Td className="text-muted text-xs">{s.section}</Td>
            <Td>{s.recorded_at ? <Badge tone="green">حاضر · {s.method === 'qr' ? 'QR' : s.method === 'code' ? 'كود' : 'يدوي'}{s.distance_m != null ? ` · ${Math.round(s.distance_m)} م` : ''}</Badge> : <Badge tone="red">غائب</Badge>}</Td>
            <Td className="text-left">{!readOnly && <Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.recorded_at ? 'تسجيل غياب' : 'تسجيل حضور'}</Button>}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function StaffAttendance({ course, data, reload }) {
  const readOnly = course.my_role === 'observer';
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: `محاضرة ${data.sessions.length + 1}`, duration_minutes: 15, rotate_seconds: 15 });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const start = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { id } = await api.post(`/courses/${course.id}/attendance`, { ...form, duration_minutes: Number(form.duration_minutes), rotate_seconds: Number(form.rotate_seconds) });
      navigate(`/attendance/${id}/live`);
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  };

  const active = data.sessions.filter((s) => s.active);
  const avg = data.sessions.length && data.students_count
    ? Math.round((data.sessions.reduce((s, x) => s + x.present_count, 0) / (data.sessions.length * data.students_count)) * 1000) / 10 : null;

  return (
    <>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <Card className={cx('p-5 sm:col-span-1 bg-gradient-to-br from-brand-600 to-brand-800 text-white border-0 flex flex-col justify-between gap-4', readOnly && 'hidden')}>
          <div>
            <QrCode className="size-8 text-amber-300 mb-2" />
            <p className="font-bold text-lg">افتح تسجيل حضور</p>
            <p className="text-sm text-brand-100">اعرض الـ QR على البروجيكتور والطلاب يعملوا Scan. الكود بيتغير كل بضع ثواني عشان محدش يبعته لزميله.</p>
          </div>
          <Button variant="secondary" icon={Play} className="bg-white text-brand-700 border-0" onClick={() => setOpen(true)}>بدء التسجيل</Button>
        </Card>
        <StatCard icon={CalendarCheck} label="عدد المحاضرات" value={data.sessions.length} />
        <StatCard icon={CheckCircle2} label="متوسط الحضور" value={avg === null ? '—' : `${avg}%`} tone={pctTone(avg)} />
      </div>

      {!readOnly && <GeoSettings course={course} />}

      {active.map((s) => (
        <Card key={s.id} className="p-4 mb-4 flex flex-wrap items-center gap-3 border-emerald-300 dark:border-emerald-500/40">
          <Radio className="size-5 text-emerald-600 animate-pulse" />
          <p className="font-bold flex-1">{s.title} · مفتوح الآن · {s.present_count} حاضر</p>
          <Button variant="success" icon={QrCode} to={`/attendance/${s.id}/live`}>عرض الـ QR</Button>
        </Card>
      ))}

      <Card className="overflow-hidden">
        <CardHeader icon={CalendarCheck} title="سجل المحاضرات" subtitle="اضغط على المحاضرة لعرض الحضور وتعديله يدوياً" />
        {!data.sessions.length ? <EmptyState title="لم تُسجَّل أي محاضرة بعد" /> : data.sessions.map((s) => (
          <div key={s.id} className="border-t border-line">
            <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2 text-right">
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{s.title} {s.active && <Badge tone="green" dot>مفتوح</Badge>}</p>
                <p className="text-xs text-muted">{fmtDateTime(s.started_at)} · {s.created_by_name}</p>
              </div>
              <div className="w-40 hidden sm:block">
                <Progress value={s.present_count} max={data.students_count} tone={pctTone((s.present_count / (data.students_count || 1)) * 100)} />
              </div>
              <span className="text-sm font-bold ltr w-16 text-left">{s.present_count}/{data.students_count}</span>
              {expanded === s.id ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
            </button>
            {expanded === s.id && <div className="bg-surface-2/50 border-t border-line"><SessionRoster sessionId={s.id} readOnly={readOnly} onChanged={() => reload(true)} /></div>}
          </div>
        ))}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="بدء تسجيل الحضور" subtitle="هيوصل إشعار لكل طلاب المادة"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button form="att-form" type="submit" icon={Play} loading={saving}>بدء وعرض الـ QR</Button></>}>
        <form id="att-form" onSubmit={start} className="grid grid-cols-2 gap-4">
          <Field label="عنوان المحاضرة" className="col-span-2">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />}</Field>
          <Field label="مدة التسجيل">
            {(id) => (
              <Select id={id} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}>
                {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} دقيقة</option>)}
              </Select>
            )}
          </Field>
          <Field label="تغيير الكود كل">
            {(id) => (
              <Select id={id} value={form.rotate_seconds} onChange={(e) => setForm({ ...form, rotate_seconds: e.target.value })}>
                {[10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} ثانية</option>)}
              </Select>
            )}
          </Field>
        </form>
      </Modal>
    </>
  );
}

function StudentAttendance({ data }) {
  const { summary, sessions } = data;
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={CalendarCheck} label="نسبة حضورك" value={summary.rate === null ? '—' : `${summary.rate}%`} tone={pctTone(summary.rate)} hint={summary.rate !== null && summary.rate < 75 ? '⚠️ أقل من الحد المطلوب 75%' : undefined} />
        <StatCard icon={CheckCircle2} label="حضرت" value={summary.attended} tone="green" />
        <StatCard icon={XCircle} label="غبت" value={summary.total - summary.attended} tone="red" />
      </div>
      {sessions.some((s) => s.active && !s.present) && (
        <Card className="p-4 mb-4 flex flex-wrap items-center gap-3 border-emerald-300">
          <Radio className="size-5 text-emerald-600 animate-pulse" />
          <p className="font-bold flex-1">تسجيل الحضور مفتوح الآن!</p>
          <Button variant="success" icon={QrCode} to="/scan">سجّل حضورك</Button>
        </Card>
      )}
      <Card className="overflow-hidden">
        {!sessions.length ? <EmptyState title="لم تُسجَّل محاضرات بعد" /> : (
          <Table>
            <thead><tr><Th>المحاضرة</Th><Th>التاريخ</Th><Th>الحالة</Th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <Td className="font-semibold">{s.title}</Td>
                  <Td className="text-muted">{fmtDateTime(s.started_at)}</Td>
                  <Td>{s.present ? <Badge tone="green"><CheckCircle2 className="size-3" /> حاضر · {timeAgo(s.my_recorded_at)}</Badge>
                    : s.active ? <Badge tone="amber">مفتوح الآن</Badge> : <Badge tone="red"><XCircle className="size-3" /> غائب</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export default function Attendance({ course }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/attendance`);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return course.my_role === 'student' ? <StudentAttendance data={data} /> : <StaffAttendance course={course} data={data} reload={reload} />;
}

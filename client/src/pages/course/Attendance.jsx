import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QrCode, Play, CalendarCheck, CheckCircle2, XCircle, Radio, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { fmtDateTime, pctTone, timeAgo } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Progress, Select, StatCard, Table, Td, Th, Spinner } from '../../components/ui';

function SessionRoster({ sessionId, onChanged }) {
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
            <Td>{s.recorded_at ? <Badge tone="green">حاضر · {s.method === 'qr' ? 'QR' : s.method === 'code' ? 'كود' : 'يدوي'}</Badge> : <Badge tone="red">غائب</Badge>}</Td>
            <Td className="text-left"><Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.recorded_at ? 'تسجيل غياب' : 'تسجيل حضور'}</Button></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function StaffAttendance({ course, data, reload }) {
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
        <Card className="p-5 sm:col-span-1 bg-gradient-to-br from-brand-600 to-brand-800 text-white border-0 flex flex-col justify-between gap-4">
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
            {expanded === s.id && <div className="bg-surface-2/50 border-t border-line"><SessionRoster sessionId={s.id} onChanged={() => reload(true)} /></div>}
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

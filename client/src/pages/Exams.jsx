import { useMemo, useState } from 'react';
import { ClipboardList, Clock, MapPin, Hash, Plus, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { clock12 } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, cx } from '../components/ui';
import { EXAM_KINDS, EXAM_TONES, ExamForm, daysUntil, examDay, untilLabel } from './exams/shared';

function StudentExams({ data }) {
  const upcoming = data.exams.filter((x) => daysUntil(x.exam_date) >= 0);
  const past = data.exams.filter((x) => daysUntil(x.exam_date) < 0);
  return (
    <>
      {data.seats.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {data.seats.map((s) => (
            <Card key={s.period} className="p-5 bg-gradient-to-br from-brand-600 to-brand-800 text-white border-0">
              <p className="text-brand-100 text-sm">رقم الجلوس · {s.period === 'midterm' ? 'امتحانات الميدترم' : 'امتحانات نهاية الترم'}</p>
              <p className="text-5xl font-extrabold ltr text-right mt-1 tracking-wider">{s.seat_number}</p>
              {s.hall && <p className="mt-2 flex items-center gap-1.5"><MapPin className="size-4" /> {s.hall}</p>}
            </Card>
          ))}
        </div>
      )}
      {!data.exams.length ? (
        <Card><EmptyState icon={ClipboardList} title="لم ينزل جدول امتحانات بعد" description="هيوصلك إشعار أول ما الجدول ينزل" /></Card>
      ) : (
        <div className="space-y-3">
          {upcoming.map((x) => {
            const soon = daysUntil(x.exam_date) <= 1;
            return (
              <Card key={x.id} className={cx('p-4 sm:p-5 flex flex-wrap items-center gap-4', soon && 'ring-2 ring-rose-400')}>
                <div className="w-20 text-center shrink-0">
                  <p className="text-3xl font-extrabold">{new Date(`${x.exam_date}T12:00:00`).getDate()}</p>
                  <p className="text-xs text-muted">{examDay(x.exam_date).split('،')[0]}</p>
                </div>
                <div className="flex-1 min-w-48">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={EXAM_TONES[x.kind]}>{EXAM_KINDS[x.kind]}</Badge>
                    <Badge tone={soon ? 'red' : 'slate'}>{untilLabel(x.exam_date)}</Badge>
                  </div>
                  <p className="font-extrabold text-lg mt-1">{x.course_name} <span className="text-sm text-muted font-normal ltr">{x.course_code}</span></p>
                  <p className="text-sm text-muted">{examDay(x.exam_date)}</p>
                  {x.notes && <p className="text-xs text-muted mt-1">📌 {x.notes}</p>}
                </div>
                <div className="grid grid-cols-3 sm:flex gap-2 sm:gap-4 w-full sm:w-auto text-sm">
                  <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-xs text-muted flex items-center gap-1"><Clock className="size-3" />الوقت</p><p className="font-bold">{clock12(x.start_time)}</p><p className="text-xs text-muted">إلى {clock12(x.end_time)}</p></div>
                  <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-xs text-muted flex items-center gap-1"><MapPin className="size-3" />المكان</p><p className="font-bold">{x.hall || x.location || '—'}</p></div>
                  <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-xs text-muted flex items-center gap-1"><Hash className="size-3" />رقم الجلوس</p><p className="font-bold ltr text-right">{x.seat_number || '—'}</p></div>
                </div>
              </Card>
            );
          })}
          {past.length > 0 && <p className="text-sm text-muted pt-4">امتحانات خلصت: {past.map((x) => `${x.course_name} (${EXAM_KINDS[x.kind]})`).join('، ')}</p>}
        </div>
      )}
    </>
  );
}

function StaffExams({ data, reload }) {
  const { data: courses } = useApi('/courses');
  const [editing, setEditing] = useState(null);
  const mine = useMemo(() => (courses || []).filter((c) => c.my_role === 'doctor'), [courses]);
  const publish = async (ids) => {
    try {
      const r = await api.post('/exams/publish', { ids });
      toast.success(`تم النشر وإبلاغ ${r.students} طالب`);
      reload(true);
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <>
      {mine.length > 0 && <div className="flex justify-end mb-4"><Button icon={Plus} onClick={() => setEditing({})}>إضافة امتحان</Button></div>}
      {!data.exams.length ? <Card><EmptyState icon={ClipboardList} title="لا توجد امتحانات مسجلة لموادك" /></Card> : (
        <div className="space-y-3">
          {data.exams.map((x) => (
            <Card key={x.id} className="p-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-48">
                <div className="flex items-center gap-2"><Badge tone={EXAM_TONES[x.kind]}>{EXAM_KINDS[x.kind]}</Badge>{x.published ? <Badge tone="green" dot>منشور</Badge> : <Badge tone="amber" dot>مسودة</Badge>}</div>
                <p className="font-bold mt-1">{x.course_name}</p>
                <p className="text-sm text-muted">{examDay(x.exam_date)} · {clock12(x.start_time)} – {clock12(x.end_time)} {x.location && `· ${x.location}`} · {x.students} طالب</p>
              </div>
              {mine.some((c) => c.id === x.course_id) && (
                <div className="flex gap-2">
                  {!x.published && <Button size="sm" icon={Send} onClick={() => publish([x.id])}>نشر</Button>}
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(x)}>تعديل</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && <ExamForm initial={editing.id ? editing : null} courses={mine} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(true); }} />}
    </>
  );
}

export default function Exams() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi('/exams/me');
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title={user.role === 'student' ? 'امتحاناتي' : 'امتحانات موادي'} subtitle="المواعيد والأماكن وأرقام الجلوس — وهيوصلك تذكير قبل كل امتحان بيوم" />
      {user.role === 'student' ? <StudentExams data={data} /> : <StaffExams data={data} reload={reload} />}
    </>
  );
}

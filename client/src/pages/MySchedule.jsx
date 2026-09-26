import { Link } from 'react-router-dom';
import { CalendarDays, Clock, MapPin } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { DAY_LABELS, KIND_LABELS, KIND_TONES, WEEK_ORDER, clock12, titled } from '../lib/format';
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageLoader, cx } from '../components/ui';
import { courseGradient } from './Courses';

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function SlotRow({ s, now, today }) {
  const live = today && now >= toMin(s.start_time) && now < toMin(s.end_time);
  const done = today && now >= toMin(s.end_time);
  return (
    <Link to={`/courses/${s.course_id}`} className={cx('flex gap-3 rounded-xl p-3 hover:bg-surface-2 transition', done && 'opacity-50')}>
      <div className={`w-1.5 rounded-full bg-gradient-to-b ${courseGradient(s.course_code)}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={KIND_TONES[s.kind]}>{KIND_LABELS[s.kind]}</Badge>
          {s.section && <span className="text-xs text-muted">{s.section}</span>}
          {live && <Badge tone="green" dot>الآن</Badge>}
        </div>
        <p className="font-bold mt-1 truncate">{s.course_name}</p>
        <p className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-3">
          <span className="flex items-center gap-1"><Clock className="size-3" />{clock12(s.start_time)} – {clock12(s.end_time)}</span>
          {s.location && <span className="flex items-center gap-1"><MapPin className="size-3" />{s.location}</span>}
          {s.staff_name && <span>{titled({ name: s.staff_name, role: s.staff_role })}</span>}
        </p>
      </div>
    </Link>
  );
}

export default function MySchedule() {
  const { data, error, loading, reload } = useApi('/schedule/me');
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const days = WEEK_ORDER.map((d) => ({ d, slots: data.slots.filter((s) => s.day_of_week === d) }));
  return (
    <>
      <PageHeader title="جدولي" subtitle="مواعيد المحاضرات والسكاشن الأسبوعية — بيوصلك تذكير قبل كل موعد" />
      {!data.slots.length ? <Card><EmptyState icon={CalendarDays} title="لا توجد مواعيد" description="لم يتم تحديد مواعيد لموادك بعد" /></Card> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {days.map(({ d, slots }) => (
            <Card key={d} className={cx('overflow-hidden', d === data.today && 'ring-2 ring-brand-500')}>
              <div className={cx('px-4 py-3 border-b border-line flex items-center justify-between', d === data.today ? 'bg-brand-600 text-white' : 'bg-surface-2')}>
                <p className="font-extrabold">{DAY_LABELS[d]}</p>
                {d === data.today && <span className="text-xs font-bold bg-white/20 rounded-lg px-2 py-0.5">النهارده</span>}
              </div>
              <div className="p-2 space-y-1">
                {slots.length ? slots.map((s) => <SlotRow key={s.id} s={s} now={data.now_minutes} today={d === data.today} />)
                  : <p className="text-sm text-muted text-center py-6">لا يوجد</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

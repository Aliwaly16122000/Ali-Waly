import { Link } from 'react-router-dom';
import { Award, CalendarCheck, TrendingUp } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { TYPE_LABELS, num, pctTone } from '../../lib/format';
import LockNotice from '../../components/LockNotice';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageLoader, Progress, StatCard, Table, Td, Th } from '../../components/ui';

export default function StudentGrades({ course }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/my-grades`);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (data.locked) return <LockNotice lock={data.locked} />;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Award} label="مجموعك حتى الآن" value={data.max ? `${num(data.total)} / ${num(data.max)}` : '—'} hint="من الدرجات المعتمدة فقط" />
        <StatCard icon={TrendingUp} label="النسبة والتقدير" value={data.percentage === null ? '—' : `${num(data.percentage, 1)}%`} hint={data.letter ?? ''} tone={pctTone(data.percentage)} />
        <StatCard icon={CalendarCheck} label="نسبة الحضور" value={data.attendance ? `${data.attendance.rate}%` : '—'}
          hint={data.attendance ? `${data.attendance.attended} من ${data.attendance.sessions} محاضرة` : 'لم تُسجَّل محاضرات'} tone={pctTone(data.attendance?.rate)} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader icon={Award} title="تفاصيل الدرجات" subtitle="الدرجات بتظهر هنا بعد ما الدكتور يعتمدها" />
        {!data.items.length ? <EmptyState title="لا توجد درجات معتمدة بعد" /> : (
          <Table>
            <thead><tr><Th>التقييم</Th><Th>درجتك</Th><Th className="w-48">النسبة</Th><Th>متوسط الدفعة</Th><Th>أعلى درجة</Th><Th>تعليق</Th></tr></thead>
            <tbody>
              {data.items.map((i) => {
                const pct = i.score === null ? null : (i.score / i.max_score) * 100;
                return (
                  <tr key={i.id} className="hover:bg-surface-2">
                    <Td><Link to={`/courses/${course.id}/assessments/${i.id}`} className="font-semibold hover:text-brand-600">{i.title}</Link><p className="text-xs text-muted">{TYPE_LABELS[i.type]}</p></Td>
                    <Td className="font-bold ltr text-right whitespace-nowrap">{i.score === null ? <Badge tone="red">غياب</Badge> : `${num(i.score)} / ${num(i.max_score)}`}</Td>
                    <Td><div className="flex items-center gap-2"><Progress value={pct ?? 0} tone={pctTone(pct ?? 0)} className="flex-1" /><span className="text-xs w-10 ltr">{pct === null ? '—' : `${Math.round(pct)}%`}</span></div></Td>
                    <Td className="ltr text-right text-muted">{num(i.class_avg, 1)}</Td>
                    <Td className="ltr text-right text-muted">{num(i.class_max)}</Td>
                    <Td className="text-muted text-xs max-w-56">{i.feedback || '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

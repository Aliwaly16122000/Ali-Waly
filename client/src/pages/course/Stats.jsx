import { BarChart3, Users, TrendingUp, Target, CalendarCheck, Trophy, AlertTriangle, Layers, ListChecks } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { STATUS_META, num, pctTone } from '../../lib/format';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageLoader, Progress, StatCard, Table, Td, Th, Avatar } from '../../components/ui';
import { BarsChart, TrendChart, SEQ } from '../../components/Charts';

export default function Stats({ course }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/stats`);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.students) return <Card><EmptyState icon={BarChart3} title="لا يوجد طلاب في المادة بعد" /></Card>;

  const o = data.overall;
  const meanPct = o.mean !== null && data.assessed_max ? (o.mean / data.assessed_max) * 100 : null;
  const graded = data.assessments.filter((a) => a.graded > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="عدد الطلاب" value={data.students} />
        <StatCard icon={TrendingUp} label="متوسط المجموع" value={o.mean === null ? '—' : `${num(meanPct, 1)}%`} hint={o.mean === null ? '' : `${num(o.mean, 1)} من ${num(data.assessed_max)} · وسيط ${num(o.median, 1)}`} tone={pctTone(meanPct)} />
        <StatCard icon={Target} label="نسبة النجاح (≥ 50%)" value={o.pass_rate === null ? '—' : `${num(o.pass_rate, 1)}%`} hint={o.std === null ? '' : `الانحراف المعياري ${num(o.std, 1)}`} tone={pctTone(o.pass_rate)} />
        <StatCard icon={CalendarCheck} label="متوسط الحضور" value={data.attendance.average_rate === null ? '—' : `${data.attendance.average_rate}%`} hint={`${data.attendance.sessions.length} محاضرة`} tone={pctTone(data.attendance.average_rate)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader icon={BarChart3} title="توزيع المجموع الكلي" subtitle="عدد الطلاب في كل شريحة نسبة مئوية" />
          <div className="px-3 pb-4">
            <BarsChart data={o.histogram} x="range" y="count" format={(v) => `${v} طالب`} labelFormat={(l) => `${l}%`} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={Layers} title="توزيع التقديرات" subtitle="حسب النسبة الحالية لكل طالب" />
          <div className="px-3 pb-4">
            <BarsChart data={data.letters} x="letter" y="count" format={(v) => `${v} طالب`} colorFor={(d) => SEQ[data.letters.indexOf(d)]} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader icon={ListChecks} title="متوسط كل تقييم" subtitle="كنسبة مئوية من الدرجة العظمى · الخط المتقطع = 50%" />
          <div className="px-3 pb-4">
            {graded.length ? (
              <BarsChart data={graded} x="title" y="mean_pct" yDomain={[0, 100]} refLine={50} format={(v, d) => `${v}% · ${num(d.mean, 1)} من ${num(d.max_score)}`} />
            ) : <EmptyState title="لا توجد درجات مرصودة بعد" />}
          </div>
        </Card>
        <Card>
          <CardHeader icon={CalendarCheck} title="نسبة الحضور لكل محاضرة" />
          <div className="px-3 pb-4">
            {data.attendance.sessions.length ? (
              <TrendChart data={data.attendance.sessions} x="title" y="rate" format={(v, d) => `${v}% · ${d.present} طالب`} />
            ) : <EmptyState title="لم تُسجَّل محاضرات بعد" />}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader icon={BarChart3} title="إحصائيات تفصيلية لكل تقييم" />
        <Table>
          <thead><tr><Th>التقييم</Th><Th>الحالة</Th><Th>التصحيح</Th><Th>المتوسط</Th><Th>الوسيط</Th><Th>أقل</Th><Th>أعلى</Th><Th>الانحراف</Th><Th>النجاح</Th></tr></thead>
          <tbody>
            {data.assessments.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2">
                <Td><p className="font-semibold">{a.title}</p><p className="text-xs text-muted">{a.type_label} · من {num(a.max_score)}</p></Td>
                <Td><Badge tone={STATUS_META[a.status].tone} dot>{STATUS_META[a.status].label}</Badge></Td>
                <Td className="min-w-32"><div className="flex items-center gap-2"><Progress value={a.graded} max={a.students} className="flex-1" /><span className="text-xs ltr">{a.graded}/{a.students}</span></div></Td>
                <Td className="ltr text-right font-semibold">{num(a.mean, 1)}</Td>
                <Td className="ltr text-right">{num(a.median, 1)}</Td>
                <Td className="ltr text-right">{num(a.min)}</Td>
                <Td className="ltr text-right">{num(a.max)}</Td>
                <Td className="ltr text-right">{num(a.std, 1)}</Td>
                <Td>{a.pass_rate === null ? '—' : <Badge tone={pctTone(a.pass_rate)}><span className="ltr">{num(a.pass_rate, 0)}%</span></Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {data.sections.length > 1 && (
          <Card>
            <CardHeader icon={Layers} title="مقارنة السكاشن" subtitle="متوسط النسبة المئوية" />
            <div className="px-3 pb-4"><BarsChart data={data.sections} x="section" y="mean_pct" yDomain={[0, 100]} height={220} format={(v, d) => `${v}% · ${d.students} طالب`} /></div>
          </Card>
        )}
        <Card>
          <CardHeader icon={Trophy} title="الأوائل" />
          <ul className="px-5 pb-5 space-y-3">
            {data.top.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3">
                <span className="w-5 text-center font-bold text-muted">{i + 1}</span>
                <Avatar name={s.name} size="sm" />
                <div className="flex-1 min-w-0"><p className="font-semibold truncate">{s.name}</p><p className="text-xs text-muted ltr text-right">{s.username}</p></div>
                <Badge tone="green"><span className="ltr">{num(s.percentage, 1)}%</span></Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={AlertTriangle} title="طلاب محتاجين متابعة" subtitle="نسبة أقل من 50% أو حضور أقل من 75%" />
          {!data.at_risk.length ? <EmptyState title="لا يوجد 👍" /> : (
            <ul className="px-5 pb-5 space-y-3">
              {data.at_risk.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <Avatar name={s.name} size="sm" />
                  <div className="flex-1 min-w-0"><p className="font-semibold truncate">{s.name}</p>
                    <p className="text-xs text-muted">حضور {s.attendance_rate ?? '—'}%</p></div>
                  <Badge tone={pctTone(s.percentage)}><span className="ltr">{num(s.percentage, 1)}%</span></Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

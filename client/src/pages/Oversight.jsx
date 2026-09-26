import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, Landmark, Library, Users, AlertTriangle, CheckCircle2, AlertOctagon, ChevronLeft, ChevronRight, GraduationCap, Clock } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { LEVEL_LABELS, num, pctTone, timeAgo, titled } from '../lib/format';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoader, Progress, StatCard, Table, Td, Th, cx } from '../components/ui';

const STATUS = {
  good: { label: 'تمام', tone: 'green', icon: CheckCircle2 },
  warning: { label: 'محتاج متابعة', tone: 'amber', icon: AlertTriangle },
  critical: { label: 'حرج', tone: 'red', icon: AlertOctagon },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.good;
  return <Badge tone={s.tone}><s.icon className="size-3" /> {s.label}</Badge>;
}

function Pct({ value }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return (
    <div className="flex items-center gap-2 min-w-28">
      <Progress value={value} tone={pctTone(value)} className="flex-1" />
      <span className="text-xs font-bold ltr w-10">{num(value, 0)}%</span>
    </div>
  );
}

function Summary({ d, unitLabel }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <StatCard icon={Users} label="الطلاب" value={d.students ?? '—'} />
      <StatCard icon={Library} label={unitLabel} value={d.courses ?? d.departments ?? '—'} tone="violet" />
      <StatCard icon={GraduationCap} label="متوسط الدرجات" value={d.avg === null ? '—' : `${num(d.avg, 0)}%`} hint={d.pass_rate === null ? '' : `نسبة النجاح ${num(d.pass_rate, 0)}%`} tone={pctTone(d.avg)} />
      <StatCard icon={CheckCircle2} label="متوسط الحضور" value={d.attendance === null ? '—' : `${num(d.attendance, 0)}%`} tone={pctTone(d.attendance)} />
      <StatCard icon={AlertTriangle} label="مواد محتاجة متابعة" value={(d.critical || 0) + (d.warning || 0)} hint={d.critical ? `${d.critical} حرجة` : 'لا يوجد حرج'} tone={d.critical ? 'red' : d.warning ? 'amber' : 'green'} />
    </div>
  );
}

function Back({ to, label }) {
  return <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4"><ChevronRight className="size-4" /> {label}</Link>;
}

function UniversityView() {
  const { data, error, loading, reload } = useApi('/oversight/university');
  const navigate = useNavigate();
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const all = { students: data.students, departments: data.faculties.length, ...data.faculties.reduce((acc, f) => ({ critical: acc.critical + f.critical, warning: acc.warning + f.warning }), { critical: 0, warning: 0 }) };
  const w = (k) => { const xs = data.faculties.filter((f) => f[k] !== null && f.students); const n = xs.reduce((s, f) => s + f.students, 0); return n ? xs.reduce((s, f) => s + f[k] * f.students, 0) / n : null; };
  return (
    <>
      <PageHeader title="متابعة الجامعة" subtitle="أداء الكليات في الترم الحالي" />
      <Summary d={{ ...all, avg: w('avg'), attendance: w('attendance'), pass_rate: w('pass_rate') }} unitLabel="الكليات" />
      <Card className="overflow-hidden">
        <CardHeader icon={Landmark} title="الكليات" subtitle="اضغط على الكلية لعرض أقسامها" />
        <Table>
          <thead><tr><Th>الكلية</Th><Th>الحالة</Th><Th>الطلاب</Th><Th>الأقسام</Th><Th>المواد</Th><Th>متوسط الدرجات</Th><Th>الحضور</Th><Th>تصحيح متأخر</Th><Th /></tr></thead>
          <tbody>
            {data.faculties.map((f) => (
              <tr key={f.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => navigate(`/oversight/faculty/${f.id}`)}>
                <Td className="font-bold">{f.name}</Td>
                <Td><StatusBadge status={f.status} /></Td>
                <Td>{f.students}</Td><Td>{f.departments}</Td><Td>{f.courses}</Td>
                <Td><Pct value={f.avg} /></Td><Td><Pct value={f.attendance} /></Td>
                <Td className={cx(f.overdue && 'text-amber-600 font-bold')}>{f.overdue}</Td>
                <Td><ChevronLeft className="size-4 text-muted" /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function FacultyView({ id, canGoUp }) {
  const { data, error, loading, reload } = useApi(`/oversight/faculty/${id}`);
  const navigate = useNavigate();
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      {canGoUp && <Back to="/oversight" label="الجامعة" />}
      <PageHeader title={data.name} subtitle="أداء الأقسام في الترم الحالي" />
      <Summary d={data} unitLabel="المواد" />
      <Card className="overflow-hidden">
        <CardHeader icon={Building2} title="الأقسام" subtitle="اضغط على القسم لعرض مواده" />
        <Table>
          <thead><tr><Th>القسم</Th><Th>الحالة</Th><Th>الطلاب</Th><Th>هيئة التدريس</Th><Th>المواد</Th><Th>متوسط الدرجات</Th><Th>النجاح</Th><Th>الحضور</Th><Th>طلاب محتاجين متابعة</Th><Th /></tr></thead>
          <tbody>
            {data.departments.map((d) => (
              <tr key={d.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => navigate(`/oversight/department/${d.id}`)}>
                <Td className="font-bold">{d.name}</Td>
                <Td>{d.courses ? <StatusBadge status={d.status} /> : <Badge>لا توجد مواد</Badge>}</Td>
                <Td>{d.students}</Td><Td>{d.staff}</Td><Td>{d.courses}</Td>
                <Td><Pct value={d.avg} /></Td><Td><Pct value={d.pass_rate} /></Td><Td><Pct value={d.attendance} /></Td>
                <Td className={cx(d.at_risk && 'text-rose-600 font-bold')}>{d.at_risk}</Td>
                <Td><ChevronLeft className="size-4 text-muted" /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function DepartmentView({ id, upLink }) {
  const { data, error, loading, reload } = useApi(`/oversight/department/${id}`);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      {upLink && <Back to={upLink} label={data.faculty_name || 'الكلية'} />}
      <PageHeader title={data.name} subtitle={`${data.faculty_name ?? ''} · متابعة المواد في الترم الحالي`} />
      <Summary d={data} unitLabel="المواد" />
      {!data.courses.length ? <Card><EmptyState icon={Library} title="لا توجد مواد في الترم الحالي" /></Card> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {data.courses.map((c) => {
            const h = c.health;
            return (
              <Card key={c.id} className={cx('p-5', h.status === 'critical' && 'border-rose-300 dark:border-rose-500/40', h.status === 'warning' && 'border-amber-200 dark:border-amber-500/30')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/courses/${c.id}?tab=stats`} className="font-extrabold hover:text-brand-600">{c.name}</Link>
                    <p className="text-xs text-muted"><span className="ltr">{c.code}</span> · {LEVEL_LABELS[c.level] ?? ''} · {h.students} طالب</p>
                  </div>
                  <StatusBadge status={h.status} />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
                  <div><p className="text-xs text-muted mb-1">متوسط الدرجات</p><Pct value={h.avg} /></div>
                  <div><p className="text-xs text-muted mb-1">الحضور</p><Pct value={h.attendance} /></div>
                  <div><p className="text-xs text-muted mb-1">النجاح</p><Pct value={h.pass_rate} /></div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3 text-xs">
                  <Badge>{h.published}/{h.assessments} تقييم منشور</Badge>
                  <Badge>{h.sessions} محاضرة بحضور</Badge>
                  {h.backlog > 0 && <Badge tone="amber">{h.backlog} بانتظار التصحيح</Badge>}
                  {h.at_risk > 0 && <Badge tone="red">{h.at_risk} طالب محتاج متابعة</Badge>}
                </div>
                {h.issues.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {h.issues.map((i) => <li key={i.text} className={cx('text-xs flex items-center gap-1.5', i.level === 'critical' ? 'text-rose-600' : 'text-amber-700 dark:text-amber-300')}><AlertTriangle className="size-3" />{i.text}</li>)}
                  </ul>
                )}
                <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {c.staff.map((s) => <span key={s.id} className="flex items-center gap-1">{titled(s)} <Clock className="size-3" /> {s.last_login_at ? timeAgo(s.last_login_at) : 'لم يدخل'}</span>)}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Routes: /oversight → the user's widest scope; /oversight/faculty/:id; /oversight/department/:id */
export default function Oversight() {
  const { level, id } = useParams();
  const { user } = useAuth();
  const scopes = user.role === 'admin' ? [{ scope: 'university', scope_id: 0 }] : user.oversight || [];
  const top = scopes[0];
  const hasUni = scopes.some((s) => s.scope === 'university');
  const facultyScopes = scopes.filter((s) => s.scope === 'faculty');

  if (!top) return <Card><EmptyState icon={Landmark} title="لا توجد صلاحيات متابعة" description="تواصل مع الإدارة" /></Card>;
  if (level === 'faculty') return <FacultyView id={id} canGoUp={hasUni} />;
  if (level === 'department') return <DepartmentView id={id} upLink={hasUni || facultyScopes.length ? '/oversight' : null} />;

  if (top.scope === 'university') return <UniversityView />;
  if (top.scope === 'faculty' && facultyScopes.length === 1 && !scopes.some((s) => s.scope === 'department')) return <FacultyView id={top.scope_id} />;
  if (scopes.length === 1) return <DepartmentView id={top.scope_id} />;
  return (
    <>
      <PageHeader title="لوحة المتابعة" />
      <div className="grid sm:grid-cols-2 gap-4">
        {scopes.map((s) => (
          <Link key={`${s.scope}-${s.scope_id}`} to={`/oversight/${s.scope}/${s.scope_id}`}>
            <Card className="p-5 hover:border-brand-300"><p className="text-sm text-muted">{s.title}</p><p className="text-lg font-extrabold">{s.name}</p></Card>
          </Link>
        ))}
      </div>
    </>
  );
}

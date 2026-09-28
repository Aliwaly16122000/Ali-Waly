import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Users, Search, FileText, ClipboardCheck, Inbox } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../lib/useApi';
import { LEVEL_LABELS, SEMESTER_LABELS, num, pctTone, titled } from '../lib/format';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, PageLoader, Progress, Select } from '../components/ui';

const GRADIENTS = [
  'from-brand-500 to-brand-700', 'from-violet-500 to-fuchsia-600', 'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600', 'from-sky-500 to-cyan-600', 'from-rose-500 to-pink-600',
];
export const courseGradient = (code = '') => GRADIENTS[[...code].reduce((s, c) => s + c.charCodeAt(0), 0) % GRADIENTS.length];

function CourseCard({ c, role }) {
  const doctors = c.staff.filter((s) => s.role === 'doctor');
  const tas = c.staff.filter((s) => s.role === 'ta');
  const pct = c.published_max ? (c.my_total / c.published_max) * 100 : null;
  return (
    <Link to={`/courses/${c.id}`} className="group">
      <Card className="overflow-hidden h-full flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all">
        <div className={`relative bg-gradient-to-br ${courseGradient(c.code)} p-5 text-white`}>
          <svg className="absolute inset-0 w-full h-full opacity-15" aria-hidden="true">
            <defs><pattern id={`p${c.id}`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="white" /></pattern></defs>
            <rect width="100%" height="100%" fill={`url(#p${c.id})`} />
          </svg>
          <div className="relative flex items-start justify-between gap-2">
            <span className="text-xs font-bold bg-white/20 rounded-lg px-2 py-1 ltr">{c.code}</span>
            {c.archived && <span className="text-xs font-bold bg-black/25 rounded-lg px-2 py-1">أرشيف · {SEMESTER_LABELS[c.semester]} {c.academic_year}</span>}
            {c.my_role && c.my_role !== 'student' && c.my_role !== 'admin' && (
              <span className="text-xs font-bold bg-white/20 rounded-lg px-2 py-1">{c.my_role === 'doctor' ? 'دكتور المادة' : 'معيد'}</span>
            )}
          </div>
          <h3 className="relative text-lg font-extrabold mt-4 leading-snug">{c.name}</h3>
          <p className="relative text-sm text-white/80 mt-1">{c.department_name} · {LEVEL_LABELS[c.level] ?? ''}</p>
        </div>
        <div className="p-5 flex-1 flex flex-col gap-3">
          <div className="text-sm text-muted space-y-1">
            {doctors.length > 0 && <p className="truncate">👨‍🏫 {doctors.map((d) => titled({ ...d, role: 'doctor' })).join('، ')}</p>}
            {tas.length > 0 && <p className="truncate">🧑‍💻 {tas.map((d) => titled({ ...d, role: 'ta' })).join('، ')}</p>}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            {role === 'student' ? (
              <>
                {c.pending_count > 0 ? <Badge tone="amber"><FileText className="size-3" /> {c.pending_count} مطلوب تسليمه</Badge> : <Badge tone="green">لا يوجد مطلوب</Badge>}
                {c.grades_lock && <Badge tone="amber">{c.grades_lock.reason === 'survey' ? '🔒 املأ الاستبيان لفتح الدرجات' : '🙈 الدرجات مخفية مؤقتاً'}</Badge>}
                {pct !== null && (
                  <div className="w-full mt-1">
                    <div className="flex justify-between text-xs mb-1"><span className="text-muted">مجموعك حتى الآن</span><span className="font-bold ltr">{num(c.my_total ?? 0)} / {num(c.published_max)}</span></div>
                    <Progress value={pct} tone={pctTone(pct)} />
                  </div>
                )}
              </>
            ) : (
              <>
                <Badge tone="slate"><Users className="size-3" /> {c.students_count} طالب</Badge>
                {c.to_grade_count > 0 && <Badge tone="amber"><Inbox className="size-3" /> {c.to_grade_count} للتصحيح</Badge>}
                {c.awaiting_approval_count > 0 && <Badge tone="red"><ClipboardCheck className="size-3" /> {c.awaiting_approval_count} للاعتماد</Badge>}
              </>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function Courses() {
  const { user } = useAuth();
  const [term, setTerm] = useState('current');
  const { data, error, loading, reload } = useApi(`/courses?term=${encodeURIComponent(term)}`);
  const { data: terms } = useApi('/courses/terms');
  const [q, setQ] = useState('');
  const filtered = useMemo(() => (data || []).filter((c) => !q || c.name.includes(q) || c.code.toLowerCase().includes(q.toLowerCase())), [data, q]);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const cur = terms?.current;
  const termLabel = (t) => `${SEMESTER_LABELS[t.semester]} ${t.academic_year}`;

  return (
    <>
      <PageHeader
        title={user.role === 'admin' ? 'كل المواد' : 'موادي'}
        subtitle={term === 'current' && cur ? termLabel(cur) : term === 'all' ? 'كل الترمات' : 'أرشيف'}
        actions={<>
          {terms?.terms?.length > 1 && (
            <Select className="w-52" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="الترم">
              <option value="current">الترم الحالي{cur ? ` (${termLabel(cur)})` : ''}</option>
              {terms.terms.filter((t) => !cur || t.academic_year !== cur.academic_year || t.semester !== cur.semester).map((t) => (
                <option key={`${t.academic_year}-${t.semester}`} value={`${t.academic_year}-${t.semester}`}>أرشيف: {termLabel(t)}</option>
              ))}
              <option value="all">كل الترمات</option>
            </Select>
          )}
          {data.length > 6 && (
            <div className="relative w-64">
              <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input className="pr-9" placeholder="ابحث باسم أو كود المادة" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
        </>}
      />
      {!data.length ? (
        <Card><EmptyState icon={BookOpen} title="لا توجد مواد" description={user.role === 'student' ? 'لم يتم تسجيلك في أي مادة بعد. تواصل مع شؤون الطلاب.' : 'لم يتم إسناد أي مادة لك بعد.'} /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((c) => <CourseCard key={c.id} c={c} role={user.role} />)}
        </div>
      )}
    </>
  );
}

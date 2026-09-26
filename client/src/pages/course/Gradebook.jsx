import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Search, ArrowUpDown, Scale } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { STATUS_META, num, pctTone } from '../../lib/format';
import { Badge, Button, Card, ErrorState, Input, PageLoader, Select, Table, Td, Th, EmptyState, cx } from '../../components/ui';
import GradingScheme from './GradingScheme';
import ExportModal from './ExportModal';

export default function Gradebook({ course }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/gradebook`);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.rows.filter((r) => (!section || r.section === section) && (!q || r.name.includes(q) || r.username.includes(q)));
    const val = (r) => {
      if (sort.key === 'name') return r.name;
      if (sort.key === 'attendance') return r.attendance?.rate ?? -1;
      if (sort.key === 'final') return r.final?.total ?? -1;
      return r[sort.key] ?? -1;
    };
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [data, q, section, sort]);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const sections = [...new Set(data.rows.map((r) => r.section).filter(Boolean))];
  const scheme = data.scheme;
  const parts = scheme ? [
    ...scheme.components.map((c) => ({ key: c.key, name: c.name, weight: c.weight })),
    ...(scheme.attendance?.enabled ? [{ key: 'attendance', name: 'الحضور', weight: scheme.attendance.weight }] : []),
  ] : [];
  const SortTh = ({ k, children, className }) => (
    <Th className={cx('cursor-pointer select-none hover:text-ink', className)} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : k === 'name' ? 1 : -1 }))}>
      <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className="size-3 opacity-50" /></span>
    </Th>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pr-9" placeholder="ابحث بالاسم أو الكود" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {sections.length > 1 && (
          <Select className="w-36" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">كل السكاشن</option>{sections.map((s) => <option key={s}>{s}</option>)}
          </Select>
        )}
        <Button variant="secondary" icon={Scale} onClick={() => setSchemeOpen(true)}>توزيع الدرجات</Button>
        <Button icon={Download} onClick={() => setExportOpen(true)}>تصدير Excel</Button>
      </div>
      {scheme ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-brand-50/60 dark:bg-brand-500/5 border-b border-line text-xs">
          <span className="font-bold text-brand-700 dark:text-brand-300">توزيع الدرجات ({num(data.final_max)}):</span>
          {scheme.components.map((c) => <Badge key={c.key} tone="blue">{c.name} {num(c.weight)}{c.best_of ? ` · أفضل ${c.best_of}` : ''}</Badge>)}
          {scheme.attendance?.enabled && <Badge tone="green">الحضور {num(scheme.attendance.weight)}</Badge>}
          <span className="text-muted">· النسبة "حتى الآن" محسوبة من البنود اللي اتصححت</span>
        </div>
      ) : (
        <p className="text-xs text-muted px-4 py-2 bg-surface-2 border-b border-line">
          المجموع بيتحسب تلقائياً من كل الدرجات المرصودة. النسبة محسوبة من التقييمات اللي اتصححت ({num(data.assessed_max)} من {num(data.total_max)} درجة).
          <button className="underline font-semibold mr-1 text-brand-600" onClick={() => setSchemeOpen(true)}>حدد توزيع الدرجات</button>
        </p>
      )}
      {!data.rows.length ? <EmptyState title="لا يوجد طلاب مسجلين" /> : (
        <Table className="max-h-[70vh]">
          <thead className="sticky top-0 z-10">
            <tr>
              <SortTh k="name" className="sticky right-0 z-10 min-w-48">الطالب</SortTh>
              {data.assessments.map((a) => (
                <Th key={a.id} className="text-center">
                  <Link to={`/courses/${course.id}/assessments/${a.id}`} className="hover:text-brand-600">{a.title}</Link>
                  <div className="flex items-center justify-center gap-1 mt-0.5 font-normal">
                    <span className="ltr">/{num(a.max_score)}</span>
                    <span className={cx('size-1.5 rounded-full', { open: 'bg-brand-500', submitted: 'bg-amber-500', published: 'bg-emerald-500' }[a.status])} title={STATUS_META[a.status].label} />
                  </div>
                </Th>
              ))}
              <SortTh k="total" className="text-center">المجموع الخام /{num(data.total_max)}</SortTh>
              {parts.map((p) => <Th key={p.key} className="text-center bg-brand-50 dark:bg-brand-500/10">{p.name}<div className="font-normal ltr">/{num(p.weight)}</div></Th>)}
              {scheme && <SortTh k="final" className="text-center bg-amber-50 dark:bg-amber-500/10">النهائي /{num(data.final_max)}</SortTh>}
              <SortTh k="percentage" className="text-center">النسبة</SortTh>
              <SortTh k="attendance" className="text-center">الحضور</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2 group">
                <Td className="sticky right-0 bg-surface group-hover:bg-surface-2">
                  <p className="font-semibold whitespace-nowrap">{r.name}</p>
                  <p className="text-xs text-muted"><span className="ltr">{r.username}</span>{r.section && ` · ${r.section}`}</p>
                </Td>
                {data.assessments.map((a) => {
                  const g = r.grades[a.id];
                  return (
                    <Td key={a.id} className="text-center ltr">
                      {g.score === null ? <span className="text-muted">{g.submitted ? '⏳' : '—'}</span> : <span className="font-semibold">{num(g.score)}</span>}
                    </Td>
                  );
                })}
                <Td className={cx('text-center ltr', scheme ? 'text-muted' : 'font-extrabold')}>{num(r.total)}</Td>
                {parts.map((p) => <Td key={p.key} className="text-center ltr bg-brand-50/40 dark:bg-brand-500/5">{num(r.final?.parts[p.key], 2)}</Td>)}
                {scheme && <Td className="text-center font-extrabold ltr bg-amber-50/60 dark:bg-amber-500/5">{num(r.final?.total)}</Td>}
                {(() => {
                  const p = scheme ? r.final?.percentage : r.percentage;
                  return <Td className="text-center">{p === null || p === undefined ? '—' : <Badge tone={pctTone(p)}><span className="ltr">{num(p, 1)}%</span></Badge>}</Td>;
                })()}
                <Td className="text-center">{r.attendance ? <span className={cx('font-semibold ltr', r.attendance.rate < 75 && 'text-rose-600')}>{r.attendance.rate}%</span> : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-muted border-t border-line">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" />مفتوح للتصحيح</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" />بانتظار الاعتماد</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />منشور</span>
        <span>⏳ سلّم ولم يُصحَّح</span>
      </div>
      {schemeOpen && <GradingScheme open onClose={() => setSchemeOpen(false)} courseId={course.id} assessments={data.assessments} scheme={scheme} onSaved={() => reload(true)} />}
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} courseId={course.id} hasScheme={!!scheme} onConfigure={() => setSchemeOpen(true)} />
    </Card>
  );
}

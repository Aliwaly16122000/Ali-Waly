import { useMemo, useState } from 'react';
import { MessageCircle, Search, Users } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { Avatar, Button, Card, EmptyState, ErrorState, Input, PageLoader, Select, Table, Td, Th, cx } from '../../components/ui';

export default function Students({ course, onMessage }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/students`);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [sortBy, setSortBy] = useState('code');

  const sections = useMemo(() => {
    const counts = new Map();
    for (const s of data || []) counts.set(s.section || 'بدون سكشن', (counts.get(s.section || 'بدون سكشن') || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar', { numeric: true }));
  }, [data]);

  const list = useMemo(() => (data || [])
    .filter((s) => (!q || s.name.includes(q) || s.username.includes(q)) && (!section || (s.section || 'بدون سكشن') === section))
    .sort((x, y) => (sortBy === 'name'
      ? x.name.localeCompare(y.name, 'ar')
      : sortBy === 'section'
        ? (x.section || '').localeCompare(y.section || '', 'ar', { numeric: true }) || x.username.localeCompare(y.username, 'en', { numeric: true })
        : x.username.localeCompare(y.username, 'en', { numeric: true }))), [data, q, section, sortBy]);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pr-9" placeholder={`ابحث في ${data.length} طالب`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-44" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="الترتيب">
          <option value="code">ترتيب: الكود</option>
          <option value="name">ترتيب: الاسم (أبجدي)</option>
          <option value="section">ترتيب: السكشن</option>
        </Select>
      </div>
      {sections.length > 1 && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-line bg-surface-2">
          <button onClick={() => setSection('')} className={cx('rounded-full px-3 py-1 text-sm font-semibold border', !section ? 'bg-brand-600 text-white border-brand-600' : 'border-line text-muted')}>
            الكل <span className="opacity-80">({data.length})</span>
          </button>
          {sections.map(([name, count]) => (
            <button key={name} onClick={() => setSection(name)} className={cx('rounded-full px-3 py-1 text-sm font-semibold border', section === name ? 'bg-brand-600 text-white border-brand-600' : 'border-line text-muted')}>
              {name} <span className="opacity-80">({count})</span>
            </button>
          ))}
        </div>
      )}
      {!list.length ? <EmptyState icon={Users} title="لا يوجد طلاب" /> : (
        <Table>
          <thead><tr><Th className="w-10">#</Th><Th>الطالب</Th><Th>الكود</Th><Th>السكشن</Th><Th>البريد</Th><Th /></tr></thead>
          <tbody>
            {list.map((s, i) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <Td className="text-muted">{i + 1}</Td>
                <Td><div className="flex items-center gap-3"><Avatar name={s.name} size="sm" /><span className="font-semibold">{s.name}</span></div></Td>
                <Td className="ltr text-right text-muted">{s.username}</Td>
                <Td className="text-muted">{s.section || '—'}</Td>
                <Td className="ltr text-right text-muted text-xs">{s.email || '—'}</Td>
                <Td className="text-left">{!['admin', 'observer'].includes(course.my_role) && <Button size="sm" variant="soft" icon={MessageCircle} onClick={() => onMessage(s.id)}>مراسلة</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-xs text-muted px-4 py-3 border-t border-line">{list.length} طالب</p>
    </Card>
  );
}

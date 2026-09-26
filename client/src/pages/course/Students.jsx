import { useState } from 'react';
import { MessageCircle, Search, Users } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { Avatar, Button, Card, EmptyState, ErrorState, Input, PageLoader, Table, Td, Th } from '../../components/ui';

export default function Students({ course, onMessage }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/students`);
  const [q, setQ] = useState('');
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const list = data.filter((s) => !q || s.name.includes(q) || s.username.includes(q));
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 p-4 border-b border-line">
        <div className="relative flex-1">
          <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pr-9" placeholder={`ابحث في ${data.length} طالب`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {!list.length ? <EmptyState icon={Users} title="لا يوجد طلاب" /> : (
        <Table>
          <thead><tr><Th>الطالب</Th><Th>الكود</Th><Th>السكشن</Th><Th>البريد</Th><Th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <Td><div className="flex items-center gap-3"><Avatar name={s.name} size="sm" /><span className="font-semibold">{s.name}</span></div></Td>
                <Td className="ltr text-right text-muted">{s.username}</Td>
                <Td className="text-muted">{s.section || '—'}</Td>
                <Td className="ltr text-right text-muted text-xs">{s.email || '—'}</Td>
                <Td className="text-left">{course.my_role !== 'admin' && <Button size="sm" variant="soft" icon={MessageCircle} onClick={() => onMessage(s.id)}>مراسلة</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

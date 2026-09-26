import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useRealtime, useSocketEvent } from '../context/RealtimeContext';
import { fmtDateTime, timeAgo } from '../lib/format';
import { Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, cx } from '../components/ui';
import { NotificationIcon } from '../components/NotificationIcon';

export default function Notifications() {
  const { data, error, loading, reload, setData } = useApi('/notifications?limit=50');
  const { setUnreadNotifications } = useRealtime();
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  useSocketEvent('notification', () => reload(true));

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const readAll = async () => {
    await api.post('/notifications/read-all');
    setUnreadNotifications(0);
    setData((d) => ({ ...d, unread: 0, items: d.items.map((i) => ({ ...i, is_read: 1 })) }));
  };
  const open = (n) => {
    if (!n.is_read) {
      api.post(`/notifications/${n.id}/read`).catch(() => {});
      setUnreadNotifications((c) => Math.max(0, c - 1));
    }
    if (n.link) navigate(n.link);
  };
  const loadMore = async () => {
    setMore(true);
    const last = data.items[data.items.length - 1];
    const next = await api.get(`/notifications?limit=50&before=${last.id}`);
    setData((d) => ({ ...d, items: [...d.items, ...next.items], done: next.items.length < 50 }));
    setMore(false);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="الإشعارات" subtitle={data.unread ? `${data.unread} غير مقروء` : 'كل الإشعارات مقروءة'}
        actions={data.unread > 0 && <Button variant="secondary" icon={CheckCheck} onClick={readAll}>تحديد الكل كمقروء</Button>} />
      <Card className="overflow-hidden">
        {!data.items.length ? <EmptyState icon={Bell} title="لا توجد إشعارات" /> : data.items.map((n) => (
          <button key={n.id} onClick={() => open(n)} className={cx('w-full text-right flex gap-4 px-5 py-4 border-b border-line last:border-0 hover:bg-surface-2', !n.is_read && 'bg-brand-50/50 dark:bg-brand-500/5')}>
            <NotificationIcon type={n.type} className="size-11" />
            <div className="flex-1 min-w-0">
              <p className={cx(!n.is_read && 'font-bold')}>{n.title}</p>
              {n.body && <p className="text-sm text-muted mt-0.5">{n.body}</p>}
              <p className="text-xs text-muted mt-1" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</p>
            </div>
            {!n.is_read && <span className="size-2.5 rounded-full bg-brand-500 mt-2 shrink-0" />}
          </button>
        ))}
      </Card>
      {data.items.length >= 50 && !data.done && <div className="text-center mt-4"><Button variant="ghost" loading={more} onClick={loadMore}>تحميل المزيد</Button></div>}
    </div>
  );
}

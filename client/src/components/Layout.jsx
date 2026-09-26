import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, QrCode, MessagesSquare, Bell, Building2, Users, Library, LogOut,
  Moon, Sun, Menu, X, UserCog, CheckCheck, CalendarDays, Megaphone, DatabaseBackup, CalendarRange, ClipboardList, Landmark, Gauge,
} from 'lucide-react';
import { Logo, BrandTitle } from '../context/BrandingContext';
import HeaderClock from './HeaderClock';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { api } from '../lib/api';
import { ROLE_LABELS, titled, timeAgo } from '../lib/format';
import { Avatar, IconButton, cx, Spinner } from './ui';
import { NotificationIcon } from './NotificationIcon';

function navFor(role, user) {
  const common = [{ to: '/', label: 'الرئيسية', icon: LayoutDashboard, end: true }];
  const follow = user?.oversight?.length ? [{ to: '/oversight', label: 'لوحة المتابعة', icon: Gauge }] : [];
  if (role === 'leader') {
    return [{ to: '/oversight', label: 'لوحة المتابعة', icon: Gauge }, { to: '/calendar', label: 'التقويم الأكاديمي', icon: CalendarRange },
      { to: '/notifications', label: 'الإشعارات', icon: Bell, badge: 'notifications' }];
  }
  if (role === 'admin') {
    return [...common,
      { to: '/oversight', label: 'لوحة المتابعة', icon: Gauge },
      { to: '/admin/faculties', label: 'الكليات والقيادات', icon: Landmark },
      { to: '/admin/departments', label: 'الأقسام', icon: Building2 },
      { to: '/admin/users', label: 'المستخدمون', icon: Users },
      { to: '/admin/courses', label: 'المواد والتسجيل', icon: Library },
      { to: '/admin/exams', label: 'جدول الامتحانات', icon: ClipboardList },
      { to: '/calendar', label: 'التقويم الأكاديمي', icon: CalendarRange },
      { to: '/admin/broadcast', label: 'إعلانات الكلية', icon: Megaphone },
      { to: '/admin/system', label: 'إعدادات الكلية', icon: DatabaseBackup },
      { to: '/courses', label: 'استعراض المواد', icon: BookOpen },
    ];
  }
  return [...common, ...follow,
    { to: '/courses', label: 'موادي', icon: BookOpen },
    { to: '/schedule', label: 'جدولي', icon: CalendarDays },
    { to: '/calendar', label: 'التقويم', icon: CalendarRange },
    { to: '/exams', label: role === 'student' ? 'امتحاناتي' : 'الامتحانات', icon: ClipboardList },
    ...(role === 'student' ? [{ to: '/scan', label: 'تسجيل الحضور', icon: QrCode }] : []),
    { to: '/chat', label: 'المحادثات', icon: MessagesSquare, badge: 'messages' },
    { to: '/notifications', label: 'الإشعارات', icon: Bell, badge: 'notifications' },
  ];
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
    setDark(next);
  };
  return [dark, toggle];
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const { unreadNotifications, setUnreadNotifications } = useRealtime();
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    api.get('/notifications?limit=8').then((d) => setItems(d.items)).catch(() => setItems([]));
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, unreadNotifications]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.is_read) {
      api.post(`/notifications/${n.id}/read`).catch(() => {});
      setUnreadNotifications((c) => Math.max(0, c - 1));
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    await api.post('/notifications/read-all');
    setUnreadNotifications(0);
    setItems((xs) => xs?.map((x) => ({ ...x, is_read: 1 })));
  };

  return (
    <div className="relative" ref={ref}>
      <IconButton icon={Bell} label="الإشعارات" badge={unreadNotifications} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="absolute left-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface shadow-2xl z-40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <p className="font-bold">الإشعارات</p>
            {unreadNotifications > 0 && (
              <button onClick={readAll} className="text-xs font-semibold text-brand-600 dark:text-brand-300 flex items-center gap-1">
                <CheckCheck className="size-4" /> تحديد الكل كمقروء
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {!items ? <div className="grid place-items-center py-8"><Spinner /></div>
              : !items.length ? <p className="text-center text-sm text-muted py-10">لا توجد إشعارات</p>
                : items.map((n) => (
                  <button key={n.id} onClick={() => openItem(n)}
                    className={cx('w-full text-right flex gap-3 px-4 py-3 hover:bg-surface-2 border-b border-line last:border-0', !n.is_read && 'bg-brand-50/60 dark:bg-brand-500/5')}>
                    <NotificationIcon type={n.type} />
                    <div className="min-w-0 flex-1">
                      <p className={cx('text-sm leading-snug', !n.is_read ? 'font-bold text-ink' : 'text-ink')}>{n.title}</p>
                      {n.body && <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-muted mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.is_read && <span className="size-2 rounded-full bg-brand-500 mt-2 shrink-0" />}
                  </button>
                ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block text-center text-sm font-semibold text-brand-600 dark:text-brand-300 py-3 border-t border-line hover:bg-surface-2">
            عرض كل الإشعارات
          </Link>
        </div>
      )}
    </div>
  );
}

function Sidebar({ items, badges, onNavigate, user, onLogout }) {
  return (
    <div className="flex flex-col h-full">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-5 h-16 shrink-0">
        <Logo className="size-10 shrink-0" />
        <BrandTitle />
      </Link>
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => cx(
              'flex items-center gap-3 rounded-xl px-3 h-11 text-sm font-semibold transition-colors',
              isActive ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25' : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            <item.icon className="size-5" />
            <span className="flex-1">{item.label}</span>
            {item.badge && badges[item.badge] > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] grid place-items-center">{badges[item.badge]}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-line">
        <NavLink to="/profile" onClick={onNavigate} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2', isActive && 'bg-surface-2')}>
          <Avatar name={user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{titled(user)}</p>
            <p className="text-xs text-muted truncate">{user.oversight?.[0]?.title || ROLE_LABELS[user.role]}{user.department_name ? ` · ${user.department_name}` : ''}</p>
          </div>
          <UserCog className="size-4 text-muted" />
        </NavLink>
        <button onClick={onLogout} className="mt-1 w-full flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-semibold text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
          <LogOut className="size-4" /> تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { unreadMessages, unreadNotifications, connected } = useRealtime();
  const [dark, toggleTheme] = useTheme();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const items = navFor(user.role, user);
  const badges = { messages: unreadMessages, notifications: unreadNotifications };

  useEffect(() => setDrawer(false), [location.pathname]);

  const bottomItems = items.filter((i) => !['/notifications', '/calendar', '/schedule'].includes(i.to)).slice(0, 5);

  return (
    <div className="min-h-screen lg:pr-72">
      <aside className="hidden lg:block fixed inset-y-0 right-0 w-72 border-l border-line bg-surface z-30">
        <Sidebar items={items} badges={badges} user={user} onLogout={logout} />
      </aside>

      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 right-0 w-72 max-w-[85vw] bg-surface shadow-2xl">
            <IconButton icon={X} label="إغلاق" className="absolute left-3 top-3" onClick={() => setDrawer(false)} />
            <Sidebar items={items} badges={badges} user={user} onLogout={logout} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 h-16 bg-canvas/80 backdrop-blur border-b border-line">
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-2">
          <IconButton icon={Menu} label="القائمة" className="lg:hidden" onClick={() => setDrawer(true)} />
          <Link to="/" className="lg:hidden flex items-center gap-2 min-w-0">
            <Logo className="size-8 shrink-0" /> <BrandTitle sub={false} />
          </Link>
          <HeaderClock />
          <div className="flex-1" />
          {!connected && <span className="hidden sm:inline text-xs text-amber-600 font-semibold">جارٍ الاتصال…</span>}
          <IconButton icon={dark ? Sun : Moon} label="تبديل المظهر" onClick={toggleTheme} />
          {user.role !== 'admin' && (
            <IconButton icon={MessagesSquare} label="المحادثات" badge={unreadMessages} onClick={() => navigate('/chat')} className="hidden sm:inline-flex" />
          )}
          <NotificationsMenu />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-28 lg:pb-10">
        <Outlet />
      </main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-around">
          {bottomItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => cx('relative flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-muted')}>
              <item.icon className="size-5" />
              {item.label}
              {item.badge && badges[item.badge] > 0 && <span className="absolute top-1.5 left-1/2 -translate-x-4 size-2.5 rounded-full bg-rose-500 ring-2 ring-surface" />}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

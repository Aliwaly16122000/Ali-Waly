import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronRight, Maximize, Minimize, Square, Plus, Users, CheckCircle2, MapPin, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { getLocation } from '../lib/device';
import { useApi } from '../lib/useApi';
import { useSocketEvent } from '../context/RealtimeContext';
import { Avatar, Button, ConfirmModal, ErrorState, PageLoader, cx } from '../components/ui';
import { fmtTime } from '../lib/format';
import { useBranding } from '../context/BrandingContext';

function useCountdown(target) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, new Date(target).getTime() - now);
}

/** Projector screen: rotating QR + live list of students as they check in. */
export default function AttendanceLive() {
  const { id } = useParams();
  const brand = useBranding();
  const { data: session, error, loading, reload } = useApi(`/attendance/${id}`);
  const [token, setToken] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [recent, setRecent] = useState([]);

  const fetchToken = useCallback(async () => {
    try {
      const t = await api.get(`/attendance/${id}/token`);
      setToken({ ...t, fetchedAt: Date.now() });
      return t;
    } catch {
      return null;
    }
  }, [id]);

  // Refresh the QR exactly when the current window expires.
  useEffect(() => {
    let timer;
    let cancelled = false;
    const loop = async () => {
      const t = await fetchToken();
      if (cancelled) return;
      const wait = t?.active ? Math.max(500, t.expires_in_ms + 150) : 5000;
      timer = setTimeout(loop, wait);
    };
    loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [fetchToken]);

  useSocketEvent('attendance:new', (e) => {
    if (e.session_id !== Number(id)) return;
    setRecent((r) => [e.student, ...r].slice(0, 30));
    reload(true);
  });

  const remaining = useCountdown(session?.closes_at ?? 0);
  const rotateLeft = token?.active ? Math.max(0, token.expires_in_ms - (Date.now() - token.fetchedAt)) : 0;

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); setFullscreen(true); }
      else { await document.exitFullscreen(); setFullscreen(false); }
    } catch { /* unsupported */ }
  };

  const close = async () => {
    await api.post(`/attendance/${id}/close`);
    toast.success('تم إغلاق تسجيل الحضور');
    setClosing(false);
    reload(true);
    fetchToken();
  };
  const extend = async () => {
    await api.post(`/attendance/${id}/extend`, { minutes: 5 });
    toast.success('تمت إضافة 5 دقائق');
    reload(true);
    fetchToken();
  };

  const [pinning, setPinning] = useState(false);
  const repin = async () => {
    setPinning(true);
    try {
      const location = await getLocation();
      await api.put(`/attendance/${id}/location`, { location });
      toast.success(`اتحدد مكانك من جديد (دقة ±${Math.round(location.accuracy)} متر)`);
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPinning(false);
    }
  };

  if (loading && !session) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const present = session.students.filter((s) => s.recorded_at);
  const active = session.active && token?.active;
  const qrValue = token?.token ? `${window.location.origin}/attend?t=${encodeURIComponent(token.token)}` : '';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-950 via-brand-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link to={`/courses/${session.course_id}?tab=attendance`} className="inline-flex items-center gap-1 text-white/70 hover:text-white"><ChevronRight className="size-5" /> رجوع</Link>
          <div className="flex-1" />
          {session.active && <Button variant="secondary" size="sm" icon={Plus} onClick={extend} className="bg-white/10 border-white/20 text-white hover:bg-white/20">5 دقائق</Button>}
          {session.active && <Button variant="danger" size="sm" icon={Square} onClick={() => setClosing(true)}>إنهاء التسجيل</Button>}
          <Button variant="secondary" size="sm" icon={fullscreen ? Minimize : Maximize} onClick={toggleFullscreen} className="bg-white/10 border-white/20 text-white hover:bg-white/20">ملء الشاشة</Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-8 items-start">
          <div className="text-center">
            {brand.logo_url && <img src={brand.logo_url} alt="" className="size-16 object-contain mx-auto mb-3 bg-white rounded-2xl p-1.5" />}
            <p className="text-white/60 text-sm">{[brand.faculty, brand.university].filter(Boolean).join(' · ')}</p>
            <p className="text-white/60 ltr">{session.course_code}</p>
            <h1 className="text-3xl sm:text-4xl font-extrabold mt-1">{session.course_name}</h1>
            <p className="text-xl text-white/80 mt-1">{session.title}</p>

            {active && token.mode === 'location' ? (
              <>
                <div className="relative mx-auto mt-10 size-56 grid place-items-center">
                  <span className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
                  <span className="absolute inset-6 rounded-full bg-emerald-400/20" />
                  <div className="relative size-28 rounded-full bg-emerald-500 grid place-items-center shadow-2xl shadow-emerald-500/40"><MapPin className="size-14" /></div>
                </div>
                <p className="mt-6 text-2xl font-bold">الحضور بالموقع شغال</p>
                <p className="mt-2 text-white/70 max-w-md mx-auto">أي طالب في نطاق <b className="text-white">{session.geo_radius} متر</b> منك يفتح الإشعار أو صفحة "تسجيل الحضور" وحضوره يتسجل لوحده — من غير QR.</p>
                <p className="mt-2 text-white/50 text-sm">خلّي موبايلك في القاعة. لو اتحركت لقاعة تانية حدّث مكانك.</p>
                <Button variant="secondary" size="sm" icon={Crosshair} loading={pinning} onClick={repin} className="mt-4 bg-white/10 border-white/20 text-white hover:bg-white/20">تحديث مكاني</Button>
                <p className="mt-6 text-2xl font-bold tabular-nums ltr">{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}</p>
                <p className="text-white/60 text-sm">متبقي على الإغلاق</p>
              </>
            ) : active ? (
              <>
                <div className="relative inline-block mt-8 rounded-3xl bg-white p-5 sm:p-7 shadow-2xl shadow-brand-500/30">
                  <QRCodeSVG value={qrValue} size={360} level="M" className="w-[min(70vw,360px)] h-auto" />
                  {token.rotate_seconds > 0 && (
                    <div className="absolute inset-x-6 bottom-2 h-1 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-brand-500 transition-[width] duration-300 ease-linear" style={{ width: `${(rotateLeft / (token.rotate_seconds * 1000)) * 100}%` }} />
                    </div>
                  )}
                </div>
                <p className="mt-6 text-white/70">افتح كاميرا الموبايل أو صفحة "تسجيل الحضور" في التطبيق وامسح الكود</p>
                <p className="mt-3 text-white/60 text-sm">أو اكتب الكود</p>
                <p className="text-5xl font-extrabold tracking-[0.3em] ltr mt-1 tabular-nums">{token.code}</p>
                <p className="mt-6 text-2xl font-bold tabular-nums ltr">{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}</p>
                <p className="text-white/60 text-sm">متبقي على الإغلاق</p>
              </>
            ) : (
              <div className="mt-16 rounded-3xl bg-white/5 border border-white/10 p-10 inline-block">
                <CheckCircle2 className="size-14 mx-auto text-emerald-400 mb-3" />
                <p className="text-2xl font-bold">تم إغلاق تسجيل الحضور</p>
                <p className="text-white/60 mt-1">{present.length} طالب حاضر من {session.students.length}</p>
                <Button className="mt-5" icon={Plus} onClick={extend}>إعادة فتح لمدة 5 دقائق</Button>
              </div>
            )}
          </div>

          <div className="rounded-3xl bg-white/5 border border-white/10 backdrop-blur p-5">
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-white/60 text-sm flex items-center gap-1.5"><Users className="size-4" /> الحضور</p>
                <p className="text-5xl font-extrabold tabular-nums ltr text-right">{present.length}<span className="text-2xl text-white/50">/{session.students.length}</span></p>
              </div>
              <p className="text-emerald-300 font-bold text-2xl ltr">{session.students.length ? Math.round((present.length / session.students.length) * 100) : 0}%</p>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-5">
              <div className="h-full bg-emerald-400 transition-all" style={{ width: `${session.students.length ? (present.length / session.students.length) * 100 : 0}%` }} />
            </div>
            <ul className="space-y-2 max-h-[55vh] overflow-y-auto scrollbar-thin">
              {present.map((s) => (
                <li key={s.id} className={cx('flex items-center gap-3 rounded-xl p-2 transition-colors', recent[0]?.id === s.id ? 'bg-emerald-500/20' : 'bg-white/5')}>
                  <Avatar name={s.name} size="sm" />
                  <div className="flex-1 min-w-0"><p className="font-semibold truncate">{s.name}</p><p className="text-xs text-white/50 ltr text-right">{s.username}</p></div>
                  <span className="text-xs text-white/50">{fmtTime(s.recorded_at)}</span>
                </li>
              ))}
              {!present.length && <li className="text-center text-white/50 py-8">في انتظار أول طالب…</li>}
            </ul>
          </div>
        </div>
      </div>
      <ConfirmModal open={closing} onClose={() => setClosing(false)} onConfirm={close} title="إنهاء تسجيل الحضور"
        message="بعد الإنهاء مش هيقدر أي طالب يسجل حضوره. تقدر تسجل حضور طالب يدوياً من سجل المحاضرات." confirmLabel="إنهاء" />
    </div>
  );
}

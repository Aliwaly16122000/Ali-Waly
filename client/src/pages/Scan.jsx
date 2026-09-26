import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import { Camera, CameraOff, CheckCircle2, KeyRound, XCircle, QrCode, RotateCcw, MapPin, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { deviceId, deviceLabel, getLocation } from '../lib/device';
import { Button, Card, Input, PageHeader, Spinner } from '../components/ui';

/** Student check-in: camera QR scanner, 6-digit code fallback, or a deep link (/attend?t=…). */
export default function Scan() {
  const [params, setParams] = useSearchParams();
  const video = useRef(null);
  const scanner = useRef(null);
  const busy = useRef(false);
  const [camera, setCamera] = useState('idle'); // idle | starting | on | denied | unsupported
  const [result, setResult] = useState(null); // { ok, message, course }
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);

  const stopCamera = useCallback(() => {
    scanner.current?.stop();
    scanner.current?.destroy();
    scanner.current = null;
    setCamera((c) => (c === 'on' || c === 'starting' ? 'idle' : c));
  }, []);

  const send = useCallback(async (payload) => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    const base = { device_id: deviceId(), device_label: deviceLabel() };
    const done = (res) => {
      stopCamera();
      navigator.vibrate?.(120);
      setResult({ ok: true, already: res.already, course: res.course, session: res.session });
    };
    try {
      done(await api.post('/attendance/scan', { ...payload, ...base }));
    } catch (err) {
      if (err.data?.code === 'location_required') {
        // This course checks that you're in the lecture hall: get a GPS fix and retry.
        stopCamera();
        setLocating(true);
        try {
          const location = await getLocation();
          done(await api.post('/attendance/scan', { ticket: err.data.ticket, location, ...base }));
        } catch (e) {
          setResult({ ok: false, message: e.message });
        } finally {
          setLocating(false);
        }
      } else {
        setResult({ ok: false, message: err.message, code: err.data?.code });
      }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, [stopCamera]);

  // Deep link from the phone's native camera: /attend?t=TOKEN
  useEffect(() => {
    const t = params.get('t');
    if (t) {
      send({ token: t });
      setParams({}, { replace: true });
    }
  }, [params, setParams, send]);

  const startCamera = async () => {
    setResult(null);
    if (!(await QrScanner.hasCamera())) return setCamera('unsupported');
    setCamera('starting');
    try {
      scanner.current = new QrScanner(video.current, (r) => send({ token: r.data }), {
        preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 4,
        returnDetailedScanResult: true,
      });
      await scanner.current.start();
      setCamera('on');
    } catch {
      setCamera('denied');
    }
  };

  useEffect(() => stopCamera, [stopCamera]);

  const submitCode = (e) => {
    e.preventDefault();
    if (code.length === 6) send({ code });
  };

  return (
    <div className="max-w-lg mx-auto">
      <PageHeader title="تسجيل الحضور" subtitle="امسح الـ QR المعروض في المدرج أو اكتب الكود اللي تحته" />

      {locating && (
        <Card className="p-6 mb-6 text-center">
          <MapPin className="size-10 mx-auto text-brand-500 animate-bounce mb-3" />
          <p className="font-bold">جارٍ تحديد موقعك…</p>
          <p className="text-sm text-muted mt-1">المادة دي بتتأكد إنك موجود في المدرج. لو ظهرلك طلب إذن الموقع اضغط "سماح".</p>
        </Card>
      )}

      {result && (
        <Card className={`p-6 mb-6 text-center ${result.ok ? 'border-emerald-300 dark:border-emerald-500/40' : 'border-rose-300 dark:border-rose-500/40'}`}>
          {result.ok ? (
            <>
              <div className="size-20 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 grid place-items-center mb-4"><CheckCircle2 className="size-12 text-emerald-600" /></div>
              <p className="text-xl font-extrabold">{result.already ? 'حضورك متسجل بالفعل' : 'تم تسجيل حضورك ✓'}</p>
              <p className="text-muted mt-1">{result.course.name} · {result.session.title}</p>
            </>
          ) : (
            <>
              <div className="size-20 mx-auto rounded-full bg-rose-100 dark:bg-rose-500/15 grid place-items-center mb-4"><XCircle className="size-12 text-rose-600" /></div>
              <p className="text-lg font-bold">لم يتم التسجيل</p>
              <p className="text-muted mt-1">{result.message}</p>
              {result.code === 'device_mismatch' && <p className="text-xs text-muted mt-2 flex items-center justify-center gap-1"><Smartphone className="size-3.5" /> لحماية الحضور، كل حساب مربوط بموبايل واحد.</p>}
              <Button variant="secondary" icon={RotateCcw} className="mt-4" onClick={startCamera}>حاول مرة أخرى</Button>
            </>
          )}
        </Card>
      )}

      <Card className="overflow-hidden mb-6">
        <div className="relative aspect-square bg-slate-950 grid place-items-center">
          <video ref={video} className={`absolute inset-0 size-full object-cover ${camera === 'on' ? '' : 'hidden'}`} muted playsInline />
          {camera !== 'on' && (
            <div className="text-center text-white/80 p-8">
              {camera === 'starting' ? <Spinner className="size-10 mx-auto text-white" /> : (
                <>
                  {camera === 'denied' || camera === 'unsupported' ? <CameraOff className="size-14 mx-auto mb-3 text-white/60" /> : <QrCode className="size-16 mx-auto mb-3 text-white/60" />}
                  <p className="mb-5">
                    {camera === 'denied' ? 'لم يتم السماح باستخدام الكاميرا. فعّلها من إعدادات المتصفح أو استخدم الكود.'
                      : camera === 'unsupported' ? 'لا توجد كاميرا متاحة، استخدم الكود بالأسفل.' : 'اضغط لفتح الكاميرا ووجّهها للـ QR'}
                  </p>
                  {camera !== 'unsupported' && <Button icon={Camera} size="lg" onClick={startCamera}>فتح الكاميرا</Button>}
                </>
              )}
            </div>
          )}
          {submitting && <div className="absolute inset-0 bg-slate-950/60 grid place-items-center"><Spinner className="size-10 text-white" /></div>}
        </div>
        {camera === 'on' && <div className="p-3 text-center"><Button variant="ghost" size="sm" onClick={stopCamera}>إيقاف الكاميرا</Button></div>}
      </Card>

      <Card className="p-5">
        <p className="font-bold flex items-center gap-2 mb-3"><KeyRound className="size-5 text-brand-500" /> الكاميرا مش شغالة؟ اكتب الكود</p>
        <form onSubmit={submitCode} className="flex gap-2">
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" placeholder="••••••"
            className="h-12 text-center text-2xl tracking-[0.4em] font-bold" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <Button type="submit" size="lg" loading={submitting} disabled={code.length !== 6}>تسجيل</Button>
        </form>
      </Card>
    </div>
  );
}

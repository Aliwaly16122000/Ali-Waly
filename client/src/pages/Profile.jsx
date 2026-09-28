import { useEffect, useState } from 'react';
import { BellRing, KeyRound, User, Smartphone, Send, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { LEVEL_LABELS, ROLE_LABELS, titled } from '../lib/format';
import { Alert, Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '../components/ui';
import { ChangePasswordForm } from './ForceChangePassword';

function PushCard() {
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pushSupported()) return setState('unsupported');
    currentSubscription().then((s) => setState(s ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off')).catch(() => setState('off'));
  }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      if (state === 'on') { await disablePush(); setState('off'); toast.success('تم إيقاف الإشعارات على هذا الجهاز'); }
      else { await enablePush(); setState('on'); toast.success('تم تفعيل الإشعارات 🔔'); }
    } catch (err) {
      toast.error(err.message);
      if (Notification.permission === 'denied') setState('denied');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader icon={BellRing} title="إشعارات الموبايل والكمبيوتر" subtitle="يوصلك إشعار حتى لو التطبيق مقفول" />
      <div className="px-5 pb-5 space-y-3">
        {state === 'unsupported' && <Alert tone="amber">المتصفح ده مش بيدعم الإشعارات. على الآيفون: ضيف التطبيق للشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحه من هناك.</Alert>}
        {state === 'denied' && <Alert tone="red">الإشعارات مرفوضة من إعدادات المتصفح. فعّلها من إعدادات الموقع ثم حاول مرة أخرى.</Alert>}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Smartphone className="size-4 text-muted" /> هذا الجهاز: {state === 'on' ? <Badge tone="green" dot>مفعّلة</Badge> : <Badge tone="slate">غير مفعّلة</Badge>}
          </div>
          {state !== 'unsupported' && state !== 'loading' && (
            <Button variant={state === 'on' ? 'secondary' : 'primary'} loading={busy} onClick={toggle}>{state === 'on' ? 'إيقاف' : 'تفعيل الإشعارات'}</Button>
          )}
        </div>
        {state === 'on' && <PushTest />}
        <p className="text-xs text-muted">هيوصلك إشعار لما ينزل شيت أو إعلان أو درجات، لما يتفتح الحضور، ولما حد يبعتلك رسالة.</p>
      </div>
    </Card>
  );
}

/** Lets people check delivery themselves, including with the app closed. */
function PushTest() {
  const [busy, setBusy] = useState(null);
  const run = async (delay) => {
    setBusy(delay);
    try {
      const res = await api.post('/notifications/push/test', { delay });
      if (delay) toast.success(`اقفل التطبيق دلوقتي — الإشعار هييجي بعد ${delay} ثواني`, { duration: 8000 });
      else if (res.results.every((r) => r.ok)) toast.success('اتبعت ✅ — لو مظهرش، شوف إعدادات الإشعارات للتطبيق في الموبايل');
      else toast.error(`خدمة الإشعارات رفضت: ${res.results.filter((r) => !r.ok).map((r) => `${r.service} (${r.status ?? r.error})`).join('، ')}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="soft" icon={Send} loading={busy === 0} onClick={() => run(0)}>إشعار تجريبي</Button>
      <Button size="sm" variant="soft" icon={Timer} loading={busy === 10} onClick={() => run(10)}>تجربة والتطبيق مقفول (بعد 10 ثواني)</Button>
    </div>
  );
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ email: user.email || '', phone: user.phone || '' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/auth/profile', form);
      await refresh();
      toast.success('تم حفظ البيانات');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader title="حسابي" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <Avatar name={user.name} size="lg" />
              <div>
                <p className="text-xl font-extrabold">{titled(user)}</p>
                <p className="text-muted">{ROLE_LABELS[user.role]}{user.department_name && ` · ${user.department_name}`}{user.role === 'student' && user.level !== null && ` · ${LEVEL_LABELS[user.level]}`}</p>
                <p className="text-sm text-muted ltr text-right mt-0.5">{user.username}</p>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader icon={User} title="بيانات التواصل" />
            <form onSubmit={save} className="px-5 pb-5 space-y-4">
              <Field label="البريد الإلكتروني">{(id) => <Input id={id} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
              <Field label="رقم الموبايل">{(id) => <Input id={id} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
              <Button type="submit" loading={saving}>حفظ</Button>
            </form>
          </Card>
          <PushCard />
        </div>
        <Card className="h-fit">
          <CardHeader icon={KeyRound} title="تغيير كلمة السر" />
          <div className="px-5 pb-5"><ChangePasswordForm /></div>
        </Card>
      </div>
    </>
  );
}

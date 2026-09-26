import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Alert, Button, Card, Field, Input } from '../components/ui';

export function ChangePasswordForm({ onDone, requireCurrent = true }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.new_password !== form.confirm) return setError('كلمتا السر غير متطابقتين');
    setLoading(true);
    try {
      await api.post('/auth/change-password', { current_password: form.current_password, new_password: form.new_password });
      toast.success('تم تغيير كلمة السر بنجاح');
      setForm({ current_password: '', new_password: '', confirm: '' });
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="red">{error}</Alert>}
      {requireCurrent && (
        <Field label="كلمة السر الحالية">{(id) => <Input id={id} type="password" dir="ltr" value={form.current_password} onChange={set('current_password')} required />}</Field>
      )}
      <Field label="كلمة السر الجديدة" hint="6 أحرف على الأقل">{(id) => <Input id={id} type="password" dir="ltr" value={form.new_password} onChange={set('new_password')} minLength={6} required />}</Field>
      <Field label="تأكيد كلمة السر الجديدة">{(id) => <Input id={id} type="password" dir="ltr" value={form.confirm} onChange={set('confirm')} required />}</Field>
      <Button type="submit" loading={loading} icon={KeyRound} className="w-full">حفظ كلمة السر</Button>
    </form>
  );
}

export default function ForceChangePassword() {
  const { user, refresh, logout } = useAuth();
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="size-14 rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 grid place-items-center mb-5"><ShieldCheck className="size-7" /></div>
        <h1 className="text-2xl font-extrabold">أهلاً {user.name}</h1>
        <p className="text-muted mt-2 mb-6">لحماية حسابك، لازم تغيّر كلمة السر المؤقتة اللي استلمتها قبل ما تكمل.</p>
        <ChangePasswordForm onDone={refresh} />
        <button onClick={logout} className="w-full text-sm text-muted mt-4 hover:text-ink">تسجيل الخروج</button>
      </Card>
    </div>
  );
}

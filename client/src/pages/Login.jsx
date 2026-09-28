import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, QrCode, BarChart3, MessagesSquare, FileCheck2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input, Alert } from '../components/ui';
import { Logo, useBranding } from '../context/BrandingContext';

const FEATURES = [
  { icon: FileCheck2, title: 'الشيتات والتسليم', text: 'ارفع حلك واعرف درجتك أول ما تتعتمد' },
  { icon: QrCode, title: 'حضور بالـ QR', text: 'سجّل حضورك في ثانية من موبايلك' },
  { icon: BarChart3, title: 'إحصائيات فورية', text: 'تجميع تلقائي للدرجات وتحليلات للدكتور' },
  { icon: MessagesSquare, title: 'تواصل مباشر', text: 'محادثات مع الدكاترة والمعيدين' },
];

export default function Login() {
  const { login } = useAuth();
  const brand = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState(() => ({ username: new URLSearchParams(location.search).get('u') || '', password: '' }));
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.username.trim(), form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-4 mb-10">
            <Logo className="size-16 shrink-0" />
            <div>
              <p className="text-xl font-extrabold">{brand.faculty || 'بوابة كلية الهندسة'}</p>
              <p className="text-sm text-muted">{brand.university || 'Faculty of Engineering Portal'}</p>
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">أهلاً بيك 👋</h1>
          <p className="text-muted mt-2 mb-8">سجّل دخولك بالكود الجامعي أو اسم المستخدم وكلمة السر اللي استلمتها من الكلية.</p>

          <form onSubmit={submit} className="space-y-4">
            {error && <Alert tone="red">{error}</Alert>}
            <Field label="الكود الجامعي / اسم المستخدم">
              {(id) => (
                <Input id={id} autoFocus autoComplete="username" dir="ltr" className="text-left h-12" placeholder="2023001"
                  value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              )}
            </Field>
            <Field label="كلمة السر">
              {(id) => (
                <div className="relative">
                  <Input id={id} type={show ? 'text' : 'password'} autoComplete="current-password" dir="ltr" className="text-left h-12 pl-11"
                    value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-label="إظهار كلمة السر">
                    {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              )}
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={loading} icon={LogIn}>تسجيل الدخول</Button>
          </form>
          <p className="text-xs text-muted mt-8 text-center">نسيت كلمة السر؟ تواصل مع شؤون الطلاب لإعادة تعيينها.</p>
        </div>
      </div>

      <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white p-12 items-center">
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 size-[28rem] rounded-full bg-brand-400/20 blur-3xl" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.07]" aria-hidden="true">
          <defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0v32" fill="none" stroke="white" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="relative max-w-lg">
          {brand.logo_url && <img src={brand.logo_url} alt="" className="size-24 object-contain mb-6 drop-shadow-xl bg-white/95 rounded-3xl p-2" />}
          <p className="text-brand-200 font-semibold mb-3">{[brand.faculty, brand.university].filter(Boolean).join(' · ') || 'كل حاجة في مكان واحد'}</p>
          <h2 className="text-4xl font-extrabold leading-tight">موادك، شيتاتك، درجاتك وحضورك<br />على منصة واحدة.</h2>
          <div className="grid grid-cols-2 gap-4 mt-10">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl bg-white/10 backdrop-blur p-5 border border-white/10">
                <f.icon className="size-7 text-amber-300 mb-3" />
                <p className="font-bold">{f.title}</p>
                <p className="text-sm text-brand-100 mt-1">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck, Lock, Star, ChevronRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Textarea, cx } from '../../components/ui';

export function SurveyList() {
  const { data, error, loading, reload } = useApi('/surveys/pending');
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="الاستبيانات" subtitle="رأيك بيوصل للإدارة من غير اسمك — ومحدش من الدكاترة أو المعيدين بيعرف مين كتب إيه" />
      {!data.length ? <Card><EmptyState icon={CheckCircle2} title="مفيش استبيانات مطلوبة منك 👏" /></Card> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.map((s) => (
            <Link key={`${s.id}-${s.course_id}`} to={`/surveys/${s.id}/${s.course_id}`}>
              <Card className="p-5 h-full hover:border-brand-300">
                <div className="flex items-center gap-2 mb-2"><ClipboardCheck className="size-5 text-brand-500" /><p className="font-bold">{s.title}</p></div>
                <p className="text-lg font-extrabold">{s.course_name} <span className="text-sm text-muted font-normal ltr">{s.course_code}</span></p>
                {(s.gate_grades || s.gate_exams) && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {s.gate_grades && <Badge tone="amber"><Lock className="size-3" /> لفتح الدرجات</Badge>}
                    {s.gate_exams && <Badge tone="amber"><Lock className="size-3" /> لفتح جدول الامتحانات</Badge>}
                  </div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function SurveyForm() {
  const { id, courseId } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(`/surveys/${id}/form?course_id=${courseId}`);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const set = (qid, v) => setAnswers((a) => ({ ...a, [qid]: v }));
  const missing = data.questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === ''));
  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/surveys/${id}/respond`, { course_id: Number(courseId), answers });
      toast.success('شكراً! تم إرسال الاستبيان ✓');
      navigate(`/courses/${courseId}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/surveys" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4"><ChevronRight className="size-4" /> الاستبيانات</Link>
      <PageHeader title={data.title} subtitle={`${data.course.name} · ${data.course.code}`} />
      {data.answered ? <Alert tone="green" icon={CheckCircle2}>أنت ملأت الاستبيان ده للمادة دي بالفعل. شكراً!</Alert> : (
        <>
          {data.description && <p className="text-muted mb-4">{data.description}</p>}
          <Alert tone="blue" className="mb-4">إجاباتك مجهولة: الدكاترة والمعيدين بيشوفوا متوسطات بس من غير أسماء.</Alert>
          <div className="space-y-4">
            {data.questions.map((q, i) => (
              <Card key={q.id} className="p-5">
                <p className="font-bold mb-3">{i + 1}. {q.text} {q.required && <span className="text-rose-500">*</span>}</p>
                {q.type === 'rating' && (
                  <div className="flex gap-2" dir="ltr">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => set(q.id, n)} aria-label={`${n} من 5`}
                        className={cx('size-11 rounded-xl border grid place-items-center transition', answers[q.id] >= n ? 'bg-amber-400 border-amber-400 text-white' : 'border-line text-muted hover:border-amber-300')}>
                        <Star className={cx('size-5', answers[q.id] >= n && 'fill-white')} />
                      </button>
                    ))}
                    <span className="self-center text-sm text-muted ms-2">{['', 'ضعيف', 'مقبول', 'جيد', 'جيد جداً', 'ممتاز'][answers[q.id] || 0]}</span>
                  </div>
                )}
                {q.type === 'choice' && (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((o) => (
                      <button key={o} type="button" onClick={() => set(q.id, o)}
                        className={cx('rounded-full border px-4 py-1.5 text-sm font-semibold', answers[q.id] === o ? 'bg-brand-600 border-brand-600 text-white' : 'border-line text-muted')}>{o}</button>
                    ))}
                  </div>
                )}
                {q.type === 'text' && <Textarea value={answers[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} placeholder="اكتب رأيك…" />}
              </Card>
            ))}
          </div>
          <Button size="lg" className="w-full mt-6" loading={saving} disabled={missing.length > 0} onClick={submit}>
            {missing.length ? `فاضل ${missing.length} سؤال إجباري` : 'إرسال الاستبيان'}
          </Button>
        </>
      )}
    </div>
  );
}

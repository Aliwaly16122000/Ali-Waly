import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, Trash2, Play, Square, BarChart3, Lock, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { LEVEL_LABELS } from '../../lib/format';
import { Alert, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Progress, Select, Textarea, cx } from '../../components/ui';
import SurveyResults from '../surveys/Results';

const STATUS = { draft: ['مسودة', 'slate'], open: ['مفتوح', 'green'], closed: ['مقفول', 'red'] };
const QTYPES = { rating: 'تقييم من 5 نجوم', choice: 'اختيار من متعدد', text: 'إجابة مكتوبة' };

function Builder({ onClose, onSaved }) {
  const { data: template } = useApi('/surveys/template');
  const { data: departments } = useApi('/admin/departments');
  const { data: courses } = useApi('/courses');
  const [form, setForm] = useState({ title: 'تقييم المواد', description: '', gate_grades: true, gate_exams: false, share_with_staff: true });
  const [questions, setQuestions] = useState(null);
  const [target, setTarget] = useState({ mode: 'all', department_id: '', level: '', course_ids: [] });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (template && !questions) setQuestions(template); }, [template, questions]);
  if (!questions) return null;

  const upd = (i, patch) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i, d) => setQuestions((qs) => { const a = [...qs]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });
  const save = async () => {
    setSaving(true);
    try {
      const t = target.mode === 'courses' ? { course_ids: target.course_ids }
        : target.mode === 'filter' ? { department_id: target.department_id ? Number(target.department_id) : null, level: target.level === '' ? null : Number(target.level) } : {};
      const r = await api.post('/surveys', { ...form, description: form.description || null, questions, target: t });
      toast.success(`تم إنشاء الاستبيان لـ ${r.courses} مادة — افتحه عشان يوصل للطلاب`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="xl" title="استبيان جديد" subtitle="الطالب بيملاه مرة لكل مادة، والإجابات مجهولة للدكاترة"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ كمسودة</Button></>}>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Field label="العنوان">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
        <Field label="وصف (اختياري)">{(id) => <Input id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
      </div>

      <p className="font-bold mb-2 flex items-center gap-2"><Lock className="size-4 text-amber-500" /> لازم يتملى قبل ما الطالب يشوف</p>
      <div className="flex flex-wrap gap-3 mb-6">
        {[['gate_grades', 'الدرجات'], ['gate_exams', 'جدول الامتحانات'], ['share_with_staff', 'النتائج تظهر للدكتور والمعيد (بدون أسماء)']].map(([k, l]) => (
          <label key={k} className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer text-sm font-semibold', form[k] ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line')}>
            <input type="checkbox" className="size-4 accent-brand-600" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {l}
          </label>
        ))}
      </div>

      <p className="font-bold mb-2">المواد</p>
      <div className="grid sm:grid-cols-3 gap-2 mb-3">
        {[['all', 'كل مواد الترم الحالي'], ['filter', 'قسم / فرقة معينة'], ['courses', 'مواد أختارها']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTarget({ ...target, mode: k })} className={cx('rounded-xl border p-3 text-sm font-semibold', target.mode === k ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line')}>{l}</button>
        ))}
      </div>
      {target.mode === 'filter' && (
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <Select value={target.department_id} onChange={(e) => setTarget({ ...target, department_id: e.target.value })}><option value="">كل الأقسام</option>{(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          <Select value={target.level} onChange={(e) => setTarget({ ...target, level: e.target.value })}><option value="">كل الفرق</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</Select>
        </div>
      )}
      {target.mode === 'courses' && (
        <div className="max-h-48 overflow-y-auto rounded-xl border border-line divide-y divide-line mb-3">
          {(courses || []).map((c) => (
            <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-surface-2">
              <input type="checkbox" className="size-4 accent-brand-600" checked={target.course_ids.includes(c.id)}
                onChange={(e) => setTarget({ ...target, course_ids: e.target.checked ? [...target.course_ids, c.id] : target.course_ids.filter((x) => x !== c.id) })} />
              <span className="flex-1">{c.name}</span><span className="text-xs text-muted ltr">{c.code}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 mb-2">
        <p className="font-bold">الأسئلة ({questions.length})</p>
        <Button size="sm" variant="soft" icon={Plus} onClick={() => setQuestions([...questions, { id: `q${Date.now().toString(36)}`, type: 'rating', text: '', required: true }])}>سؤال</Button>
      </div>
      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-xl border border-line p-3 grid sm:grid-cols-[1fr_11rem_auto] gap-2 items-start">
            <Input value={q.text} onChange={(e) => upd(i, { text: e.target.value })} placeholder="نص السؤال" />
            <Select value={q.type} onChange={(e) => upd(i, { type: e.target.value, options: e.target.value === 'choice' ? q.options || ['نعم', 'لا'] : undefined })}>
              {Object.entries(QTYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <div className="flex items-center gap-1">
              <label className="text-xs flex items-center gap-1 px-1"><input type="checkbox" className="accent-brand-600" checked={q.required} onChange={(e) => upd(i, { required: e.target.checked })} />إجباري</label>
              <button type="button" disabled={!i} className="p-1.5 text-muted disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></button>
              <button type="button" disabled={i === questions.length - 1} className="p-1.5 text-muted disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></button>
              <button type="button" className="p-1.5 text-muted hover:text-rose-600" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
            </div>
            {q.type === 'choice' && (
              <Input className="sm:col-span-3" value={(q.options || []).join('، ')} placeholder="الاختيارات مفصولة بفاصلة"
                onChange={(e) => upd(i, { options: e.target.value.split(/[،,]/).map((x) => x.trim()).filter(Boolean) })} />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ResultsModal({ survey, onClose }) {
  const [courseId, setCourseId] = useState('');
  const { data } = useApi(`/surveys/${survey.id}/results${courseId ? `?course_id=${courseId}` : ''}`);
  const { data: all } = useApi(`/surveys/${survey.id}/results`);
  return (
    <Modal open onClose={onClose} size="xl" title={`نتائج: ${survey.title}`}>
      <Select className="mb-4 w-72" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
        <option value="">كل المواد مجمّعة</option>
        {(all?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.responses}/{c.expected})</option>)}
      </Select>
      {!courseId && all?.courses?.length > 0 && (
        <Card className="p-4 mb-4">
          <p className="font-bold mb-2">المشاركة حسب المادة</p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {all.courses.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-56 truncate">{c.name}</span>
                <Progress value={c.responses} max={c.expected || 1} className="flex-1" />
                <span className="w-16 text-xs text-muted ltr">{c.responses}/{c.expected}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {data ? <SurveyResults data={data} /> : <PageLoader />}
    </Modal>
  );
}

export default function Surveys() {
  const { data, loading, reload } = useApi('/surveys');
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState(null);
  const [removing, setRemoving] = useState(null);
  const status = async (s, st) => {
    await api.post(`/surveys/${s.id}/status`, { status: st });
    toast.success(st === 'open' ? 'تم فتح الاستبيان وإبلاغ الطلاب' : 'تم قفل الاستبيان');
    reload(true);
  };
  if (loading && !data) return <PageLoader />;
  return (
    <>
      <PageHeader title="الاستبيانات" subtitle="تقييم المواد وأي استبيان تاني — وتقدر تخليه شرط عشان الطالب يشوف درجاته أو جدول امتحاناته"
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>استبيان جديد</Button>} />
      <Alert tone="blue" className="mb-4">لما الاستبيان يتقفل، أي شرط عليه بيتلغي تلقائياً والدرجات/الجداول بتظهر للكل.</Alert>
      {!data.length ? <Card><EmptyState icon={ClipboardCheck} title="لا توجد استبيانات" /></Card> : (
        <div className="space-y-3">
          {data.map((s) => {
            const rate = s.expected ? Math.round((s.responses / s.expected) * 100) : 0;
            return (
              <Card key={s.id} className="p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-56">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{s.title}</p>
                    <Badge tone={STATUS[s.status][1]} dot>{STATUS[s.status][0]}</Badge>
                    {s.gate_grades && <Badge tone="amber"><Lock className="size-3" /> الدرجات</Badge>}
                    {s.gate_exams && <Badge tone="amber"><Lock className="size-3" /> الامتحانات</Badge>}
                  </div>
                  <p className="text-xs text-muted mt-1">{s.courses} مادة · {s.questions.length} سؤال</p>
                </div>
                <div className="w-48"><Progress value={s.responses} max={s.expected || 1} /><p className="text-xs text-muted mt-1">{s.responses} رد من {s.expected} ({rate}%)</p></div>
                <div className="flex gap-2">
                  {s.status !== 'open' && <Button size="sm" variant="success" icon={Play} onClick={() => status(s, 'open')}>فتح</Button>}
                  {s.status === 'open' && <Button size="sm" variant="secondary" icon={Square} onClick={() => status(s, 'closed')}>قفل</Button>}
                  <Button size="sm" variant="soft" icon={BarChart3} onClick={() => setResults(s)}>النتائج</Button>
                  <button className="p-2 rounded-lg text-muted hover:text-rose-600" onClick={() => setRemoving(s)} title="حذف"><Trash2 className="size-4" /></button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {creating && <Builder onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(true); }} />}
      {results && <ResultsModal survey={results} onClose={() => setResults(null)} />}
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} title="حذف الاستبيان" confirmLabel="حذف" message={`حذف "${removing?.title}" بكل ردوده؟`}
        onConfirm={async () => { await api.del(`/surveys/${removing.id}`); setRemoving(null); reload(true); }} />
    </>
  );
}

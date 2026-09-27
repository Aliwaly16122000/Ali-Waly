import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronRight, Download, Upload, CheckCircle2, Send, Award, Undo2, Pencil, Trash2, Save, Search,
  AlertTriangle, Clock, Paperclip, Users, PenLine, BarChart3, Check, EyeOff, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../lib/api';
import { useApi } from '../lib/useApi';
import { STATUS_META, TYPE_LABELS, dueInfo, fileSize, fmtDateTime, num, pctTone, timeAgo } from '../lib/format';
import {
  Alert, AttachmentLinks, Badge, Button, Card, CardHeader, ConfirmModal, EmptyState, ErrorState, Field, FileDrop, Input, Modal,
  PageLoader, Select, Spinner, Table, Td, Textarea, Th, cx,
} from '../components/ui';
import AssessmentForm from './course/AssessmentForm';
import LockNotice from '../components/LockNotice';

function Steps({ status }) {
  const steps = [
    { id: 'open', label: 'التصحيح', hint: 'المعيد يرصد الدرجات' },
    { id: 'submitted', label: 'مراجعة الدكتور', hint: 'بانتظار الاعتماد' },
    { id: 'published', label: 'منشورة للطلاب', hint: 'الطلاب يشوفوا درجاتهم' },
  ];
  const idx = steps.findIndex((s) => s.id === status);
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <div className={cx('size-8 shrink-0 rounded-full grid place-items-center text-sm font-bold',
            i < idx ? 'bg-emerald-500 text-white' : i === idx ? 'bg-brand-600 text-white ring-4 ring-brand-500/20' : 'bg-surface-2 text-muted border border-line')}>
            {i < idx ? <Check className="size-4" /> : i + 1}
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className={cx('text-sm font-bold truncate', i > idx && 'text-muted')}>{s.label}</p>
            <p className="text-xs text-muted truncate">{s.hint}</p>
          </div>
          {i < steps.length - 1 && <div className={cx('h-0.5 flex-1 rounded', i < idx ? 'bg-emerald-500' : 'bg-line')} />}
        </div>
      ))}
    </div>
  );
}

function Header({ a, courseId, children }) {
  const meta = STATUS_META[a.status];
  return (
    <>
      <Link to={`/courses/${courseId}?tab=assessments`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ChevronRight className="size-4" /> {a.course_name}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone="blue">{TYPE_LABELS[a.type]}</Badge>
            {a.my_role !== 'student' && <Badge tone={meta.tone} dot>{meta.label}</Badge>}
            <span className="text-sm text-muted ltr">{a.course_code}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">{a.title}</h1>
          <p className="text-muted mt-1">الدرجة العظمى {num(a.max_score)} {a.due_at && `· آخر موعد ${fmtDateTime(a.due_at)}`}</p>
        </div>
        {children}
      </div>
    </>
  );
}

function Instructions({ a }) {
  if (!a.description && !a.attachments?.length) return null;
  return (
    <Card className="p-5">
      <p className="font-bold mb-2">التعليمات</p>
      {a.description && <p className="whitespace-pre-line text-ink/85 leading-relaxed">{a.description}</p>}
      <AttachmentLinks attachments={a.attachments} className="mt-4" />
    </Card>
  );
}

// ───────────── Student ─────────────
function StudentView({ a, reload }) {
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const s = a.submission;
  const due = dueInfo(a.due_at);
  const deadline = !a.due_at || a.late_policy === 'allow' ? null
    : new Date(new Date(a.due_at).getTime() + (a.late_policy === 'grace' ? a.grace_hours * 3600_000 : 0));
  const closedByDeadline = !!deadline && new Date() > deadline;
  const canSubmit = a.accepts_submissions && a.status === 'open' && !s?.graded && !closedByDeadline;
  const published = a.status === 'published';

  const submit = async () => {
    if (!file) return toast.error('اختر ملف الحل أولاً');
    setSaving(true);
    try {
      const res = await api.post(`/assessments/${a.id}/submit`, toForm({ file, note }));
      toast.success(res.late ? 'تم التسليم (متأخر عن الموعد)' : 'تم تسليم الحل بنجاح ✓');
      setFile(null);
      setNote('');
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pct = published && s?.score !== null && s?.score !== undefined ? (s.score / a.max_score) * 100 : null;
  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Instructions a={a} />
        {a.accepts_submissions ? (
          <Card>
            <CardHeader icon={Upload} title="تسليم الحل" subtitle={canSubmit ? due.text : undefined}
              action={s?.submitted_at && <Badge tone="green"><CheckCircle2 className="size-3" /> تم التسليم</Badge>} />
            <div className="px-5 pb-5 space-y-4">
              {s?.submitted_at && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-4">
                  <Paperclip className="size-5 text-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <a href={`/api/submissions/${s.id}/file`} className="font-semibold hover:underline truncate block">{s.file_name}</a>
                    <p className="text-xs text-muted">{fileSize(s.file_size)} · سُلّم {fmtDateTime(s.submitted_at)}
                      {a.due_at && new Date(s.submitted_at) > new Date(a.due_at) && <span className="text-rose-600 font-semibold"> · متأخر</span>}</p>
                    {s.note && <p className="text-sm mt-1">ملاحظتك: {s.note}</p>}
                  </div>
                </div>
              )}
              {canSubmit ? (
                <>
                  {a.due_at && new Date() > new Date(a.due_at) && (
                    <Alert tone="amber" icon={AlertTriangle}>
                      انتهى الموعد المحدد، التسليم الآن هيتسجل كمتأخر{deadline ? ` — والتسليم هيقفل نهائياً ${fmtDateTime(deadline)}` : ''}.
                    </Alert>
                  )}
                  {a.due_at && new Date() <= new Date(a.due_at) && a.late_policy === 'closed' && (
                    <Alert tone="blue" icon={Clock}>التسليم بيقفل بالظبط عند الموعد ({fmtDateTime(a.due_at)}) — مفيش تسليم متأخر.</Alert>
                  )}
                  <FileDrop file={file} onChange={setFile} label={s?.submitted_at ? 'استبدال الملف بتسليم جديد' : 'اسحب ملف الحل هنا أو اضغط للاختيار'} hint="PDF مفضّل · حتى 20 ميجا" />
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة للمعيد (اختياري)" className="min-h-16" />
                  <Button onClick={submit} loading={saving} icon={Upload} size="lg" className="w-full">{s?.submitted_at ? 'إعادة التسليم' : 'تسليم الحل'}</Button>
                </>
              ) : !s?.submitted_at && (
                <p className="text-muted text-sm">{closedByDeadline || a.status !== 'open' ? 'انتهى التسليم لهذا التقييم.' : 'تم التصحيح.'}</p>
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-5"><p className="text-muted">هذا التقييم يتم داخل الكلية ولا يحتاج تسليم أونلاين. درجتك هتظهر هنا بعد اعتمادها.</p></Card>
        )}
      </div>
      <Card className="p-6 text-center h-fit">
        <p className="text-sm font-semibold text-muted">درجتك</p>
        {pct !== null ? (
          <>
            <div className="relative size-40 mx-auto my-4">
              <svg viewBox="0 0 36 36" className="size-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-line" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${pct} 100`}
                  className={{ green: 'stroke-emerald-500', blue: 'stroke-brand-500', amber: 'stroke-amber-500', red: 'stroke-rose-500' }[pctTone(pct)]} />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div><p className="text-4xl font-extrabold ltr">{num(s.score)}</p><p className="text-muted text-sm ltr">/ {num(a.max_score)}</p></div>
              </div>
            </div>
            {s.feedback && <div className="rounded-xl bg-surface-2 p-3 text-sm text-right"><p className="font-bold mb-1">تعليق المصحح</p>{s.feedback}</div>}
          </>
        ) : a.grades_lock ? (
          <div className="my-6"><LockNotice lock={a.grades_lock} compact /></div>
        ) : published ? (
          <p className="my-8 text-rose-600 font-semibold">لم تُرصد لك درجة</p>
        ) : (
          <div className="my-8">
            <Clock className="size-10 mx-auto text-muted mb-3" />
            <p className="font-semibold">{s?.graded ? 'تم التصحيح' : 'لم تُنشر بعد'}</p>
            <p className="text-sm text-muted mt-1">هيوصلك إشعار أول ما الدكتور يعتمد الدرجات</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ───────────── Staff ─────────────
const ACTION_LABELS = { grade: 'تعديل درجة', submit: 'رفع للدكتور', publish: 'اعتماد ونشر', return: 'إرجاع / إلغاء نشر' };

function HistoryModal({ assessment, student, onClose }) {
  const { data } = useApi(`/assessments/${assessment.id}/history${student ? `?student_id=${student.student_id}` : ''}`);
  return (
    <Modal open onClose={onClose} size="lg" title="سجل التعديلات" subtitle={student ? `${student.name} · ${student.username}` : assessment.title}>
      {!data ? <div className="grid place-items-center py-8"><Spinner /></div> : !data.length ? <EmptyState icon={History} title="لا توجد تعديلات مسجلة" /> : (
        <ol className="relative border-s-2 border-line ms-2 space-y-5">
          {data.map((h) => (
            <li key={h.id} className="ms-5">
              <span className={cx('absolute -start-[9px] mt-1.5 size-4 rounded-full ring-4 ring-surface',
                h.action === 'grade' ? 'bg-brand-500' : h.action === 'publish' ? 'bg-emerald-500' : h.action === 'return' ? 'bg-rose-500' : 'bg-amber-500')} />
              <p className="text-sm font-bold">
                {ACTION_LABELS[h.action]}
                {h.action === 'grade' && !student && <span className="font-normal text-muted"> · {h.student_name}</span>}
              </p>
              {h.action === 'grade' && (
                <p className="text-sm mt-0.5">
                  <span className="ltr font-bold">{h.old_score ?? '—'}</span> ← <span className="ltr font-bold text-brand-600 dark:text-brand-300">{h.new_score ?? '—'}</span>
                  {h.old_feedback !== h.new_feedback && h.new_feedback && <span className="text-muted"> · تعليق: {h.new_feedback}</span>}
                </p>
              )}
              {h.reason && <p className="text-sm text-muted mt-0.5">السبب: {h.reason}</p>}
              <p className="text-xs text-muted mt-1">{h.changed_by_role === 'doctor' ? 'د.' : h.changed_by_role === 'ta' ? 'م.' : ''} {h.changed_by_name ?? 'غير معروف'} · {fmtDateTime(h.changed_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function GradingTable({ a, editable, onSaved }) {
  const [rows, setRows] = useState(a.roster);
  const [dirty, setDirty] = useState({});
  const [filter, setFilter] = useState('all');
  const [section, setSection] = useState('');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState('section');
  const [historyFor, setHistoryFor] = useState(null); // student row, or 'all'
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState('');
  const inputs = useRef({});

  useEffect(() => { setRows(a.roster); setDirty({}); }, [a.roster]);

  const sections = useMemo(() => [...new Set(a.roster.map((r) => r.section).filter(Boolean))], [a.roster]);
  const sorted = useMemo(() => [...rows].sort((x, y) => {
    if (sortBy === 'code') return x.username.localeCompare(y.username, 'en', { numeric: true });
    if (sortBy === 'name') return x.name.localeCompare(y.name, 'ar');
    return (x.section || '').localeCompare(y.section || '', 'ar', { numeric: true }) || x.name.localeCompare(y.name, 'ar');
  }), [rows, sortBy]);
  const visible = sorted.filter((r) => {
    if (section && r.section !== section) return false;
    if (q && !r.name.includes(q) && !r.username.includes(q)) return false;
    if (filter === 'todo') return r.submitted_at && (r.score === null || r.score === '');
    if (filter === 'graded') return r.score !== null && r.score !== '';
    if (filter === 'missing') return !r.submitted_at;
    return true;
  });

  const update = (studentId, patch) => {
    setRows((rs) => rs.map((r) => (r.student_id === studentId ? { ...r, ...patch } : r)));
    setDirty((d) => ({ ...d, [studentId]: true }));
  };

  const invalid = rows.filter((r) => dirty[r.student_id] && r.score !== null && r.score !== '' && (Number(r.score) < 0 || Number(r.score) > a.max_score || Number.isNaN(Number(r.score))));

  const save = async (withReason) => {
    if (invalid.length) return toast.error(`درجة غير صالحة لـ ${invalid[0].name} (من 0 إلى ${a.max_score})`);
    if (a.status === 'published' && withReason === undefined) return setAskReason(true);
    const grades = rows.filter((r) => dirty[r.student_id]).map((r) => ({
      student_id: r.student_id, score: r.score === null || r.score === '' ? null : Number(r.score), feedback: r.feedback || null,
    }));
    if (!grades.length) return;
    setSaving(true);
    try {
      await api.put(`/assessments/${a.id}/grades`, { grades, ...(withReason ? { reason: withReason } : {}) });
      toast.success(`تم حفظ ${grades.length} درجة`);
      setDirty({});
      setAskReason(false);
      setReason('');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const zeroMissing = () => {
    const ids = rows.filter((r) => !r.submitted_at && (r.score === null || r.score === '')).map((r) => r.student_id);
    if (!ids.length) return toast.info('كل الطلاب لهم درجات بالفعل');
    setRows((rs) => rs.map((r) => (ids.includes(r.student_id) ? { ...r, score: 0 } : r)));
    setDirty((d) => ({ ...d, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    toast.info(`تم وضع صفر لـ ${ids.length} طالب لم يسلّم — اضغط حفظ للتأكيد`);
  };

  const focusNext = (index) => {
    const next = visible[index + 1];
    if (next) inputs.current[next.student_id]?.focus();
  };

  const dirtyCount = Object.keys(dirty).length;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pr-9" placeholder="ابحث بالاسم أو الكود" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {sections.length > 1 && (
          <Select className="w-36" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">كل السكاشن</option>
            {sections.map((s) => <option key={s}>{s}</option>)}
          </Select>
        )}
        <Select className="w-44" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل الطلاب ({rows.length})</option>
          {a.accepts_submissions ? <option value="todo">سلّموا ولم يُصحَّحوا</option> : null}
          <option value="graded">تم رصد درجتهم</option>
          {a.accepts_submissions ? <option value="missing">لم يسلّموا</option> : null}
        </Select>
        <Select className="w-40" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="الترتيب">
          <option value="section">ترتيب: السكشن ثم الاسم</option>
          <option value="name">ترتيب: الاسم</option>
          <option value="code">ترتيب: الكود</option>
        </Select>
        {editable && a.accepts_submissions ? <Button variant="ghost" size="sm" onClick={zeroMissing}>صفر لمن لم يسلّم</Button> : null}
        <Button variant="ghost" size="sm" icon={History} onClick={() => setHistoryFor('all')}>سجل التعديلات</Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th className="w-10">#</Th>
            <Th>الطالب</Th>
            <Th>السكشن</Th>
            {a.accepts_submissions ? <Th>التسليم</Th> : null}
            <Th className="w-32">الدرجة / {num(a.max_score)}</Th>
            <Th>تعليق</Th>
            <Th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => {
            const late = r.submitted_at && a.due_at && new Date(r.submitted_at) > new Date(a.due_at);
            const bad = invalid.some((x) => x.student_id === r.student_id);
            return (
              <tr key={r.student_id} className={cx(dirty[r.student_id] && 'bg-amber-50/50 dark:bg-amber-500/5')}>
                <Td className="text-muted">{i + 1}</Td>
                <Td>
                  <p className="font-semibold whitespace-nowrap">{r.name}</p>
                  <p className="text-xs text-muted ltr text-right">{r.username}</p>
                </Td>
                <Td className="text-muted whitespace-nowrap">{r.section || '—'}</Td>
                {a.accepts_submissions ? (
                  <Td>
                    {r.submitted_at ? (
                      <div className="min-w-40">
                        <a href={`/api/submissions/${r.submission_id}/file`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 dark:text-brand-300 hover:underline">
                          <Download className="size-3.5" /> <span className="truncate max-w-40">{r.file_name}</span>
                        </a>
                        <p className="text-xs text-muted mt-0.5">{timeAgo(r.submitted_at)} {late && <span className="text-rose-600 font-semibold">· متأخر</span>}</p>
                        {r.note && <p className="text-xs text-muted mt-0.5 line-clamp-1" title={r.note}>💬 {r.note}</p>}
                      </div>
                    ) : <Badge tone="slate">لم يسلّم</Badge>}
                  </Td>
                ) : null}
                <Td>
                  <Input
                    ref={(el) => { inputs.current[r.student_id] = el; }}
                    type="number" step="0.25" min="0" max={a.max_score} dir="ltr" disabled={!editable}
                    className={cx('h-9 w-24 text-center font-bold', bad && 'border-rose-500 ring-2 ring-rose-500/30')}
                    value={r.score ?? ''} placeholder="—"
                    onChange={(e) => update(r.student_id, { score: e.target.value === '' ? null : e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(i); } }}
                  />
                </Td>
                <Td>
                  <Input className="h-9 min-w-40" disabled={!editable} value={r.feedback ?? ''} placeholder="اختياري"
                    onChange={(e) => update(r.student_id, { feedback: e.target.value })} />
                </Td>
                <Td>
                  {r.graded_at && (
                    <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2" title="سجل تعديلات الطالب" onClick={() => setHistoryFor(r)}>
                      <History className="size-4" />
                    </button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {!visible.length && <EmptyState title="لا يوجد طلاب مطابقين" />}
      {editable && (
        <div className={cx('sticky bottom-20 lg:bottom-0 flex items-center justify-between gap-3 p-4 border-t border-line bg-surface/95 backdrop-blur transition', !dirtyCount && 'opacity-70')}>
          <p className="text-sm text-muted">{dirtyCount ? `${dirtyCount} تعديل غير محفوظ` : 'اكتب الدرجة واضغط Enter للانتقال للطالب التالي'}</p>
          <Button icon={Save} onClick={() => save()} loading={saving} disabled={!dirtyCount}>حفظ الدرجات</Button>
        </div>
      )}
      {historyFor && <HistoryModal assessment={a} student={historyFor === 'all' ? null : historyFor} onClose={() => setHistoryFor(null)} />}
      <Modal open={askReason} onClose={() => setAskReason(false)} title="سبب تعديل درجة منشورة"
        subtitle="الطالب هيوصله إشعار بالتعديل، والسبب هيتسجل في سجل التعديلات"
        footer={<><Button variant="secondary" onClick={() => setAskReason(false)}>إلغاء</Button><Button loading={saving} disabled={reason.trim().length < 3} onClick={() => save(reason.trim())}>حفظ التعديل</Button></>}>
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: مراجعة الورقة بعد التظلم / خطأ في جمع الدرجات" />
      </Modal>
    </Card>
  );
}

function StaffView({ a, reload, courseId }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [returnNote, setReturnNote] = useState('');
  const [busy, setBusy] = useState(false);
  const isDoctor = a.my_role === 'doctor' || a.my_role === 'admin';
  const readOnly = a.my_role === 'observer';
  const editable = !readOnly && (isDoctor || a.status === 'open');

  const graded = a.roster.filter((r) => r.score !== null);
  const submitted = a.roster.filter((r) => r.submitted_at);
  const ungraded = submitted.filter((r) => r.score === null);
  const scores = graded.map((r) => r.score);
  const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;

  const act = async (kind) => {
    setBusy(true);
    try {
      if (kind === 'submit') await api.post(`/assessments/${a.id}/submit-to-doctor`);
      if (kind === 'publish') await api.post(`/assessments/${a.id}/publish`);
      if (kind === 'return') await api.post(`/assessments/${a.id}/return`, { note: returnNote });
      if (kind === 'delete') {
        await api.del(`/assessments/${a.id}`);
        toast.success('تم الحذف');
        return navigate(`/courses/${courseId}?tab=assessments`);
      }
      toast.success({ submit: 'تم رفع الدرجات للدكتور', publish: 'تم اعتماد ونشر الدرجات للطلاب 🎉', return: 'تمت الإعادة للمعيد' }[kind]);
      setConfirm(null);
      setReturnNote('');
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-5 mb-6">
        <Steps status={a.status} />
        {a.status === 'open' && a.review_note && (
          <Alert tone="red" icon={Undo2} title="الدكتور رجّع الدرجات للمراجعة" className="mt-4">{a.review_note}</Alert>
        )}
        {a.status === 'submitted' && (
          <Alert tone="amber" icon={Clock} className="mt-4">رفعها {a.submitted_by_name ?? 'المعيد'} {timeAgo(a.submitted_at)}. {isDoctor ? 'راجع الدرجات والإحصائيات ثم اعتمدها.' : 'التعديل متاح فقط لو الدكتور رجّعها.'}</Alert>
        )}
        <div className={cx('flex flex-wrap gap-2 mt-4', readOnly && 'hidden')}>
          {a.status === 'open' && !isDoctor && (
            <Button icon={Send} onClick={() => setConfirm('submit')}>خلصت التصحيح — ارفع للدكتور</Button>
          )}
          {isDoctor && a.status !== 'published' && (
            <Button variant="success" icon={Award} onClick={() => setConfirm('publish')}>اعتماد ونشر للطلاب</Button>
          )}
          {isDoctor && a.status === 'submitted' && (
            <Button variant="secondary" icon={Undo2} onClick={() => setConfirm('return')}>إرجاع للمعيد</Button>
          )}
          {isDoctor && a.status === 'published' && (
            <Button variant="secondary" icon={EyeOff} onClick={() => setConfirm('return')}>إلغاء النشر وإعادة فتح التصحيح</Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" icon={BarChart3} to={`/courses/${courseId}?tab=stats`}>إحصائيات المادة</Button>
          <Button variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>تعديل</Button>
          {(isDoctor || a.status === 'open') && <Button variant="ghost" icon={Trash2} className="hover:text-rose-600" onClick={() => setConfirm('delete')}>حذف</Button>}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { icon: Users, label: 'الطلاب', value: a.roster.length },
          ...(a.accepts_submissions ? [{ icon: Upload, label: 'سلّموا', value: submitted.length }] : []),
          { icon: PenLine, label: 'تم تصحيحهم', value: graded.length },
          ...(a.accepts_submissions ? [{ icon: AlertTriangle, label: 'بانتظار التصحيح', value: ungraded.length, warn: ungraded.length > 0 }] : []),
          { icon: BarChart3, label: 'المتوسط', value: avg === null ? '—' : `${num(avg, 1)} / ${num(a.max_score)}` },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted flex items-center gap-1.5"><s.icon className="size-3.5" /> {s.label}</p>
            <p className={cx('text-2xl font-extrabold mt-1 ltr text-right', s.warn && 'text-amber-600')}>{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="mb-6"><Instructions a={a} /></div>
      <GradingTable a={a} editable={editable} onSaved={() => reload(true)} />

      {editing && <AssessmentForm open initial={a} onClose={() => setEditing(false)} onSaved={() => reload(true)} />}
      <ConfirmModal open={confirm === 'submit'} onClose={() => setConfirm(null)} onConfirm={() => act('submit')} loading={busy} tone="primary"
        title="رفع الدرجات للدكتور" confirmLabel="رفع للدكتور"
        message={`تم تصحيح ${graded.length} من ${a.roster.length} طالب${ungraded.length ? ` (${ungraded.length} سلّموا ولسه ما اتصححوش)` : ''}. بعد الرفع مش هتقدر تعدّل إلا لو الدكتور رجّعها.`} />
      <ConfirmModal open={confirm === 'publish'} onClose={() => setConfirm(null)} onConfirm={() => act('publish')} loading={busy} tone="success"
        title="اعتماد ونشر الدرجات" confirmLabel="اعتماد ونشر"
        message={`هيتم نشر درجات ${graded.length} طالب وإرسال إشعار لكل طلاب المادة. المتوسط الحالي ${avg === null ? '—' : num(avg, 1)} من ${num(a.max_score)}.`} />
      <ConfirmModal open={confirm === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => act('delete')} loading={busy}
        title="حذف التقييم" confirmLabel="حذف نهائياً" message="هيتم حذف التقييم وكل التسليمات والدرجات المرتبطة بيه. لا يمكن التراجع." />
      <Modal open={confirm === 'return'} onClose={() => setConfirm(null)} title={a.status === 'published' ? 'إلغاء النشر' : 'إرجاع الدرجات للمعيد'}
        subtitle="هيوصل إشعار للمعيدين بالملاحظة"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>إلغاء</Button><Button variant="danger" loading={busy} onClick={() => act('return')}>إرجاع</Button></>}>
        <Field label="ملاحظة للمعيد">{(id) => <Textarea id={id} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="مثلاً: راجع درجات سكشن 2، في درجات أعلى من المتوقع" />}</Field>
      </Modal>
    </>
  );
}

export default function AssessmentDetail() {
  const { courseId, id } = useParams();
  const { data: a, error, loading, reload } = useApi(`/assessments/${id}`);
  if (loading && !a) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <Header a={a} courseId={courseId} />
      {a.my_role === 'student' ? <StudentView a={a} reload={reload} /> : <StaffView a={a} reload={reload} courseId={courseId} />}
    </>
  );
}

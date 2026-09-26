import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, CheckCircle2, Clock, Upload, ChevronLeft, PenLine, Award } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { STATUS_META, TYPE_LABELS, dueInfo, fmtDateTime, num, pctTone } from '../../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, PageLoader, Progress, Segmented, cx } from '../../components/ui';
import AssessmentForm from './AssessmentForm';

function StudentRow({ a, courseId }) {
  const due = dueInfo(a.due_at);
  const submitted = !!a.submitted_at;
  const published = a.status === 'published';
  let state;
  if (published) {
    state = a.score !== null && a.score !== undefined
      ? <Badge tone={pctTone((a.score / a.max_score) * 100)} className="text-sm px-3"><Award className="size-3.5" /> <span className="ltr">{num(a.score)} / {num(a.max_score)}</span></Badge>
      : <Badge tone="red">لم يُرصد</Badge>;
  } else if (submitted) {
    state = <Badge tone="green"><CheckCircle2 className="size-3" /> تم التسليم</Badge>;
  } else if (a.accepts_submissions && a.status === 'open') {
    state = <Badge tone={due.tone}><Clock className="size-3" /> {due.text}</Badge>;
  } else {
    state = <Badge tone="slate">بانتظار الدرجات</Badge>;
  }
  return (
    <Link to={`/courses/${courseId}/assessments/${a.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2 border-b border-line last:border-0">
      <div className={cx('size-11 rounded-xl grid place-items-center shrink-0', published ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300')}>
        {published ? <Award className="size-5" /> : <FileText className="size-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold truncate">{a.title}</p>
        <p className="text-xs text-muted mt-0.5">{TYPE_LABELS[a.type]} · من {num(a.max_score)} {a.due_at && `· ${fmtDateTime(a.due_at)}`}</p>
      </div>
      {state}
      <ChevronLeft className="size-4 text-muted hidden sm:block" />
    </Link>
  );
}

function StaffRow({ a, courseId }) {
  const meta = STATUS_META[a.status];
  return (
    <Link to={`/courses/${courseId}/assessments/${a.id}`} className="grid sm:grid-cols-[1fr_14rem_auto] items-center gap-4 px-5 py-4 hover:bg-surface-2 border-b border-line last:border-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="size-11 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300 grid place-items-center shrink-0"><FileText className="size-5" /></div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold truncate">{a.title}</p>
            <Badge tone={meta.tone} dot>{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted mt-0.5">{TYPE_LABELS[a.type]} · من {num(a.max_score)} {a.due_at && `· التسليم ${fmtDateTime(a.due_at)}`} {a.avg_score !== null && `· المتوسط ${num(a.avg_score, 1)}`}</p>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted mb-1">
          {a.accepts_submissions ? <span><Upload className="size-3 inline" /> {a.submitted_count} سلّموا</span> : <span>بدون تسليم أونلاين</span>}
          <span><PenLine className="size-3 inline" /> {a.graded_count}/{a.students_count} مصحح</span>
        </div>
        <Progress value={a.graded_count} max={a.students_count} tone={a.graded_count === a.students_count ? 'green' : 'blue'} />
      </div>
      <ChevronLeft className="size-4 text-muted hidden sm:block" />
    </Link>
  );
}

export default function Assessments({ course }) {
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/assessments`);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();
  const staff = ['doctor', 'ta', 'admin'].includes(course.my_role);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const filters = staff
    ? [{ value: 'all', label: 'الكل' }, { value: 'open', label: 'مفتوح' }, { value: 'submitted', label: 'للاعتماد' }, { value: 'published', label: 'منشور' }]
    : [{ value: 'all', label: 'الكل' }, { value: 'todo', label: 'مطلوب' }, { value: 'published', label: 'بدرجات' }];
  const list = data.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'todo') return a.status === 'open' && a.accepts_submissions && !a.submitted_at;
    return a.status === filter;
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented options={filters} value={filter} onChange={setFilter} />
        {staff && <Button icon={Plus} onClick={() => setCreating(true)}>تقييم جديد</Button>}
      </div>
      <Card className="overflow-hidden">
        {!list.length ? <EmptyState icon={FileText} title="لا توجد تقييمات" description={staff ? 'أضف أول شيت للمادة' : undefined} />
          : list.map((a) => (staff ? <StaffRow key={a.id} a={a} courseId={course.id} /> : <StudentRow key={a.id} a={a} courseId={course.id} />))}
      </Card>
      {creating && (
        <AssessmentForm open onClose={() => setCreating(false)} courseId={course.id}
          onSaved={(res) => navigate(`/courses/${course.id}/assessments/${res.id}`)} />
      )}
    </>
  );
}

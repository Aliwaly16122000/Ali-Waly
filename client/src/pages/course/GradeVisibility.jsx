import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button, Card, Input, cx } from '../../components/ui';

/** Doctor/admin switch: show grades to students, hide them, or hide until a date. */
export default function GradeVisibility({ course, onChanged }) {
  const [hidden, setHidden] = useState(!!course.grades_hidden);
  const [until, setUntil] = useState(course.grades_visible_from || '');
  const [saving, setSaving] = useState(false);
  const save = async (h = hidden, u = until) => {
    setSaving(true);
    try {
      await api.put(`/courses/${course.id}/grade-visibility`, { hidden: h, visible_from: h && u ? u : null });
      toast.success(h ? (u ? `الدرجات مخفية لحد ${u}` : 'الدرجات مخفية عن الطلاب') : 'الدرجات ظاهرة للطلاب وتم إبلاغهم');
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className={cx('p-4 mb-4 flex flex-wrap items-center gap-3', hidden && 'border-amber-300 dark:border-amber-500/40')}>
      {hidden ? <EyeOff className="size-5 text-amber-600" /> : <Eye className="size-5 text-emerald-600" />}
      <div className="flex-1 min-w-48">
        <p className="font-bold">{hidden ? 'الدرجات مخفية عن الطلاب' : 'الدرجات المعتمدة ظاهرة للطلاب'}</p>
        <p className="text-xs text-muted">{hidden ? 'بترصد وتعتمد عادي، والطلاب مش بيشوفوا لحد ما تظهرها' : 'تقدر تخفيها لحد آخر الترم مثلاً'}</p>
      </div>
      {hidden && (
        <label className="flex items-center gap-2 text-sm">تظهر تلقائياً يوم
          <Input type="date" dir="ltr" className="w-40 h-9" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      {hidden ? (
        <>
          <Button size="sm" variant="secondary" loading={saving} onClick={() => save(true, until)}>حفظ الموعد</Button>
          <Button size="sm" variant="success" icon={Eye} loading={saving} onClick={() => { setHidden(false); save(false, ''); }}>إظهار الآن</Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" icon={EyeOff} loading={saving} onClick={() => { setHidden(true); save(true, until); }}>إخفاء الدرجات</Button>
      )}
    </Card>
  );
}

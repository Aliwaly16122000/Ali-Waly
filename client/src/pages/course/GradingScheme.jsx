import { useState } from 'react';
import { Plus, Trash2, Wand2, CalendarCheck, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { TYPE_LABELS, num } from '../../lib/format';
import { Alert, Button, Field, Input, Modal, Select, cx } from '../../components/ui';

const DEFAULT_WEIGHTS = { sheet: 10, quiz: 5, lab: 5, midterm: 20, project: 10, final: 50, other: 5 };
const GROUP_NAMES = { sheet: 'الشيتات', quiz: 'الكويزات', lab: 'المعامل', midterm: 'الميدترم', project: 'المشروع', final: 'الامتحان النهائي', other: 'أخرى' };
const newKey = () => Math.random().toString(36).slice(2, 8);

/** Suggests one component per assessment type — a sensible starting point. */
function suggest(assessments) {
  const byType = {};
  for (const a of assessments) (byType[a.type] ||= []).push(a.id);
  return {
    components: Object.entries(byType).map(([type, ids]) => ({
      key: type, name: GROUP_NAMES[type], weight: DEFAULT_WEIGHTS[type], assessment_ids: ids, best_of: null,
    })),
    attendance: { enabled: true, weight: 10 },
  };
}

/**
 * Editor for "توزيع الدرجات": the doctor/TA decides which assessments make up each part of
 * the grade and how many marks each part is worth. The system scales and sums automatically.
 */
export default function GradingScheme({ open, onClose, courseId, assessments, scheme: initial, onSaved }) {
  const [scheme, setScheme] = useState(() => initial ?? suggest(assessments));
  const [saving, setSaving] = useState(false);

  const used = new Map();
  scheme.components.forEach((c) => c.assessment_ids.forEach((id) => used.set(id, c.key)));
  const unused = assessments.filter((a) => !used.has(a.id));
  const total = scheme.components.reduce((s, c) => s + (Number(c.weight) || 0), 0) + (scheme.attendance.enabled ? Number(scheme.attendance.weight) || 0 : 0);

  const updateComp = (key, patch) => setScheme((s) => ({ ...s, components: s.components.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const toggle = (comp, id) => {
    setScheme((s) => ({
      ...s,
      components: s.components.map((c) => {
        if (c.key === comp.key) {
          const has = c.assessment_ids.includes(id);
          const ids = has ? c.assessment_ids.filter((x) => x !== id) : [...c.assessment_ids, id];
          return { ...c, assessment_ids: ids, best_of: c.best_of && c.best_of > ids.length ? null : c.best_of };
        }
        return { ...c, assessment_ids: c.assessment_ids.filter((x) => x !== id) };
      }),
    }));
  };

  const save = async (value) => {
    setSaving(true);
    try {
      const payload = value === null ? null : {
        components: value.components.filter((c) => c.assessment_ids.length).map((c) => ({
          ...c, weight: Number(c.weight) || 0, best_of: c.best_of ? Number(c.best_of) : null,
        })),
        attendance: { enabled: value.attendance.enabled, weight: Number(value.attendance.weight) || 0 },
      };
      await api.put(`/courses/${courseId}/grading-scheme`, { scheme: payload });
      toast.success(value === null ? 'تم إلغاء توزيع الدرجات' : 'تم حفظ توزيع الدرجات — المجموع اتحسب تلقائياً');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title="توزيع الدرجات"
      subtitle="حدد كل بند بياخد كام درجة ومحسوب من أنهي تقييمات — المجموع بيتحسب تلقائياً"
      footer={<>
        {initial && <Button variant="ghost" className="me-auto hover:text-rose-600" onClick={() => save(null)}>إلغاء التوزيع</Button>}
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button loading={saving} onClick={() => save(scheme)}>حفظ</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 px-4 py-2 font-bold">
          <Scale className="size-5" /> الإجمالي: <span className="ltr text-xl">{num(total)}</span> درجة
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" icon={Wand2} onClick={() => setScheme(suggest(assessments))}>اقتراح تلقائي حسب النوع</Button>
        <Button variant="soft" size="sm" icon={Plus} onClick={() => setScheme((s) => ({ ...s, components: [...s.components, { key: newKey(), name: 'بند جديد', weight: 5, assessment_ids: [], best_of: null }] }))}>إضافة بند</Button>
      </div>

      <div className="space-y-4">
        {scheme.components.map((c) => (
          <div key={c.key} className="rounded-2xl border border-line p-4">
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_8rem_10rem_auto] gap-3 items-end">
              <Field label="اسم البند" className="col-span-2 sm:col-span-1">{(id) => <Input id={id} value={c.name} onChange={(e) => updateComp(c.key, { name: e.target.value })} />}</Field>
              <Field label="الدرجة">{(id) => <Input id={id} type="number" min="0" step="0.5" dir="ltr" value={c.weight} onChange={(e) => updateComp(c.key, { weight: e.target.value })} />}</Field>
              <Field label="طريقة الحساب">
                {(id) => (
                  <Select id={id} value={c.best_of ?? ''} onChange={(e) => updateComp(c.key, { best_of: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">كل التقييمات</option>
                    {c.assessment_ids.slice(1).map((_, i) => <option key={i} value={i + 1}>أفضل {i + 1} فقط</option>)}
                  </Select>
                )}
              </Field>
              <Button variant="ghost" icon={Trash2} className="hover:text-rose-600" aria-label="حذف البند"
                onClick={() => setScheme((s) => ({ ...s, components: s.components.filter((x) => x.key !== c.key) }))} />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {assessments.map((a) => {
                const mine = c.assessment_ids.includes(a.id);
                const elsewhere = !mine && used.has(a.id);
                return (
                  <button key={a.id} type="button" onClick={() => toggle(c, a.id)}
                    className={cx('rounded-full border px-3 py-1 text-sm font-semibold transition',
                      mine ? 'bg-brand-600 border-brand-600 text-white' : elsewhere ? 'border-dashed border-line text-muted/60' : 'border-line text-muted hover:border-brand-300')}
                    title={elsewhere ? 'مستخدم في بند آخر — اضغط لنقله هنا' : undefined}>
                    {a.title} <span className="opacity-70 ltr">/{num(a.max_score)}</span>
                  </button>
                );
              })}
            </div>
            {c.assessment_ids.length > 0 && (
              <p className="text-xs text-muted mt-2">
                = (مجموع درجات {c.best_of ? `أفضل ${c.best_of}` : 'التقييمات المختارة'} ÷ مجموع درجاتها العظمى) × {num(Number(c.weight) || 0)}
              </p>
            )}
          </div>
        ))}

        <div className={cx('rounded-2xl border p-4 flex flex-wrap items-center gap-4', scheme.attendance.enabled ? 'border-emerald-300 dark:border-emerald-500/40' : 'border-line')}>
          <label className="flex items-center gap-3 flex-1 min-w-56 cursor-pointer">
            <input type="checkbox" className="size-5 accent-emerald-600" checked={scheme.attendance.enabled}
              onChange={(e) => setScheme((s) => ({ ...s, attendance: { ...s.attendance, enabled: e.target.checked } }))} />
            <CalendarCheck className="size-5 text-emerald-600" />
            <div><p className="font-bold">درجة الحضور</p><p className="text-xs text-muted">نسبة حضور الطالب × الدرجة (حضر 9 من 10 محاضرات = 90%)</p></div>
          </label>
          {scheme.attendance.enabled && (
            <div className="w-32"><Input type="number" min="0" step="0.5" dir="ltr" value={scheme.attendance.weight}
              onChange={(e) => setScheme((s) => ({ ...s, attendance: { ...s.attendance, weight: e.target.value } }))} /></div>
          )}
        </div>

        {unused.length > 0 && (
          <Alert tone="amber" title="تقييمات غير محسوبة في المجموع">{unused.map((a) => a.title).join('، ')}</Alert>
        )}
      </div>
    </Modal>
  );
}

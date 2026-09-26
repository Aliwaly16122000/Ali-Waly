import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2, CalendarRange, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { LEVEL_LABELS, clock12 } from '../lib/format';
import { Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, PageLoader, Progress, Select, Textarea, cx } from '../components/ui';

const TYPES = {
  lecture: { label: 'محاضرة', dot: 'bg-brand-500', chip: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  section: { label: 'سكشن', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  lab: { label: 'معمل', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  deadline: { label: 'تسليم', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  exam: { label: 'امتحان', dot: 'bg-red-600', chip: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200' },
  holiday: { label: 'إجازة', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  event: { label: 'حدث', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
};
const WEEK = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const hijriDay = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'short' });

/** Month grid starting on Saturday (Egyptian academic week). */
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 1) % 7; // Saturday = 0
  const start = new Date(year, month, 1 - offset);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return days;
}

function EventForm({ onClose, onSaved, date }) {
  const { data: departments } = useApi('/admin/departments');
  const [form, setForm] = useState({ title: '', kind: 'holiday', start_date: date, end_date: date, department_id: '', level: '', notes: '', notify: true });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/calendar/events', {
        ...form, department_id: form.department_id ? Number(form.department_id) : null, level: form.level === '' ? null : Number(form.level), notes: form.notes || null,
      });
      toast.success('تمت الإضافة للتقويم');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="إضافة للتقويم الأكاديمي" subtitle="الإجازات بتلغي تذكيرات المحاضرات والحضور في الأيام دي تلقائياً"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="ev" type="submit" loading={saving}>إضافة</Button></>}>
      <form id="ev" onSubmit={save} className="grid sm:grid-cols-2 gap-4">
        <Field label="العنوان" className="sm:col-span-2">{(id) => <Input id={id} value={form.title} onChange={set('title')} required placeholder="إجازة 6 أكتوبر" />}</Field>
        <Field label="النوع">{(id) => <Select id={id} value={form.kind} onChange={set('kind')}><option value="holiday">إجازة (مفيش محاضرات)</option><option value="exam">امتحانات</option><option value="event">حدث / نشاط</option></Select>}</Field>
        <div />
        <Field label="من">{(id) => <Input id={id} type="date" dir="ltr" value={form.start_date} onChange={set('start_date')} required />}</Field>
        <Field label="إلى">{(id) => <Input id={id} type="date" dir="ltr" value={form.end_date} onChange={set('end_date')} required />}</Field>
        <Field label="القسم" hint="فارغ = الكلية كلها">{(id) => <Select id={id} value={form.department_id} onChange={set('department_id')}><option value="">كل الأقسام</option>{(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="الفرقة">{(id) => <Select id={id} value={form.level} onChange={set('level')}><option value="">كل الفرق</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</Select>}</Field>
        <Field label="ملاحظات" className="sm:col-span-2">{(id) => <Textarea id={id} className="min-h-16" value={form.notes} onChange={set('notes')} />}</Field>
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" className="size-4 accent-brand-600" checked={form.notify} onChange={set('notify')} /> إرسال إشعار للطلاب وهيئة التدريس</label>
      </form>
    </Modal>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const today = ymd(new Date());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const days = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const { data, loading, reload } = useApi(`/calendar?from=${ymd(days[0])}&to=${ymd(days[41])}`);

  const byDay = useMemo(() => {
    const map = new Map();
    const push = (d, item) => { if (!map.has(d)) map.set(d, []); map.get(d).push(item); };
    for (const it of data?.items || []) {
      if (it.start) {
        for (let d = new Date(`${it.start}T12:00:00`); ymd(d) <= it.end; d.setDate(d.getDate() + 1)) push(ymd(d), it);
      } else if (it.at) {
        push(ymd(new Date(it.at)), { ...it, start_time: new Date(it.at).toTimeString().slice(0, 5) });
      } else push(it.date, it);
    }
    for (const list of map.values()) list.sort((a, b) => (a.start ? -1 : 0) - (b.start ? -1 : 0) || (a.start_time || '').localeCompare(b.start_time || ''));
    return map;
  }, [data]);

  const move = (n) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const term = data?.term;
  const dayItems = byDay.get(selected) || [];

  return (
    <>
      <PageHeader title="التقويم" subtitle="المحاضرات والسكاشن ومواعيد التسليم والامتحانات والإجازات"
        actions={user.role === 'admin' && <Button icon={Plus} onClick={() => setAdding(true)}>إجازة / امتحانات / حدث</Button>} />

      {term?.start_date && (
        <Card className="p-4 mb-6 flex flex-wrap items-center gap-4">
          <CalendarRange className="size-6 text-brand-500" />
          <div className="flex-1 min-w-48">
            <p className="font-bold">{term.status === 'running' ? `الأسبوع ${term.week} من ${term.weeks}` : term.status === 'upcoming' ? 'الترم لسه مبدأش' : 'الترم خلص'}</p>
            <p className="text-xs text-muted ltr text-right">{term.start_date} ← {term.end_date}</p>
          </div>
          {term.status === 'running' && <div className="w-full sm:w-72"><Progress value={term.week} max={term.weeks} /><p className="text-xs text-muted mt-1">فاضل {term.days_left} يوم على نهاية الترم</p></div>}
        </Card>
      )}

      <div className="grid lg:grid-cols-[1fr_22rem] gap-6">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <button className="p-2 rounded-lg hover:bg-surface-2" onClick={() => move(-1)} aria-label="الشهر السابق"><ChevronRight className="size-5" /></button>
            <div className="text-center">
              <p className="font-extrabold text-lg">{monthFmt.format(new Date(cursor.y, cursor.m, 1))}</p>
              <button className="text-xs text-brand-600 font-semibold" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSelected(today); }}>النهارده</button>
            </div>
            <button className="p-2 rounded-lg hover:bg-surface-2" onClick={() => move(1)} aria-label="الشهر التالي"><ChevronLeft className="size-5" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-bold text-muted border-b border-line">
            {WEEK.map((w) => <div key={w} className="py-2"><span className="hidden sm:inline">{w}</span><span className="sm:hidden">{w.slice(0, 2)}</span></div>)}
          </div>
          {loading && !data ? <PageLoader /> : (
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const key = ymd(d);
                const items = byDay.get(key) || [];
                const inMonth = d.getMonth() === cursor.m;
                const holiday = items.find((i) => i.type === 'holiday');
                return (
                  <button key={key} onClick={() => setSelected(key)}
                    className={cx('min-h-16 sm:min-h-24 border-b border-l border-line p-1 sm:p-1.5 text-right align-top flex flex-col gap-0.5 transition-colors',
                      !inMonth && 'opacity-40', selected === key ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-surface-2', holiday && 'bg-emerald-50/60 dark:bg-emerald-500/5')}>
                    <span className={cx('text-xs sm:text-sm font-bold size-6 sm:size-7 grid place-items-center rounded-full', key === today && 'bg-brand-600 text-white')}>{d.getDate()}</span>
                    <div className="hidden sm:flex flex-col gap-0.5 w-full">
                      {items.slice(0, 3).map((it) => (
                        <span key={it.id} className={cx('truncate rounded px-1 text-[10px] font-semibold', TYPES[it.type]?.chip, it.cancelled && 'line-through opacity-60')}>{it.title}</span>
                      ))}
                      {items.length > 3 && <span className="text-[10px] text-muted">+{items.length - 3}</span>}
                    </div>
                    <div className="flex sm:hidden flex-wrap gap-0.5">
                      {[...new Set(items.map((i) => i.type))].map((t) => <span key={t} className={cx('size-1.5 rounded-full', TYPES[t]?.dot)} />)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-3 px-4 py-3 text-xs text-muted">
            {Object.entries(TYPES).map(([k, t]) => <span key={k} className="flex items-center gap-1.5"><span className={cx('size-2 rounded-full', t.dot)} />{t.label}</span>)}
          </div>
        </Card>

        <Card className="h-fit">
          <div className="px-5 py-4 border-b border-line">
            <p className="font-extrabold">{dayFmt.format(new Date(`${selected}T12:00:00`))}</p>
            <p className="text-xs text-muted">{hijriDay.format(new Date(`${selected}T12:00:00`))}</p>
          </div>
          <div className="p-3 space-y-2">
            {!dayItems.length && <p className="text-sm text-muted text-center py-8">مفيش حاجة في اليوم ده</p>}
            {dayItems.map((it) => {
              const body = (
                <div className={cx('rounded-xl border border-line p-3', it.cancelled && 'opacity-60')}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={TYPES[it.type]?.chip}>{TYPES[it.type]?.label}</Badge>
                    {it.start_time && <span className="text-xs text-muted flex items-center gap-1"><Clock className="size-3" />{clock12(it.start_time)}{it.end_time && ` – ${clock12(it.end_time)}`}</span>}
                  </div>
                  <p className={cx('font-semibold', it.cancelled && 'line-through')}>{it.title}</p>
                  {it.subtitle && <p className="text-xs text-muted mt-0.5">{it.subtitle}</p>}
                  {it.cancelled && <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">ملغي: {it.cancelled}</p>}
                  {it.notes && <p className="text-xs text-muted mt-1">{it.notes}</p>}
                  {user.role === 'admin' && it.event_id && (
                    <button className="mt-2 text-xs text-rose-600 font-semibold flex items-center gap-1" onClick={(e) => { e.preventDefault(); setRemoving(it); }}>
                      <Trash2 className="size-3" /> حذف
                    </button>
                  )}
                </div>
              );
              return it.link ? <Link key={it.id} to={it.link} className="block hover:opacity-90">{body}</Link> : <div key={it.id}>{body}</div>;
            })}
          </div>
        </Card>
      </div>

      {adding && <EventForm date={selected} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(true); }} />}
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} title="حذف من التقويم" message={`حذف "${removing?.title}"؟`} confirmLabel="حذف"
        onConfirm={async () => { await api.del(`/calendar/events/${removing.event_id}`); setRemoving(null); reload(true); }} />
    </>
  );
}

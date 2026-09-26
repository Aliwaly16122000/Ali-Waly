import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Copy, Database, Download, HardDriveDownload, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { SEMESTER_LABELS, fileSize, fmtDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, cx } from '../../components/ui';

function TermCard() {
  const { data, reload } = useApi('/admin/term');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.current && !form) setForm(data.current); }, [data, form]);
  if (!data || !form) return null;
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/term', form);
      toast.success('تم تغيير الترم الحالي');
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader icon={CalendarRange} title="الترم الحالي" subtitle="المواد اللي من ترمات تانية بتتحول أرشيف (عرض فقط)" />
      <div className="px-5 pb-5 grid sm:grid-cols-3 gap-4 items-end">
        <Field label="العام الدراسي">{(id) => <Input id={id} dir="ltr" value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2026/2027" />}</Field>
        <Field label="الترم">{(id) => <Select id={id} value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })}>{Object.entries(SEMESTER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Button icon={Save} loading={saving} onClick={save}>حفظ</Button>
        <div className="sm:col-span-3 flex flex-wrap gap-2">
          {data.terms.map((t) => (
            <Badge key={`${t.academic_year}-${t.semester}`} tone={t.academic_year === data.current?.academic_year && t.semester === data.current?.semester ? 'green' : 'slate'}>
              {SEMESTER_LABELS[t.semester]} {t.academic_year} · {t.courses} مادة
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}

function CloneCard() {
  const { data: courses } = useApi('/admin/courses');
  const { data: term } = useApi('/admin/term');
  const [target, setTarget] = useState({ academic_year: '', semester: 'spring' });
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const current = useMemo(() => (courses || []).filter((c) => term?.current && c.academic_year === term.current.academic_year && c.semester === term.current.semester), [courses, term]);
  useEffect(() => {
    if (term?.current && !target.academic_year) {
      const { academic_year: y, semester } = term.current;
      const next = semester === 'fall' ? { academic_year: y, semester: 'spring' } : { academic_year: y.split('/').map((n) => Number(n) + 1).join('/'), semester: 'fall' };
      setTarget(next);
    }
  }, [term, target.academic_year]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/term/clone', { course_ids: picked, ...target });
      toast.success(`تم إنشاء ${r.created.length} مادة في الترم الجديد${r.skipped.length ? ` (موجودة بالفعل: ${r.skipped.join('، ')})` : ''}`);
      setPicked([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader icon={Copy} title="تجهيز ترم جديد" subtitle="انسخ مواد الترم الحالي بدكاترتها ومعيديها ومواعيدها (من غير طلاب ولا درجات)" />
      <div className="px-5 pb-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="إلى العام الدراسي">{(id) => <Input id={id} dir="ltr" value={target.academic_year} onChange={(e) => setTarget({ ...target, academic_year: e.target.value })} />}</Field>
          <Field label="الترم">{(id) => <Select id={id} value={target.semester} onChange={(e) => setTarget({ ...target, semester: e.target.value })}>{Object.entries(SEMESTER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">مواد الترم الحالي ({current.length})</p>
          <button className="text-sm text-brand-600 font-semibold" onClick={() => setPicked(picked.length === current.length ? [] : current.map((c) => c.id))}>
            {picked.length === current.length ? 'إلغاء الكل' : 'تحديد الكل'}
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line">
          {current.map((c) => (
            <label key={c.id} className={cx('flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2', picked.includes(c.id) && 'bg-brand-50 dark:bg-brand-500/10')}>
              <input type="checkbox" className="size-4 accent-brand-600" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
              <span className="flex-1 text-sm font-semibold">{c.name}</span>
              <span className="text-xs text-muted ltr">{c.code}</span>
            </label>
          ))}
        </div>
        <Button icon={Copy} loading={busy} disabled={!picked.length || !target.academic_year} onClick={run}>إنشاء {picked.length || ''} مادة في الترم الجديد</Button>
        <p className="text-xs text-muted">بعد كده سجّل الطلاب في المواد الجديدة (دفعة كاملة بضغطة من صفحة المادة)، وغيّر "الترم الحالي" لما الترم يبدأ.</p>
      </div>
    </Card>
  );
}

function BackupsCard() {
  const { data, reload } = useApi('/admin/backups');
  const [busy, setBusy] = useState(false);
  const now = async () => {
    setBusy(true);
    try {
      await api.post('/admin/backups');
      toast.success('تم عمل نسخة احتياطية');
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={Database} title="النسخ الاحتياطي" subtitle="نسخة تلقائية كل يوم الساعة 3 الفجر، وبيتحفظ آخر 14 نسخة"
        action={<Button variant="secondary" icon={HardDriveDownload} loading={busy} onClick={now}>نسخة الآن</Button>} />
      <Alert tone="blue" className="mx-5 mb-4">نزّل نسخة على جهازك أو Google Drive كل أسبوع — لو السيرفر نفسه اتعطل، النسخ اللي عليه هتضيع معاه.</Alert>
      {!data?.length ? <EmptyState icon={Database} title="لا توجد نسخ بعد" /> : (
        <Table>
          <thead><tr><Th>النسخة</Th><Th>الحجم</Th><Th /></tr></thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.name}>
                <Td>{fmtDateTime(b.created_at)}<p className="text-xs text-muted ltr text-right">{b.name}</p></Td>
                <Td className="text-muted ltr text-right">{fileSize(b.size)}</Td>
                <Td className="text-left"><Button as="a" size="sm" variant="soft" icon={Download} href={`/api/admin/backups/${b.name}`}>تحميل</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export default function System() {
  return (
    <>
      <PageHeader title="الترم والنسخ الاحتياطي" />
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6"><TermCard /><BackupsCard /></div>
        <CloneCard />
      </div>
    </>
  );
}

import { useMemo, useState } from 'react';
import { ClipboardList, Download, Plus, Send, Upload, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { clock12 } from '../../lib/format';
import { Alert, Badge, Button, Card, ConfirmModal, EmptyState, FileDrop, Modal, PageHeader, PageLoader, Segmented, Table, Td, Th } from '../../components/ui';
import { EXAM_KINDS, EXAM_TONES, ExamForm, examDay } from '../exams/shared';

function ImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [period, setPeriod] = useState('final');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post('/exams/import', toForm({ file, period }));
      toast.success(`تم إضافة ${r.exams} امتحان و ${r.seats} رقم جلوس`);
      setErrors(r.errors);
      onDone();
      if (!r.errors.length) onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="رفع جدول الامتحانات من Excel"
      footer={<><Button variant="secondary" onClick={onClose}>إغلاق</Button><Button icon={Upload} loading={busy} disabled={!file} onClick={run}>رفع</Button></>}>
      <div className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-4 mb-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-56">
          <p className="font-bold">1) حمّل النموذج واملأه</p>
          <p className="text-sm text-muted">شيت لمواعيد الامتحانات (المادة، النوع، التاريخ، الوقت، المكان)، وشيت اختياري لأرقام الجلوس واللجان.</p>
        </div>
        <Button as="a" href="/api/exams/template.xlsx" icon={Download}>تحميل النموذج</Button>
      </div>
      <p className="font-bold mb-2">2) أرقام الجلوس دي خاصة بـ</p>
      <Segmented className="mb-4" value={period} onChange={setPeriod} options={[{ value: 'final', label: 'امتحانات نهاية الترم' }, { value: 'midterm', label: 'الميدترم' }]} />
      <FileDrop file={file} onChange={setFile} accept=".xlsx" hint="الملف بعد ما تملاه (.xlsx)" />
      <Alert tone="amber" className="mt-4">الامتحانات بتتضاف كمسودة — راجعها واضغط "نشر" عشان تظهر للطلاب ويوصلهم إشعار.</Alert>
      {errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 max-h-48 overflow-y-auto">
          {errors.map((e, i) => <p key={i} className="text-sm px-3 py-1.5 border-b border-line last:border-0"><b>شيت {e.sheet} · صف {e.row}:</b> {e.error}</p>)}
        </div>
      )}
    </Modal>
  );
}

function Seating() {
  const [period, setPeriod] = useState('final');
  const { data } = useApi(`/exams/seating?period=${period}`);
  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-line flex items-center justify-between gap-3">
        <Segmented value={period} onChange={setPeriod} options={[{ value: 'final', label: 'نهاية الترم' }, { value: 'midterm', label: 'الميدترم' }]} />
        <span className="text-sm text-muted">{data?.length ?? 0} طالب</span>
      </div>
      {!data?.length ? <EmptyState icon={Users} title="لم تُرفع أرقام جلوس" description="ارفعها من نموذج Excel" /> : (
        <Table className="max-h-[60vh]">
          <thead className="sticky top-0"><tr><Th>رقم الجلوس</Th><Th>الطالب</Th><Th>الكود</Th><Th>اللجنة / المكان</Th></tr></thead>
          <tbody>{data.map((s) => <tr key={s.student_id}><Td className="font-bold ltr text-right">{s.seat_number}</Td><Td>{s.name}</Td><Td className="ltr text-right text-muted">{s.username}</Td><Td className="text-muted">{s.hall || '—'}</Td></tr>)}</tbody>
        </Table>
      )}
    </Card>
  );
}

export default function AdminExams() {
  const { data, loading, reload } = useApi('/exams/me');
  const { data: courses } = useApi('/courses');
  const [tab, setTab] = useState('timetable');
  const [kind, setKind] = useState('all');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(null);
  const list = useMemo(() => (data?.exams || []).filter((x) => kind === 'all' || x.kind === kind), [data, kind]);
  const drafts = list.filter((x) => !x.published);

  const publish = async (ids) => {
    try {
      const r = await api.post('/exams/publish', { ids });
      toast.success(`تم نشر ${r.published} امتحان وإبلاغ ${r.students} طالب`);
      reload(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader title="جدول الامتحانات" subtitle="مواعيد امتحانات كل مادة بتظهر لطلابها، ومعاها رقم جلوس ولجنة كل طالب"
        actions={<>
          <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>رفع من Excel</Button>
          <Button icon={Plus} onClick={() => setEditing({})}>إضافة امتحان</Button>
        </>} />
      <Segmented className="mb-4" value={tab} onChange={setTab} options={[{ value: 'timetable', label: 'المواعيد' }, { value: 'seating', label: 'أرقام الجلوس واللجان' }]} />
      {tab === 'seating' ? <Seating /> : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
            <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'الكل' }, ...Object.entries(EXAM_KINDS).map(([k, v]) => ({ value: k, label: v }))]} />
            <div className="flex-1" />
            {drafts.length > 0 && <Button icon={Send} variant="success" onClick={() => publish(drafts.map((x) => x.id))}>نشر {drafts.length} مسودة</Button>}
          </div>
          {loading && !data ? <PageLoader /> : !list.length ? <EmptyState icon={ClipboardList} title="لا توجد امتحانات" description="أضف امتحان أو ارفع الجدول من Excel" /> : (
            <Table>
              <thead><tr><Th>التاريخ</Th><Th>الوقت</Th><Th>المادة</Th><Th>النوع</Th><Th>المكان</Th><Th>الطلاب</Th><Th>الحالة</Th><Th /></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id} className="hover:bg-surface-2">
                    <Td className="whitespace-nowrap font-semibold">{examDay(x.exam_date)}</Td>
                    <Td className="whitespace-nowrap text-muted">{clock12(x.start_time)} – {clock12(x.end_time)}</Td>
                    <Td><p className="font-semibold">{x.course_name}</p><p className="text-xs text-muted ltr text-right">{x.course_code}</p></Td>
                    <Td><Badge tone={EXAM_TONES[x.kind]}>{EXAM_KINDS[x.kind]}</Badge></Td>
                    <Td className="text-muted">{x.location || '—'}</Td>
                    <Td className="text-muted">{x.students}</Td>
                    <Td>{x.published ? <Badge tone="green" dot>منشور</Badge> : <Button size="sm" variant="soft" icon={Send} onClick={() => publish([x.id])}>نشر</Button>}</Td>
                    <Td>
                      <div className="flex gap-1 justify-end">
                        <button className="p-2 rounded-lg text-muted hover:bg-surface-2" onClick={() => setEditing(x)} title="تعديل"><Pencil className="size-4" /></button>
                        <button className="p-2 rounded-lg text-muted hover:text-rose-600" onClick={() => setRemoving(x)} title="حذف"><Trash2 className="size-4" /></button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {editing && <ExamForm initial={editing.id ? editing : null} courses={courses || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(true); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => reload(true)} />}
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} title="حذف الامتحان" message={`حذف امتحان ${removing?.course_name}؟`} confirmLabel="حذف"
        onConfirm={async () => { await api.del(`/exams/${removing.id}`); setRemoving(null); reload(true); }} />
    </>
  );
}

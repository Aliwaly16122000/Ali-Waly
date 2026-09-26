import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Upload, Search, KeyRound, Pencil, Trash2, Download, Copy, UserX, Smartphone, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { LEVEL_LABELS, ROLE_LABELS, timeAgo } from '../../lib/format';
import { downloadCsv } from '../../lib/download';
import {
  Alert, Avatar, Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FileDrop, Input, Modal,
  PageHeader, PageLoader, Segmented, Select, Table, Td, Textarea, Th,
} from '../../components/ui';

const ROLE_TONE = { admin: 'red', doctor: 'blue', ta: 'violet', student: 'slate' };

function UserForm({ initial, departments, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial?.id ? { ...initial, password: '' } : {
    name: '', username: '', email: '', phone: '', role: initial?.role || 'student', department_id: '', level: '', section: '', password: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name, username: form.username, email: form.email || null, phone: form.phone || null, role: form.role,
      department_id: form.department_id ? Number(form.department_id) : null,
      level: form.role === 'student' && form.level !== '' && form.level !== null ? Number(form.level) : null,
      section: form.role === 'student' ? (form.section || null) : null,
      ...(form.password ? { password: form.password } : {}),
      ...(initial?.id ? { is_active: !!form.is_active } : {}),
    };
    try {
      const res = initial?.id ? await api.put(`/admin/users/${initial.id}`, body) : await api.post('/admin/users', body);
      onSaved(res, body);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={initial?.id ? 'تعديل مستخدم' : 'مستخدم جديد'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button form="user-form" type="submit" loading={saving}>حفظ</Button></>}>
      <form id="user-form" onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        <Field label="الاسم بالكامل" className="sm:col-span-2">{(id) => <Input id={id} value={form.name} onChange={set('name')} required />}</Field>
        <Field label="الصلاحية">{(id) => <Select id={id} value={form.role} onChange={set('role')}>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label={form.role === 'student' ? 'الكود الجامعي (اسم المستخدم)' : 'اسم المستخدم'}>{(id) => <Input id={id} dir="ltr" value={form.username} onChange={set('username')} required />}</Field>
        <Field label="القسم">{(id) => <Select id={id} value={form.department_id ?? ''} onChange={set('department_id')}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        {form.role === 'student' && <Field label="السكشن" hint="بيتحط فيه تلقائياً لما يتسجل مع دفعته">{(id) => <Input id={id} value={form.section ?? ''} onChange={set('section')} placeholder="سكشن 1" />}</Field>}
        {form.role === 'student' && <Field label="الفرقة">{(id) => <Select id={id} value={form.level ?? ''} onChange={set('level')}><option value="">—</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</Select>}</Field>}
        <Field label="البريد الإلكتروني">{(id) => <Input id={id} dir="ltr" type="email" value={form.email ?? ''} onChange={set('email')} />}</Field>
        <Field label="الموبايل">{(id) => <Input id={id} dir="ltr" value={form.phone ?? ''} onChange={set('phone')} />}</Field>
        <Field label={initial?.id ? 'كلمة سر جديدة (اختياري)' : 'كلمة السر'} hint={initial?.id ? 'اتركها فارغة للإبقاء على الحالية' : 'اتركها فارغة لتوليد كلمة سر تلقائياً'}>
          {(id) => <Input id={id} dir="ltr" value={form.password} onChange={set('password')} minLength={6} />}
        </Field>
        {initial?.id && (
          <label className="flex items-center gap-3 sm:col-span-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-brand-600" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> الحساب مفعّل
          </label>
        )}
      </form>
    </Modal>
  );
}

function CredentialsModal({ creds, onClose }) {
  if (!creds) return null;
  const copy = () => navigator.clipboard?.writeText(creds.map((c) => `${c.name}\t${c.username}\t${c.password}`).join('\n')).then(() => toast.success('تم النسخ'));
  return (
    <Modal open onClose={onClose} title="بيانات الدخول" subtitle="احفظها وسلّمها للمستخدمين — مش هتظهر تاني" size="lg"
      footer={<>
        <Button variant="secondary" icon={Copy} onClick={copy}>نسخ</Button>
        <Button icon={Download} onClick={() => downloadCsv('passwords.csv', [['الاسم', 'اسم المستخدم', 'كلمة السر'], ...creds.map((c) => [c.name, c.username, c.password])])}>تحميل Excel</Button>
      </>}>
      <Alert tone="amber" className="mb-4">كل مستخدم هيُطلب منه تغيير كلمة السر أول مرة يدخل.</Alert>
      <Table className="max-h-96 border border-line rounded-xl">
        <thead><tr><Th>الاسم</Th><Th>اسم المستخدم</Th><Th>كلمة السر</Th></tr></thead>
        <tbody>{creds.map((c) => <tr key={c.username}><Td>{c.name}</Td><Td className="ltr text-right">{c.username}</Td><Td className="ltr text-right font-mono font-bold">{c.password}</Td></tr>)}</tbody>
      </Table>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const [mode, setMode] = useState('file');
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  const parsePasted = () => {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(sep).map((h) => h.trim());
    return lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [header[i], v.trim()])));
  };

  const run = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const res = mode === 'file'
        ? await api.post('/admin/users/import', toForm({ file }))
        : await api.post('/admin/users/import', { rows: parsePasted() });
      setErrors(res.errors);
      if (res.created.length) onDone(res.created);
      if (!res.errors.length) onClose();
      else toast.warning(`تم إضافة ${res.created.length} وفشل ${res.errors.length}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="استيراد مستخدمين" subtitle="من ملف Excel أو بالنسخ واللصق"
      footer={<><Button variant="secondary" onClick={onClose}>إغلاق</Button><Button icon={Upload} loading={busy} disabled={mode === 'file' ? !file : !text.trim()} onClick={run}>استيراد</Button></>}>
      <Segmented className="mb-4" value={mode} onChange={setMode} options={[{ value: 'file', label: 'ملف Excel / CSV' }, { value: 'paste', label: 'نسخ ولصق' }]} />
      <div className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-4 mb-4 flex flex-wrap items-center gap-4">
        <FileSpreadsheet className="size-10 text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-56">
          <p className="font-bold">1) حمّل النموذج واملأه</p>
          <p className="text-sm text-muted">شيت للطلاب وشيت للدكاترة وشيت للمعيدين، والقسم والفرقة بتختارهم من قائمة. كلمة السر اختيارية (بتتولد تلقائياً).</p>
        </div>
        <Button as="a" href="/api/admin/users/template.xlsx" icon={Download}>تحميل نموذج Excel</Button>
      </div>
      <p className="font-bold mb-2">2) ارفع الملف بعد ما تملاه</p>
      {mode === 'file'
        ? <FileDrop file={file} onChange={setFile} accept=".xlsx,.csv" hint="النموذج بعد ما تملاه (.xlsx) أو ملف .csv" />
        : <Textarea className="min-h-48 font-mono text-xs" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} placeholder={'الاسم\tالكود\tالقسم\tالفرقة\nمحمد أحمد\t2024001\tCSE\t2'} />}
      {errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-500/30 max-h-48 overflow-y-auto">
          {errors.map((e, i) => <p key={i} className="text-sm px-3 py-1.5 border-b border-line last:border-0"><b>{e.sheet ? `شيت ${e.sheet} · ` : ''}صف {e.row}:</b> {e.error}</p>)}
        </div>
      )}
    </Modal>
  );
}

export default function Users() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || 'student';
  const [dept, setDept] = useState('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const url = `/admin/users?role=${role}${dept ? `&department_id=${dept}` : ''}${level !== '' ? `&level=${level}` : ''}`;
  const { data, error, loading, reload } = useApi(url);
  const { data: departments } = useApi('/admin/departments');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [creds, setCreds] = useState(null);
  const [del, setDel] = useState(null);
  const [reset, setReset] = useState(null);
  const [unbind, setUnbind] = useState(null);

  const list = useMemo(() => (data || []).filter((u) => !q || u.name.includes(q) || u.username.toLowerCase().includes(q.toLowerCase())), [data, q]);

  const onSaved = (res, body) => {
    setEditing(null);
    reload(true);
    if (res?.password) setCreds([{ name: body.name, username: body.username, password: res.password }]);
    else toast.success('تم الحفظ');
  };
  const doReset = async () => {
    const { password } = await api.post(`/admin/users/${reset.id}/reset-password`);
    setCreds([{ name: reset.name, username: reset.username, password }]);
    setReset(null);
  };
  const doDelete = async () => {
    try {
      await api.del(`/admin/users/${del.id}`);
      setDel(null);
      reload(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader title="المستخدمون" subtitle="الطلاب وأعضاء هيئة التدريس والمعيدون — كل مستخدم له كلمة سر خاصة"
        actions={<>
          <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>استيراد من Excel</Button>
          <Button icon={Plus} onClick={() => setEditing({ role })}>إضافة</Button>
        </>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
          <Segmented value={role} onChange={(r) => setParams({ role: r })}
            options={[{ value: 'student', label: 'الطلاب' }, { value: 'doctor', label: 'الدكاترة' }, { value: 'ta', label: 'المعيدون' }, { value: 'admin', label: 'المسؤولون' }]} />
          <div className="relative flex-1 min-w-48">
            <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input className="pr-9" placeholder="بحث بالاسم أو الكود" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-52" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">كل الأقسام</option>{(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          {role === 'student' && (
            <Select className="w-40" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">كل الفرق</option>{LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </Select>
          )}
        </div>
        {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !list.length ? <EmptyState title="لا يوجد مستخدمون" /> : (
          <Table>
            <thead><tr><Th>الاسم</Th><Th>اسم المستخدم</Th><Th>القسم</Th>{role === 'student' && <Th>الفرقة</Th>}{role === 'student' && <Th>موبايل الحضور</Th>}<Th>آخر دخول</Th><Th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className="hover:bg-surface-2">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size="sm" />
                      <div>
                        <p className="font-semibold">{u.name} {!u.is_active && <Badge tone="red"><UserX className="size-3" /> موقوف</Badge>}</p>
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                      </div>
                    </div>
                  </Td>
                  <Td className="ltr text-right">{u.username}</Td>
                  <Td className="text-muted">{u.department_name || '—'}</Td>
                  {role === 'student' && <Td className="text-muted whitespace-nowrap">{LEVEL_LABELS[u.level] ?? '—'}{u.section && <span className="block text-xs">{u.section}</span>}</Td>}
                  {role === 'student' && (
                    <Td className="whitespace-nowrap">
                      {u.device_bound_at ? (
                        <div className="flex items-center gap-2">
                          <Badge tone="green"><Smartphone className="size-3" /> {u.device_label || 'مربوط'}</Badge>
                          <button className="text-xs text-rose-600 font-semibold hover:underline" onClick={() => setUnbind(u)}>فك الربط</button>
                        </div>
                      ) : <span className="text-xs text-muted">لم يُربط بعد</span>}
                    </Td>
                  )}
                  <Td className="text-muted text-xs whitespace-nowrap">{u.last_login_at ? timeAgo(u.last_login_at) : 'لم يدخل بعد'}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <button className="p-2 rounded-lg text-muted hover:bg-surface-2" title="إعادة تعيين كلمة السر" onClick={() => setReset(u)}><KeyRound className="size-4" /></button>
                      <button className="p-2 rounded-lg text-muted hover:bg-surface-2" title="تعديل" onClick={() => setEditing(u)}><Pencil className="size-4" /></button>
                      <button className="p-2 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="حذف" onClick={() => setDel(u)}><Trash2 className="size-4" /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <p className="text-xs text-muted px-4 py-3 border-t border-line">{list.length} مستخدم</p>}
      </Card>

      {editing && <UserForm initial={editing} departments={departments || []} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(created) => { setCreds(created); reload(true); }} />}
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
      <ConfirmModal open={!!reset} onClose={() => setReset(null)} onConfirm={doReset} tone="primary" title="إعادة تعيين كلمة السر"
        message={`هيتم توليد كلمة سر جديدة لـ ${reset?.name} والقديمة هتتوقف.`} confirmLabel="توليد كلمة سر" />
      <ConfirmModal open={!!unbind} onClose={() => setUnbind(null)} tone="primary" title="فك ربط موبايل الحضور" confirmLabel="فك الربط"
        onConfirm={async () => { await api.del(`/admin/users/${unbind.id}/device`); toast.success('تم — أول تسجيل حضور جاي هيربط الموبايل الجديد'); setUnbind(null); reload(true); }}
        message={`استخدمه لو ${unbind?.name} غيّر موبايله أو ضاع. أول مرة يسجل حضور بعد كده هيتربط الموبايل الجديد.`} />
      <ConfirmModal open={!!del} onClose={() => setDel(null)} onConfirm={doDelete} title="حذف المستخدم"
        message={`حذف ${del?.name} نهائياً مع كل تسليماته ودرجاته؟ لو عايز توقفه مؤقتاً استخدم "تعديل" وألغِ تفعيل الحساب.`} confirmLabel="حذف نهائياً" />
    </>
  );
}

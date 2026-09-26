import { useState } from 'react';
import { Megaphone, BookOpen, Plus, Paperclip, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../context/AuthContext';
import { timeAgo, titled } from '../../lib/format';
import { Avatar, Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FileDrop, Input, Modal, PageLoader, Textarea } from '../../components/ui';

export default function Posts({ course, type }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/posts`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', file: null });
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const staff = ['doctor', 'ta', 'admin'].includes(course.my_role);
  const isMaterial = type === 'material';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/courses/${course.id}/posts`, toForm({ type, title: form.title, body: form.body, file: form.file }));
      toast.success(isMaterial ? 'تم رفع المحتوى وإشعار الطلاب' : 'تم نشر الإعلان وإشعار الطلاب');
      setOpen(false);
      setForm({ title: '', body: '', file: null });
      reload(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/posts/${toDelete.id}`);
      setToDelete(null);
      reload(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const posts = data.filter((p) => p.type === type);
  const Icon = isMaterial ? BookOpen : Megaphone;

  return (
    <>
      {staff && (
        <div className="flex justify-end mb-4">
          <Button icon={Plus} onClick={() => setOpen(true)}>{isMaterial ? 'رفع محاضرة / ملف' : 'إعلان جديد'}</Button>
        </div>
      )}
      {!posts.length ? (
        <Card><EmptyState icon={Icon} title={isMaterial ? 'لا توجد ملفات بعد' : 'لا توجد إعلانات بعد'} /></Card>
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start gap-3">
                <Avatar name={p.author_name || '?'} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{titled({ name: p.author_name, role: p.author_role })}</p>
                    {p.author_role && <Badge tone={p.author_role === 'doctor' ? 'blue' : 'violet'}>{p.author_role === 'doctor' ? 'دكتور' : 'معيد'}</Badge>}
                    <span className="text-xs text-muted">{timeAgo(p.created_at)}</span>
                  </div>
                  <h3 className="text-lg font-bold mt-2">{p.title}</h3>
                  {p.body && <p className="text-ink/85 mt-1 whitespace-pre-line leading-relaxed">{p.body}</p>}
                  {p.file_name && (
                    <a href={`/api/posts/${p.id}/file`} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold hover:border-brand-300">
                      <Paperclip className="size-4 text-brand-500" /> <span className="truncate max-w-64">{p.file_name}</span> <Download className="size-4 text-muted" />
                    </a>
                  )}
                </div>
                {staff && (course.my_role !== 'ta' || p.author_id === user.id) && (
                  <button onClick={() => setToDelete(p)} className="p-2 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" aria-label="حذف"><Trash2 className="size-4" /></button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={isMaterial ? 'رفع محتوى جديد' : 'إعلان جديد'} subtitle="هيوصل إشعار لكل طلاب المادة"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button form="post-form" type="submit" loading={saving}>نشر</Button></>}>
        <form id="post-form" onSubmit={submit} className="space-y-4">
          <Field label="العنوان">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder={isMaterial ? 'محاضرة 7 - Hashing' : 'موعد الميدترم'} />}</Field>
          <Field label="التفاصيل">{(id) => <Textarea id={id} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}</Field>
          <Field label={isMaterial ? 'الملف' : 'مرفق (اختياري)'}><FileDrop file={form.file} onChange={(file) => setForm({ ...form, file })} hint="PDF, PPTX, DOCX, ZIP — حتى 20 ميجا" /></Field>
        </form>
      </Modal>
      <ConfirmModal open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="حذف المنشور" message={`هل أنت متأكد من حذف "${toDelete?.title}"؟`} confirmLabel="حذف" />
    </>
  );
}

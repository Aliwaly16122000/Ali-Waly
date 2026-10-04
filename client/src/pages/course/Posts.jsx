import { useEffect, useState } from 'react';
import { Megaphone, BookOpen, Plus, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../context/AuthContext';
import { timeAgo, titled } from '../../lib/format';
import { AttachmentLinks, Avatar, Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FilesDrop, Input, Modal, PageLoader, Segmented, Textarea } from '../../components/ui';

export default function Posts({ course, type }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(`/courses/${course.id}/posts`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', files: [] });
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [views, setViews] = useState(null);
  const staff = ['doctor', 'ta', 'admin'].includes(course.my_role);
  const isMaterial = type === 'material';
  const hasPosts = !!data?.some((p) => p.type === type);

  // Opening the tab marks its posts as seen (only students are counted).
  useEffect(() => {
    if (course.my_role === 'student' && hasPosts) api.post(`/courses/${course.id}/posts/seen`, { type }).catch(() => {});
  }, [course.id, course.my_role, type, hasPosts]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/courses/${course.id}/posts`, toForm({ type, title: form.title, body: form.body, files: form.files }));
      toast.success(isMaterial ? 'تم رفع المحتوى وإشعار الطلاب' : 'تم نشر الإعلان وإشعار الطلاب');
      setOpen(false);
      setForm({ title: '', body: '', files: [] });
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
                  <AttachmentLinks attachments={p.attachments} className="mt-3" />
                  {p.students_count > 0 && (
                    <button onClick={() => setViews(p)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-brand-600">
                      <Eye className="size-4" /> شافه {p.seen_count} من {p.students_count}
                    </button>
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
          <Field label={isMaterial ? 'الملفات' : 'مرفقات (اختياري)'}><FilesDrop files={form.files} onChange={(files) => setForm({ ...form, files })} hint="PDF, PPTX, DOCX, ZIP — حتى 20 ميجا للملف" /></Field>
        </form>
      </Modal>
      {views && <ViewsModal key={views.id} post={views} onClose={() => setViews(null)} />}
      <ConfirmModal open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="حذف المنشور" message={`هل أنت متأكد من حذف "${toDelete?.title}"؟`} confirmLabel="حذف" />
    </>
  );
}

/** Who opened a post and who didn't yet — staff only. */
function ViewsModal({ post, onClose }) {
  const { data } = useApi(`/posts/${post.id}/views`);
  const [tab, setTab] = useState('unseen');
  const rows = data?.[tab] || [];
  return (
    <Modal open onClose={onClose} title="مين شاف المنشور" subtitle={post.title}>
      {!data ? <PageLoader /> : (
        <>
          <Segmented className="mb-4" value={tab} onChange={setTab}
            options={[{ value: 'unseen', label: `لسه ما شافوش (${data.unseen.length})` }, { value: 'seen', label: `شافوه (${data.seen.length})` }]} />
          {!rows.length ? (
            <p className="text-center text-sm text-muted py-6">{tab === 'seen' ? 'لسه محدش فتحه' : 'كل الطلبة شافوه 👌'}</p>
          ) : (
            <ul className="divide-y divide-line max-h-96 overflow-y-auto">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <Avatar name={s.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{s.name}</p>
                    <p className="text-xs text-muted"><span dir="ltr">{s.username}</span></p>
                  </div>
                  {s.seen_at && <span className="text-xs text-muted shrink-0">{timeAgo(s.seen_at)}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

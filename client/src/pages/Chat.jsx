import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Send, Paperclip, Search, ChevronRight, MessagesSquare, Plus, Download, X, Check, CheckCheck, Smile, LifeBuoy, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { api, toForm } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { useRealtime, useSocketEvent } from '../context/RealtimeContext';
import { ROLE_LABELS, fmtDate, fmtTime, timeAgo, titled } from '../lib/format';
import { openConversation, openSupport } from '../lib/chat';
import { Avatar, Badge, Button, Card, EmptyState, Input, Modal, Spinner, cx } from '../components/ui';

const EMOJIS = ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😉', '😎', '🤩', '🥳', '😇', '🙂', '🤔', '🤗', '😅', '😢', '😭', '😡', '😱',
  '😴', '🙄', '😬', '🤝', '👍', '👎', '👏', '🙏', '💪', '👌', '✌️', '🤞', '👋', '🫡', '❤️', '💙', '💚', '💛', '🔥', '⭐',
  '✨', '🎉', '🎊', '💯', '✅', '❌', '⚠️', '❓', '❗', '📌', '📎', '📝', '📚', '📖', '✏️', '📅', '⏰', '🎓', '🏗️', '📐',
  '📏', '🧮', '💻', '📱', '☕', '🌙', '☀️', '🌹', '🤲', '🕌'];

/** Small emoji palette that inserts at the cursor. */
function EmojiPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className={cx('size-11 rounded-xl grid place-items-center hover:bg-surface-2', open ? 'text-brand-500' : 'text-muted')} aria-label="إيموجي">
        <Smile className="size-5" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 right-0 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface shadow-2xl p-2 grid grid-cols-8 gap-0.5 max-h-60 overflow-y-auto scrollbar-thin">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onPick(e)} className="text-xl leading-none size-8 rounded-lg grid place-items-center hover:bg-surface-2">{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewChatModal({ open, onClose }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  // Admin searches students on the server; everyone else filters their course contacts locally.
  const { data } = useApi(open ? `/chat/contacts${isAdmin && debounced.length >= 2 ? `?q=${encodeURIComponent(debounced)}` : ''}` : null);
  const navigate = useNavigate();
  const start = async (id) => {
    try {
      const cid = await openConversation(id);
      onClose();
      navigate(`/chat/${cid}`);
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="محادثة جديدة" subtitle={isAdmin ? 'تقدر تراسل أي حد في الكلية — اكتب اسم الطالب أو كوده للبحث' : 'تقدر تراسل الدكاترة والمعيدين والطلاب في موادك'}>
      <div className="relative mb-4">
        <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input className="pr-9" placeholder="ابحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {!data ? <div className="grid place-items-center py-8"><Spinner /></div> : !data.length ? <EmptyState title="لا توجد جهات اتصال" /> : (
        <div className="space-y-5">
          {data.map((g) => {
            const members = g.members.filter((m) => !q || m.name.includes(q) || (m.role === 'student' && isAdmin));
            if (!members.length) return null;
            return (
              <div key={g.course_id}>
                <p className="text-xs font-bold text-muted mb-2">{g.course_name}{g.course_code && <> · <span className="ltr">{g.course_code}</span></>}</p>
                <div className="space-y-1">
                  {members.map((m) => (
                    <button key={`${g.course_id}-${m.id}`} onClick={() => start(m.id)} className="w-full flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2 text-right">
                      <Avatar name={m.name} size="sm" online={m.online} />
                      <span className="flex-1 font-semibold">{titled(m)}</span>
                      <Badge tone={m.role === 'doctor' ? 'blue' : m.role === 'ta' ? 'violet' : 'slate'}>{ROLE_LABELS[m.role]}{m.section ? ` · ${m.section}` : ''}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function ConversationList({ list, activeId, onNew }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const support = async () => {
    try {
      navigate(`/chat/${await openSupport()}`);
    } catch (err) {
      toast.error(err.message);
    }
  };
  const [q, setQ] = useState('');
  const filtered = (list || []).filter((c) => !q || c.other_name.includes(q));
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-line space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">المحادثات</h2>
          <Button size="sm" icon={Plus} onClick={onNew}>جديدة</Button>
        </div>
        <div className="relative">
          <Search className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pr-9 h-9" placeholder="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {user.role === 'admin' ? (
          <Button as="a" href="/api/admin/support/export.xlsx" size="sm" variant="soft" icon={FileSpreadsheet} className="w-full">تصدير كل رسائل الدعم (Excel)</Button>
        ) : (
          <button onClick={support} className="w-full flex items-center gap-3 rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-3 py-2.5 text-right hover:border-brand-400">
            <span className="size-9 rounded-full bg-brand-600 text-white grid place-items-center shrink-0"><LifeBuoy className="size-5" /></span>
            <span className="min-w-0">
              <span className="block font-bold text-sm">الدعم الفني</span>
              <span className="block text-xs text-muted truncate">مشكلة أو اقتراح؟ ابعتلنا هنا</span>
            </span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!list ? <div className="grid place-items-center py-10"><Spinner /></div>
          : !filtered.length ? <EmptyState icon={MessagesSquare} title="لا توجد محادثات" description="ابدأ محادثة مع دكتور أو معيد المادة" />
            : filtered.map((c) => (
              <button key={c.id} onClick={() => navigate(`/chat/${c.id}`)}
                className={cx('w-full flex items-center gap-3 px-4 py-3 text-right border-b border-line hover:bg-surface-2', activeId === c.id && 'bg-brand-50 dark:bg-brand-500/10')}>
                <Avatar name={c.other_name} online={c.online} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cx('truncate', c.unread ? 'font-extrabold' : 'font-semibold')}>{titled({ name: c.other_name, role: c.other_role })}</p>
                    <span className="text-[11px] text-muted shrink-0">{c.last_message_at ? timeAgo(c.last_message_at) : ''}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={cx('text-sm truncate', c.unread ? 'text-ink' : 'text-muted')}>{c.last_message ?? 'ابدأ المحادثة'}</p>
                    {c.unread > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-brand-600 text-white text-[11px] grid place-items-center">{c.unread}</span>}
                  </div>
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}

function Thread({ id, onActivity }) {
  const { user } = useAuth();
  const { emit, setActiveConversation, refreshCounts } = useRealtime();
  const navigate = useNavigate();
  const [conv, setConv] = useState(null);
  const [text, setText] = useState('');
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const bottom = useRef(null);
  const fileInput = useRef(null);
  const lastTyping = useRef(0);
  const typingTimer = useRef(null);

  const markRead = useCallback(() => {
    api.post(`/chat/conversations/${id}/read`).then(() => { refreshCounts(); onActivity(); }).catch(() => {});
  }, [id, refreshCounts, onActivity]);

  useEffect(() => {
    setConv(null);
    setActiveConversation(Number(id));
    api.get(`/chat/conversations/${id}`).then(setConv).catch((err) => { toast.error(err.message); navigate('/chat'); });
    markRead();
    return () => setActiveConversation(null);
  }, [id, navigate, setActiveConversation, markRead]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages.length, typing]);

  useSocketEvent('message:new', (m) => {
    if (m.conversation_id !== Number(id)) return;
    setConv((c) => (c && !c.messages.some((x) => x.id === m.id) ? { ...c, messages: [...c.messages, m] } : c));
    if (m.sender_id !== user.id) { setTyping(false); markRead(); }
  });
  useSocketEvent('message:read', (e) => {
    if (e.conversation_id !== Number(id)) return;
    setConv((c) => c && { ...c, messages: c.messages.map((m) => (m.sender_id === user.id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)) });
  });
  useSocketEvent('typing', (e) => {
    if (e.conversationId !== Number(id)) return;
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 3000);
  });

  const loadOlder = async () => {
    const first = conv.messages[0];
    const older = await api.get(`/chat/conversations/${id}?before=${first.id}`);
    setConv((c) => ({ ...c, messages: [...older.messages, ...c.messages], has_more: older.has_more }));
  };

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() && !file) return;
    setSending(true);
    try {
      const m = await api.post(`/chat/conversations/${id}/messages`, toForm({ body: text.trim(), file }));
      setConv((c) => (c.messages.some((x) => x.id === m.id) ? c : { ...c, messages: [...c.messages, m] }));
      setText('');
      setFile(null);
      onActivity();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji) => {
    const el = input.current;
    const at = el ? el.selectionStart ?? text.length : text.length;
    const end = el ? el.selectionEnd ?? at : at;
    onType(text.slice(0, at) + emoji + text.slice(end));
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + emoji.length, at + emoji.length); } });
  };

  const onType = (v) => {
    setText(v);
    if (conv && Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      emit('typing', { to: conv.other.id, conversationId: Number(id) });
    }
  };

  if (!conv) return <div className="h-full grid place-items-center"><Spinner /></div>;

  let lastDay = '';
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 h-16 border-b border-line shrink-0">
        <button onClick={() => navigate('/chat')} className="lg:hidden p-1 -me-1 text-muted"><ChevronRight className="size-6" /></button>
        <Avatar name={conv.other.name} online={conv.other.online} />
        <div className="min-w-0">
          <p className="font-bold truncate">{titled(conv.other)}</p>
          <p className="text-xs text-muted">{typing ? <span className="text-brand-600">يكتب الآن…</span> : `${ROLE_LABELS[conv.other.role]}${conv.other.online ? ' · متصل الآن' : ''}`}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-2 bg-surface-2/40">
        {conv.has_more && <div className="text-center"><Button size="sm" variant="ghost" onClick={loadOlder}>رسائل أقدم</Button></div>}
        {!conv.messages.length && <EmptyState icon={MessagesSquare} title="ابدأ المحادثة" description="اكتب رسالتك بالأسفل" />}
        {conv.messages.map((m) => {
          const mine = m.sender_id === user.id;
          const day = fmtDate(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <p className="text-center text-xs text-muted my-3"><span className="bg-surface border border-line rounded-full px-3 py-1">{day}</span></p>}
              <div className={cx('flex', mine ? 'justify-start' : 'justify-end')}>
                <div className={cx('max-w-[80%] sm:max-w-[65%] rounded-2xl px-4 py-2.5 shadow-sm',
                  mine ? 'bg-brand-600 text-white rounded-br-md' : 'bg-surface border border-line rounded-bl-md')}>
                  {m.file_name && (
                    <a href={`/api/messages/${m.id}/file`} className={cx('flex items-center gap-2 rounded-xl px-3 py-2 mb-1 text-sm font-semibold', mine ? 'bg-white/15' : 'bg-surface-2')}>
                      <Paperclip className="size-4 shrink-0" /> <span className="truncate">{m.file_name}</span> <Download className="size-4 shrink-0 opacity-70" />
                    </a>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                  <p className={cx('text-[10px] mt-1 flex items-center gap-1 justify-end', mine ? 'text-white/70' : 'text-muted')}>
                    {fmtTime(m.created_at)}
                    {mine && (m.read_at ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="p-3 border-t border-line shrink-0 bg-surface">
        {file && (
          <div className="flex items-center gap-2 mb-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <Paperclip className="size-4 text-brand-500" /><span className="flex-1 truncate">{file.name}</span>
            <button type="button" onClick={() => setFile(null)}><X className="size-4 text-muted" /></button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInput} type="file" hidden onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ''; }} />
          <button type="button" onClick={() => fileInput.current.click()} className="size-11 shrink-0 rounded-xl grid place-items-center text-muted hover:bg-surface-2" aria-label="إرفاق ملف"><Paperclip className="size-5" /></button>
          <EmojiPicker onPick={insertEmoji} />
          <textarea
            ref={input} rows={1} value={text} onChange={(e) => onType(e.target.value)} placeholder="اكتب رسالة…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="flex-1 resize-none max-h-32 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          <Button type="submit" className="size-11 !px-0 shrink-0" loading={sending} disabled={!text.trim() && !file} aria-label="إرسال">
            {!sending && <Send className="size-5 -scale-x-100" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const { data: list, reload } = useApi('/chat/conversations');
  const [newChat, setNewChat] = useState(false);
  const activeId = id ? Number(id) : null;
  const refresh = useMemo(() => () => reload(true), [reload]);
  useSocketEvent('message:new', refresh);

  return (
    <Card className="overflow-hidden h-[calc(100dvh-10rem)] lg:h-[calc(100dvh-8rem)] grid lg:grid-cols-[22rem_1fr]">
      <div className={cx('border-l border-line min-h-0', activeId && 'hidden lg:block')}>
        <ConversationList list={list} activeId={activeId} onNew={() => setNewChat(true)} />
      </div>
      <div className={cx('min-h-0', !activeId && 'hidden lg:block')}>
        {activeId ? <Thread key={activeId} id={activeId} onActivity={refresh} />
          : <div className="h-full grid place-items-center"><EmptyState icon={MessagesSquare} title="اختر محادثة" description="أو ابدأ محادثة جديدة مع دكتور أو معيد" action={<Button icon={Plus} onClick={() => setNewChat(true)}>محادثة جديدة</Button>} /></div>}
      </div>
      <NewChatModal open={newChat} onClose={() => setNewChat(false)} />
    </Card>
  );
}

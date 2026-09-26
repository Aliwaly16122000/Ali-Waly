import { Bell, FileText, Megaphone, BookOpen, ClipboardCheck, Award, Undo2, QrCode, MessageCircle, Upload, CalendarClock } from 'lucide-react';
import { cx } from './ui';

const MAP = {
  assessment: [FileText, 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'],
  announcement: [Megaphone, 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'],
  material: [BookOpen, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'],
  grades_submitted: [ClipboardCheck, 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'],
  grades_published: [Award, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'],
  grades_returned: [Undo2, 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'],
  attendance: [QrCode, 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'],
  message: [MessageCircle, 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'],
  submission: [Upload, 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'],
  schedule: [CalendarClock, 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'],
  course: [BookOpen, 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'],
};

export function NotificationIcon({ type, className }) {
  const [Icon, tone] = MAP[type] || [Bell, 'bg-slate-100 text-slate-600'];
  return <div className={cx('size-9 shrink-0 rounded-xl grid place-items-center', tone, className)}><Icon className="size-[18px]" /></div>;
}

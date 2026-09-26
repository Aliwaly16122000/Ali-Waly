export const ROLE_LABELS = { admin: 'مسؤول النظام', doctor: 'عضو هيئة تدريس', ta: 'معيد', student: 'طالب', leader: 'قيادات' };
export const ROLE_TITLES = { doctor: 'د.', ta: 'م.', student: '', admin: '', leader: 'أ.د.' };
export const LEVEL_LABELS = ['الإعدادية', 'الفرقة الأولى', 'الفرقة الثانية', 'الفرقة الثالثة', 'الفرقة الرابعة', 'الفرقة الخامسة'];
export const SEMESTER_LABELS = { fall: 'الترم الأول', spring: 'الترم الثاني', summer: 'الترم الصيفي' };
export const TYPE_LABELS = { sheet: 'شيت', quiz: 'كويز', midterm: 'ميدترم', lab: 'معمل', project: 'مشروع', final: 'فاينال', other: 'تقييم' };
export const STATUS_META = {
  open: { label: 'مفتوح للتصحيح', tone: 'blue' },
  submitted: { label: 'بانتظار اعتماد الدكتور', tone: 'amber' },
  published: { label: 'الدرجات منشورة', tone: 'green' },
};

export const titled = (user) => (user?.role && ROLE_TITLES[user.role] ? `${ROLE_TITLES[user.role]} ${user.name}` : user?.name ?? '');

const dateFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const rtf = new Intl.RelativeTimeFormat('ar-EG-u-nu-latn', { numeric: 'auto' });

export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '—');
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '—');
export const fmtTime = (d) => (d ? timeFmt.format(new Date(d)) : '');

export function timeAgo(d) {
  if (!d) return '';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'الآن';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(d);
}

/** Human "due" text + urgency tone for a deadline. */
export function dueInfo(due) {
  if (!due) return { text: 'بدون موعد نهائي', tone: 'slate' };
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) return { text: `انتهى ${timeAgo(due)}`, tone: 'red' };
  const hours = ms / 3600000;
  const text = `التسليم ${timeAgo(due)}`;
  if (hours < 24) return { text, tone: 'red' };
  if (hours < 72) return { text, tone: 'amber' };
  return { text, tone: 'blue' };
}

export const num = (x, d = 2) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));

export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function pctTone(p) {
  if (p === null || p === undefined) return 'slate';
  if (p >= 85) return 'green';
  if (p >= 65) return 'blue';
  if (p >= 50) return 'amber';
  return 'red';
}

export function letterOf(p) {
  if (p === null || p === undefined) return '—';
  if (p >= 85) return 'امتياز';
  if (p >= 75) return 'جيد جداً';
  if (p >= 65) return 'جيد';
  if (p >= 50) return 'مقبول';
  return 'ضعيف';
}

export const DAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
/** Egyptian academic week starts on Saturday. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4];
export const KIND_LABELS = { lecture: 'محاضرة', section: 'سكشن', lab: 'معمل' };
export const KIND_TONES = { lecture: 'blue', section: 'violet', lab: 'amber' };

export function clock12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}

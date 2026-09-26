import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2, X, Inbox, UploadCloud, FileText, AlertTriangle } from 'lucide-react';
import { fileSize } from '../lib/format';

/** clsx + tailwind-merge, so a caller's `w-36` overrides a component's default `w-full`. */
export const cx = (...args) => twMerge(clsx(...args));

// ───────────── Buttons ─────────────
const BTN = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20',
};
const SIZES = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' };

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading, icon: Icon, className, children, as, to, ...props }, ref,
) {
  const classes = cx(
    'inline-flex items-center justify-center rounded-xl font-semibold transition-colors whitespace-nowrap',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50 disabled:pointer-events-none',
    BTN[variant], SIZES[size], className,
  );
  const content = (
    <>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4 shrink-0" /> : null}
      {children}
    </>
  );
  if (to) return <Link ref={ref} to={to} className={classes} {...props}>{content}</Link>;
  if (as === 'a') return <a ref={ref} className={classes} {...props}>{content}</a>;
  return <button ref={ref} className={classes} disabled={loading || props.disabled} {...props}>{content}</button>;
});

export function IconButton({ icon: Icon, label, className, badge, ...props }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('relative inline-flex size-10 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink transition-colors', className)}
      {...props}
    >
      <Icon className="size-5" />
      {badge ? (
        <span className="absolute -top-0.5 -left-0.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center ring-2 ring-surface">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}

// ───────────── Surfaces ─────────────
export function Card({ className, children, ...props }) {
  return <div className={cx('rounded-2xl border border-line bg-surface shadow-sm shadow-slate-900/[0.03]', className)} {...props}>{children}</div>;
}

export function CardHeader({ title, subtitle, action, icon: Icon, className }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 px-5 pt-5 pb-3', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && <div className="size-9 shrink-0 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300 grid place-items-center"><Icon className="size-5" /></div>}
        <div className="min-w-0">
          <h3 className="font-bold text-ink truncate">{title}</h3>
          {subtitle && <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back, children }) {
  return (
    <div className="mb-6">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  blue: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export function Badge({ tone = 'slate', className, children, dot }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = 'blue', to }) {
  const inner = (
    <Card className={cx('p-5 h-full', to && 'hover:border-brand-300 transition-colors')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted font-medium">{label}</p>
          <p className="text-3xl font-extrabold mt-1 text-ink ltr text-right">{value}</p>
          {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
        </div>
        {Icon && <div className={cx('size-11 shrink-0 rounded-2xl grid place-items-center', TONES[tone])}><Icon className="size-5" /></div>}
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function Progress({ value, max = 100, tone = 'blue', className }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = { blue: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', slate: 'bg-slate-400' }[tone];
  return (
    <div className={cx('h-2 rounded-full bg-surface-2 border border-line overflow-hidden', className)}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name = '', size = 'md', className, online }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const sz = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' }[size];
  return (
    <div className={cx('relative shrink-0', className)}>
      <div className={cx('rounded-full grid place-items-center font-bold text-white', sz)} style={{ background: `hsl(${hue} 55% 48%)` }}>
        {initials}
      </div>
      {online !== undefined && (
        <span className={cx('absolute bottom-0 left-0 size-3 rounded-full ring-2 ring-surface', online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')} />
      )}
    </div>
  );
}

// ───────────── Feedback ─────────────
export function Spinner({ className }) {
  return <Loader2 className={cx('size-6 animate-spin text-brand-500', className)} />;
}

export function PageLoader() {
  return <div className="grid place-items-center py-24"><Spinner className="size-8" /></div>;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center text-center py-12 px-6', className)}>
      <div className="size-14 rounded-2xl bg-surface-2 border border-line grid place-items-center text-muted mb-4"><Icon className="size-7" /></div>
      <p className="font-bold text-ink">{title}</p>
      {description && <p className="text-sm text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="تعذر تحميل البيانات"
      description={error?.message}
      action={onRetry && <Button variant="secondary" onClick={() => onRetry()}>إعادة المحاولة</Button>}
    />
  );
}

export function Alert({ tone = 'blue', icon: Icon, title, children, className }) {
  return (
    <div className={cx('flex gap-3 rounded-xl p-4 text-sm', TONES[tone], className)}>
      {Icon && <Icon className="size-5 shrink-0 mt-0.5" />}
      <div>
        {title && <p className="font-bold mb-0.5">{title}</p>}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}

// ───────────── Forms ─────────────
export function Field({ label, hint, error, children, className }) {
  const id = useId();
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="block text-sm font-semibold text-ink mb-1.5">{label}</label>}
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <p className="text-xs text-muted mt-1">{hint}</p>}
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}

const inputCls = 'w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition disabled:opacity-60';

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx(inputCls, 'h-10', className)} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx(inputCls, 'py-2.5 min-h-24 resize-y', className)} {...props} />;
});

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={cx(inputCls, 'h-10 pe-8', className)} {...props}>{children}</select>;
});

export function FileDrop({ file, onChange, accept, label = 'اسحب الملف هنا أو اضغط للاختيار', hint }) {
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onChange(e.dataTransfer.files[0]); }}
      onClick={() => input.current?.click()}
      className={cx(
        'cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
        drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line hover:border-brand-300 bg-surface-2',
      )}
    >
      <input ref={input} type="file" hidden accept={accept} onChange={(e) => onChange(e.target.files[0] || null)} />
      {file ? (
        <div className="flex items-center justify-center gap-3">
          <FileText className="size-8 text-brand-500" />
          <div className="text-right min-w-0">
            <p className="font-semibold text-ink truncate max-w-64">{file.name}</p>
            <p className="text-xs text-muted">{fileSize(file.size)} · اضغط للتغيير</p>
          </div>
          <button type="button" className="p-1 rounded-lg hover:bg-surface text-muted" onClick={(e) => { e.stopPropagation(); onChange(null); }}>
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <>
          <UploadCloud className="size-9 mx-auto text-brand-500 mb-2" />
          <p className="font-semibold text-ink">{label}</p>
          {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
        </>
      )}
    </div>
  );
}

// ───────────── Overlays ─────────────
// Counts open modals so stacked ones (e.g. import result + passwords) never leave the page unscrollable.
let openModals = 0;
function lockScroll(delta) {
  openModals = Math.max(0, openModals + delta);
  document.body.style.overflow = openModals ? 'hidden' : '';
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    lockScroll(1);
    return () => { document.removeEventListener('keydown', onKey); lockScroll(-1); };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" dir="rtl">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cx('relative w-full bg-surface border border-line shadow-2xl rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line">
          <div>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} className="-me-2 -mt-1" />
        </div>
        <div className="px-6 py-5 min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-line flex flex-wrap justify-end gap-2 bg-surface-2 rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'تأكيد', tone = 'danger', loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button variant={tone} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    >
      <p className="text-muted">{message}</p>
    </Modal>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-thin border-b border-line -mx-1 px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'relative flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors',
            value === t.id ? 'text-brand-600 dark:text-brand-300' : 'text-muted hover:text-ink',
          )}
        >
          {t.icon && <t.icon className="size-4" />}
          {t.label}
          {t.badge ? <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] grid place-items-center">{t.badge}</span> : null}
          {value === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, className }) {
  return (
    <div className={cx('inline-flex rounded-xl bg-surface-2 border border-line p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx('px-3 h-8 rounded-lg text-sm font-semibold transition',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ children, className }) {
  return (
    <div className={cx('overflow-x-auto scrollbar-thin', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ className, children, ...p }) => (
  <th className={cx('text-right font-semibold text-muted text-xs px-4 py-3 bg-surface-2 border-b border-line whitespace-nowrap', className)} {...p}>{children}</th>
);
export const Td = ({ className, children, ...p }) => (
  <td className={cx('px-4 py-3 border-b border-line align-middle', className)} {...p}>{children}</td>
);

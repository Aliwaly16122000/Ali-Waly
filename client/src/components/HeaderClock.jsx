import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useApi } from '../lib/useApi';

const time = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const greg = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

/** Live clock with Gregorian + Hijri date and the current week of the term. */
export default function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  const { data: term } = useApi('/calendar/term');
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <Link to="/calendar" className="hidden md:flex items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-surface-2 transition" title="التقويم">
      <div className="text-left leading-tight">
        <p className="text-sm font-bold ltr text-right tabular-nums">{time.format(now)}</p>
        <p className="text-[11px] text-muted">{greg.format(now)} · {hijri.format(now)}</p>
      </div>
      {term?.status === 'running' && (
        <span className="flex items-center gap-1.5 rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 px-2.5 py-1 text-xs font-bold">
          <CalendarDays className="size-3.5" /> الأسبوع {term.week} من {term.weeks}
        </span>
      )}
    </Link>
  );
}

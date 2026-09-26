import { Lock, EyeOff } from 'lucide-react';
import { Button, Card } from './ui';
import { fmtDate } from '../lib/format';

/** Explains why a student can't see something yet (hidden by doctor / survey required). */
export default function LockNotice({ lock, what = 'الدرجات', compact }) {
  if (!lock) return null;
  const survey = lock.reason === 'survey';
  const body = survey
    ? `املأ استبيان "${lock.survey_title}" للمادة دي عشان ${what} تظهرلك.`
    : lock.until ? `الدكتور مخفي ${what} لحد ${fmtDate(`${lock.until}T12:00:00`)}.` : `الدكتور مخفي ${what} حالياً — هيوصلك إشعار أول ما تظهر.`;
  if (compact) return <p className="text-sm text-amber-700 dark:text-amber-300 flex items-center gap-1.5">{survey ? <Lock className="size-4" /> : <EyeOff className="size-4" />}{body}</p>;
  return (
    <Card className="p-6 text-center border-amber-200 dark:border-amber-500/30">
      <div className="size-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 grid place-items-center mb-3">{survey ? <Lock className="size-7" /> : <EyeOff className="size-7" />}</div>
      <p className="font-bold">{survey ? `${what} مقفولة لحد ما تملأ الاستبيان` : `${what} مخفية مؤقتاً`}</p>
      <p className="text-sm text-muted mt-1">{body}</p>
      {survey && <Button className="mt-4" to={`/surveys/${lock.survey_id}/${lock.course_id}`}>املأ الاستبيان (دقيقة واحدة)</Button>}
    </Card>
  );
}

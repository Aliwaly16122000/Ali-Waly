import { Star } from 'lucide-react';
import { num } from '../../lib/format';
import { Card, Progress } from '../../components/ui';

/** Anonymous aggregated survey results: rating means, choice distributions, free text. */
export default function SurveyResults({ data }) {
  const rate = data.expected ? Math.round((data.responses / data.expected) * 100) : 0;
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-48">
          <p className="text-sm text-muted">نسبة المشاركة</p>
          <p className="text-2xl font-extrabold">{data.responses} <span className="text-base text-muted font-normal">من {data.expected} طالب</span></p>
        </div>
        <div className="w-48"><Progress value={rate} tone={rate >= 60 ? 'green' : rate >= 30 ? 'amber' : 'red'} /><p className="text-xs text-muted mt-1 ltr text-right">{rate}%</p></div>
      </Card>
      {data.results.map((q) => (
        <Card key={q.id} className="p-4">
          <p className="font-bold mb-2">{q.text}</p>
          {q.type === 'rating' && (
            <div className="flex flex-wrap items-center gap-6">
              <div className="text-center">
                <p className="text-3xl font-extrabold ltr">{q.mean === null ? '—' : num(q.mean, 1)}</p>
                <div className="flex gap-0.5 justify-center">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`size-4 ${q.mean >= n - 0.25 ? 'fill-amber-400 text-amber-400' : 'text-line'}`} />)}</div>
              </div>
              <div className="flex-1 min-w-48 space-y-1">
                {[...q.distribution].reverse().map((d) => (
                  <div key={d.value} className="flex items-center gap-2 text-xs"><span className="w-3">{d.value}</span><Progress value={d.count} max={q.count || 1} className="flex-1" /><span className="w-8 text-muted">{d.count}</span></div>
                ))}
              </div>
            </div>
          )}
          {q.type === 'choice' && (
            <div className="space-y-1.5">
              {q.distribution.map((d) => (
                <div key={d.value} className="flex items-center gap-2 text-sm"><span className="w-28 truncate">{d.value}</span><Progress value={d.count} max={q.count || 1} className="flex-1" /><span className="w-16 text-muted text-xs">{d.count} ({q.count ? Math.round((d.count / q.count) * 100) : 0}%)</span></div>
              ))}
            </div>
          )}
          {q.type === 'text' && (
            q.texts.length ? <ul className="space-y-1.5 max-h-64 overflow-y-auto">{q.texts.map((t, i) => <li key={i} className="text-sm rounded-lg bg-surface-2 px-3 py-2">"{t}"</li>)}</ul>
              : <p className="text-sm text-muted">لا توجد ردود نصية</p>
          )}
        </Card>
      ))}
    </div>
  );
}

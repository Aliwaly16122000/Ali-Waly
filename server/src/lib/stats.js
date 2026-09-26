/** Descriptive statistics for a list of numeric scores. */
export function describe(values, max) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return { count: 0, mean: null, median: null, min: null, max: null, std: null, pass_rate: null };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
  const std = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const pass = max ? xs.filter((x) => x / max >= 0.5).length / n : null;
  return { count: n, mean: round(mean), median: round(median), min: xs[0], max: xs[n - 1], std: round(std), pass_rate: pass === null ? null : round(pass * 100) };
}

/** Buckets percentages into 10-point bins: 0-9, 10-19, …, 90-100. */
export function histogram(values, max) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i === 9 ? 100 : i * 10 + 9}`, count: 0 }));
  for (const v of values) {
    if (typeof v !== 'number') continue;
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    bins[Math.min(9, Math.floor(pct / 10))].count += 1;
  }
  return bins;
}

/** Egyptian university grading scale. */
export function letterGrade(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct >= 85) return 'امتياز';
  if (pct >= 75) return 'جيد جداً';
  if (pct >= 65) return 'جيد';
  if (pct >= 50) return 'مقبول';
  if (pct >= 30) return 'ضعيف';
  return 'ضعيف جداً';
}

export const LETTERS = ['امتياز', 'جيد جداً', 'جيد', 'مقبول', 'ضعيف', 'ضعيف جداً'];

export const round = (x, d = 2) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

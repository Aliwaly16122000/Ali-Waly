import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, Cell, ReferenceLine,
} from 'recharts';

/*
 * Thin wrappers around Recharts with one consistent look: a single brand hue per chart
 * (every chart here is one series, so the title names it and no legend is needed),
 * a recessive grid, 4px rounded bar ends and a tooltip on every mark.
 */
const BRAND = '#3b64f5';
const axis = { stroke: 'var(--muted)', fontSize: 12, tickLine: false, axisLine: false };

function TooltipBox({ active, payload, label, format, labelFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-lg text-sm" dir="rtl">
      <p className="text-muted text-xs mb-0.5">{labelFormat ? labelFormat(label, payload[0].payload) : label}</p>
      <p className="font-bold text-ink">{format ? format(payload[0].value, payload[0].payload) : payload[0].value}</p>
    </div>
  );
}

export function BarsChart({ data, x, y, height = 260, format, labelFormat, yDomain, colorFor, refLine, layout = 'horizontal' }) {
  const vertical = layout === 'vertical';
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: vertical ? 8 : -16, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={vertical} horizontal={!vertical} />
          {vertical ? (
            <>
              <XAxis type="number" {...axis} domain={yDomain} />
              <YAxis type="category" dataKey={x} {...axis} width={110} orientation="right" />
            </>
          ) : (
            <>
              <XAxis dataKey={x} {...axis} interval={0} />
              <YAxis {...axis} domain={yDomain} allowDecimals={false} />
            </>
          )}
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<TooltipBox format={format} labelFormat={labelFormat} />} />
          {refLine !== undefined && <ReferenceLine {...(vertical ? { x: refLine } : { y: refLine })} stroke="var(--muted)" strokeDasharray="4 4" />}
          <Bar dataKey={y} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={44} fill={BRAND}>
            {colorFor && data.map((d, i) => <Cell key={i} fill={colorFor(d)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ data, x, y, height = 240, format, yDomain = [0, 100] }) {
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
              <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey={x} {...axis} />
          <YAxis {...axis} domain={yDomain} />
          <Tooltip cursor={{ stroke: 'var(--muted)', strokeDasharray: '4 4' }} content={<TooltipBox format={format} />} />
          <Area type="monotone" dataKey={y} stroke={BRAND} strokeWidth={2} fill="url(#trendFill)"
            dot={{ r: 4, fill: BRAND, stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 6, stroke: 'var(--surface)', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sequential single-hue ramp (light → dark) for ordered buckets such as grade bands. */
export const SEQ = ['#1e3a8a', '#1d4ed8', '#3b64f5', '#608bfa', '#93b4fd', '#bfd3fe'];

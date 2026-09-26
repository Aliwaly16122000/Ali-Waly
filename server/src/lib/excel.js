import ExcelJS from 'exceljs';

/** Plain value of an ExcelJS cell (rich text, formulas and hyperlinks flattened). */
export function cellValue(c) {
  const v = c.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
  return v;
}

/** Reads every visible sheet of a workbook buffer/file into { sheet, row, values{header: value} } records. */
export async function readSheets(filePath, { skip = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const out = {};
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible' || skip.includes(ws.name.trim())) continue;
    const header = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = String(cellValue(c)).replace(/\*/g, '').trim(); });
    const rows = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const values = {};
      row.eachCell({ includeEmpty: true }, (c, i) => { if (header[i]) values[header[i]] = cellValue(c); });
      if (Object.values(values).some((v) => v !== '' && v !== null)) rows.push({ row: n, values });
    });
    out[ws.name.trim()] = rows;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

/** Accepts an Excel date, "2027-01-12", "12/1/2027" or "12-1-2027" → "2027-01-12". */
export function parseDate(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const t = String(v ?? '').trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

/** Accepts an Excel time, "9:00", "13:30", "9:00 م"/"9 PM" → "HH:MM". */
export function parseTime(v) {
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v < 1) { const mins = Math.round(v * 1440); return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }
  const t = String(v ?? '').trim();
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(ص|م|am|pm|AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const suffix = (m[3] || '').toLowerCase();
  if ((suffix === 'م' || suffix === 'pm') && h < 12) h += 12;
  if ((suffix === 'ص' || suffix === 'am') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

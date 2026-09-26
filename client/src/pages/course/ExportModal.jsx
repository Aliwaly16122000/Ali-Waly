import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Alert, Button, Modal } from '../../components/ui';

export default function ExportModal({ open, onClose, courseId, hasScheme, onConfigure }) {
  const [opts, setOpts] = useState({ raw: true, attendance: true, stats: true });
  const qs = Object.entries(opts).map(([k, v]) => `${k}=${v ? 1 : 0}`).join('&');
  const items = [
    ['raw', 'درجة كل تقييم', 'عمود لكل شيت وكويز وميدترم'],
    ['attendance', 'الحضور', 'عدد المحاضرات ونسبة الحضور'],
    ['stats', 'شيت إحصائيات', 'المتوسط والوسيط وأعلى وأقل ونسبة النجاح لكل تقييم'],
  ];
  return (
    <Modal open={open} onClose={onClose} title="تصدير الدرجات إلى Excel" subtitle="ملف .xlsx منسّق بالعربي وجاهز للطباعة"
      footer={<>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button as="a" href={`/api/courses/${courseId}/gradebook.xlsx?${qs}`} icon={Download} onClick={() => setTimeout(onClose, 300)}>تحميل الملف</Button>
      </>}>
      {!hasScheme && (
        <Alert tone="amber" icon={FileSpreadsheet} className="mb-4" title="لم يتم تحديد توزيع الدرجات">
          الملف هيجمع كل الدرجات كما هي. لو عايز تحدد كل بند بكام (الشيتات من 10، الميدترم من 20، الحضور من 10…)
          <button className="underline font-semibold mr-1" onClick={() => { onClose(); onConfigure(); }}>اضبط التوزيع الأول</button>
        </Alert>
      )}
      <div className="space-y-2">
        {items.map(([k, t, d]) => (
          <label key={k} className="flex items-start gap-3 rounded-xl border border-line p-3 cursor-pointer hover:bg-surface-2">
            <input type="checkbox" className="size-4 mt-1 accent-brand-600" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
            <div><p className="font-semibold">{t}</p><p className="text-xs text-muted">{d}</p></div>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted mt-4">
        {hasScheme ? 'بنود التوزيع والمجموع النهائي والتقدير بيتضافوا دايماً. ' : ''}
        المجموع والنسبة والتقدير معمولين كمعادلات Excel — لو عدّلت أي درجة في الملف المجموع بيتحدث لوحده.
      </p>
    </Modal>
  );
}

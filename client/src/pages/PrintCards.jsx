import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, Trash2 } from 'lucide-react';
import { useBranding } from '../context/BrandingContext';
import { LEVEL_LABELS, ROLE_LABELS } from '../lib/format';
import { clearCards, readCards } from '../lib/cards';
import { Button } from '../components/ui';

/**
 * Printable login cards (8 per A4 page): name, username, temporary password and a QR that
 * opens the portal with the username pre-filled. Cut along the dashed lines and hand out.
 */
export default function PrintCards() {
  const brand = useBranding();
  const [cards, setCards] = useState([]);
  useEffect(() => { setCards(readCards()); }, []);
  // The session copy is the only place these passwords exist — ask before leaving.
  useEffect(() => {
    const warn = (e) => { if (cards.length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [cards.length]);

  const site = window.location.origin;
  const discard = () => { clearCards(); setCards([]); };

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white" dir="rtl">
      <style>{`
        @page { size: A4; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .sheet { width: auto !important; box-shadow: none !important; padding: 0 !important; }
        }
        .card { break-inside: avoid; page-break-inside: avoid; }
      `}</style>
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <p className="font-bold text-slate-900">كروت الدخول · {cards.length} كارت</p>
        <p className="text-sm text-slate-500 flex-1">اطبعها وقصّها على الخطوط، وكل طالب ياخد الكارت بتاعه بس. كلمات السر دي مش هتظهر تاني.</p>
        <Button icon={Printer} onClick={() => window.print()} disabled={!cards.length}>طباعة</Button>
        <Button variant="secondary" icon={Trash2} onClick={discard} disabled={!cards.length}>مسح من الصفحة</Button>
      </div>
      {!cards.length ? (
        <p className="text-center text-slate-500 py-24">مفيش كروت للطباعة — اعملها من صفحة المستخدمين أو من إدارة المادة.</p>
      ) : (
        <div className="sheet mx-auto my-6 bg-white shadow p-[8mm]" style={{ width: '210mm' }}>
          <div className="grid grid-cols-2">
            {cards.map((c) => (
              <div key={c.username} className="card border border-dashed border-slate-400 p-3 flex gap-3 text-slate-900" style={{ height: '66mm' }}>
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                    {brand.logo_url ? <img src={brand.logo_url} alt="" className="size-8 object-contain" /> : <img src="/icon.svg" alt="" className="size-8" />}
                    <div className="leading-tight min-w-0">
                      <p className="text-[11px] font-bold truncate">{brand.faculty}</p>
                      <p className="text-[9px] text-slate-500 truncate">{brand.university}</p>
                    </div>
                  </div>
                  <p className="font-extrabold text-[13px] mt-2 leading-snug line-clamp-2">{c.name}</p>
                  <p className="text-[9px] text-slate-500 truncate">
                    {c.role === 'student' ? [c.department_name, LEVEL_LABELS[c.level], c.section].filter(Boolean).join(' · ') : ROLE_LABELS[c.role] || ''}
                  </p>
                  <div className="mt-auto space-y-1">
                    <div className="flex items-center justify-between rounded bg-slate-100 px-2 py-1">
                      <span className="text-[9px] text-slate-500">اسم المستخدم</span>
                      <span className="font-mono font-bold text-[13px]" dir="ltr">{c.username}</span>
                    </div>
                    <div className="flex items-center justify-between rounded bg-slate-100 px-2 py-1">
                      <span className="text-[9px] text-slate-500">كلمة السر المؤقتة</span>
                      <span className="font-mono font-bold text-[13px] tracking-wider" dir="ltr">{c.password}</span>
                    </div>
                  </div>
                </div>
                <div className="w-[30mm] flex flex-col items-center justify-between text-center">
                  <QRCodeSVG value={`${site}/login?u=${encodeURIComponent(c.username)}`} size={100} level="M" className="w-[28mm] h-[28mm]" />
                  <p className="text-[8px] text-slate-600 leading-snug">
                    امسح الكود بالموبايل<br />سجّل دخول وغيّر كلمة السر<br />ثم "إضافة للشاشة الرئيسية"
                  </p>
                  <p className="text-[8px] font-mono text-slate-500 break-all" dir="ltr">{site.replace(/^https?:\/\//, '')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

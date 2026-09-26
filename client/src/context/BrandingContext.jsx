import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const BrandingContext = createContext({ university: '', faculty: 'كلية الهندسة', logo_url: null, refresh: () => {} });

/** University/faculty name and logo, configured by admin and shown across the app. */
export function BrandingProvider({ children }) {
  const [brand, setBrand] = useState({ university: '', faculty: 'كلية الهندسة', logo_url: null });
  const refresh = useCallback(() => api.get('/branding').then(setBrand).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    document.title = [brand.faculty, brand.university].filter(Boolean).join(' - ') || 'بوابة كلية الهندسة';
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = brand.logo_url || '/icon.svg';
  }, [brand]);

  return <BrandingContext.Provider value={{ ...brand, refresh, setBrand }}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);

/** The uploaded logo, or the default app icon. */
export function Logo({ className = 'size-9' }) {
  const { logo_url: url } = useBranding();
  return url
    ? <img src={url} alt="" className={`${className} object-contain`} />
    : <img src="/icon.svg" alt="" className={className} />;
}

export function BrandTitle({ className, sub = true }) {
  const { university, faculty } = useBranding();
  return (
    <div className={`leading-tight min-w-0 ${className || ''}`}>
      <p className="font-extrabold text-ink truncate">{faculty || 'بوابة الهندسة'}</p>
      {sub && <p className="text-[11px] text-muted truncate">{university || 'Faculty of Engineering'}</p>}
    </div>
  );
}

const KEY = 'engportal_device_id';

/**
 * A random id stored on this phone. The server binds a student's account to the first
 * phone they check in from, so attendance can't be recorded from a friend's phone.
 */
export function deviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (ua.match(/Android[^;)]*;\s*([^;)]+)/)?.[1] || 'Android') : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'جهاز';
  return os.trim().slice(0, 60);
}

/** Current GPS position (high accuracy). */
export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('المتصفح لا يدعم تحديد الموقع'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(err.code === 1
        ? 'لازم تسمح للتطبيق بالوصول لموقعك (من إعدادات المتصفح) عشان تسجل الحضور في المادة دي'
        : 'تعذر تحديد موقعك — فعّل الـ GPS وحاول تاني')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

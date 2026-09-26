import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetches `url` on mount / when it changes. Returns { data, error, loading, reload, setData }. */
export function useApi(url, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!url && enabled });
  const active = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!url || !enabled) return;
    const token = ++active.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(url);
      if (token === active.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (token === active.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [url, enabled]);

  useEffect(() => { load(); }, [load]);

  const setData = useCallback((updater) => setState((s) => ({
    ...s, data: typeof updater === 'function' ? updater(s.data) : updater,
  })), []);

  return { ...state, reload: load, setData };
}

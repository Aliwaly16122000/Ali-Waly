import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';
import { registerServiceWorker } from '../lib/push';

const RealtimeContext = createContext(null);

/**
 * Owns the Socket.IO connection and the app-wide unread counters. Pages subscribe to
 * live events through `on(event, handler)`.
 */
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const activeConversation = useRef(null);

  const refreshCounts = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([api.get('/notifications?limit=1'), api.get('/chat/unread-count')]);
      setUnreadNotifications(n.unread);
      setUnreadMessages(m.count);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    registerServiceWorker();
    refreshCounts();
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); refreshCounts(); });
    socket.on('disconnect', () => setConnected(false));

    socket.on('notification', (n) => {
      setUnreadNotifications((c) => c + 1);
      toast(n.title, {
        description: n.body,
        action: n.link ? { label: 'عرض', onClick: () => navigate(n.link) } : undefined,
      });
    });

    socket.on('message:new', (m) => {
      if (m.sender_id === user.id) return;
      if (activeConversation.current === m.conversation_id && document.visibilityState === 'visible') return;
      setUnreadMessages((c) => c + 1);
      toast(`رسالة من ${m.sender_name}`, {
        description: m.body || '📎 ملف مرفق',
        action: { label: 'رد', onClick: () => navigate(`/chat/${m.conversation_id}`) },
      });
    });

    const onVisible = () => document.visibilityState === 'visible' && refreshCounts();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, navigate, refreshCounts]);

  const on = useCallback((event, handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on(event, handler);
    return () => s.off(event, handler);
  }, []);

  const emit = useCallback((event, payload) => socketRef.current?.emit(event, payload), []);

  const value = useMemo(() => ({
    connected, on, emit, refreshCounts,
    unreadNotifications, setUnreadNotifications,
    unreadMessages, setUnreadMessages,
    setActiveConversation: (id) => { activeConversation.current = id; },
  }), [connected, on, emit, refreshCounts, unreadNotifications, unreadMessages]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Subscribes to a socket event for the lifetime of the component. */
export function useSocketEvent(event, handler) {
  const { on, connected } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => on(event, (payload) => ref.current(payload)), [on, event, connected]);
}

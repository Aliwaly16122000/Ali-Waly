import { Server } from 'socket.io';
import { COOKIE_NAME, userFromToken } from './auth.js';

let io = null;

function parseCookie(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}
const online = new Map(); // userId -> number of open sockets

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: false } });

  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie || '');
    const user = userFromToken(cookies[COOKIE_NAME]);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { id } = socket.data.user;
    socket.join(`user:${id}`);
    online.set(id, (online.get(id) || 0) + 1);

    socket.on('typing', ({ to, conversationId } = {}) => {
      if (Number.isInteger(to)) io.to(`user:${to}`).emit('typing', { conversationId, from: id });
    });

    socket.on('disconnect', () => {
      const n = (online.get(id) || 1) - 1;
      if (n <= 0) online.delete(id);
      else online.set(id, n);
    });
  });

  return io;
}

export function emitTo(userIds, event, payload) {
  if (!io) return;
  for (const uid of [].concat(userIds)) io.to(`user:${uid}`).emit(event, payload);
}

export const isOnline = (userId) => online.has(userId);

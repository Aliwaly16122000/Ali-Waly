import webpush from 'web-push';
import db, { getSetting } from '../db.js';
import { emitTo } from './realtime.js';
import { PUSH_SUBJECT } from '../config.js';

const vapid = JSON.parse(
  getSetting('vapid_keys', () => JSON.stringify(webpush.generateVAPIDKeys())),
);
webpush.setVapidDetails(PUSH_SUBJECT, vapid.publicKey, vapid.privateKey);

export const VAPID_PUBLIC_KEY = vapid.publicKey;

const insertStmt = db.prepare(
  'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)',
);
const subsStmt = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
const dropSubStmt = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');

/**
 * Stores an in-app notification for each user, pushes it live over the socket,
 * and delivers a Web Push message to every browser the user subscribed.
 */
export function notify(userIds, { type, title, body = null, link = null }) {
  const ids = [...new Set([].concat(userIds))].filter(Boolean);
  if (!ids.length) return;

  const created = db.transaction(() =>
    ids.map((uid) => {
      const { lastInsertRowid } = insertStmt.run(uid, type, title, body, link);
      return { uid, notification: { id: Number(lastInsertRowid), type, title, body, link, is_read: 0, created_at: new Date().toISOString() } };
    }),
  )();

  for (const { uid, notification } of created) {
    emitTo(uid, 'notification', notification);
    const payload = JSON.stringify({ title, body, link, tag: `${type}-${notification.id}` });
    for (const sub of subsStmt.all(uid)) sendPush(sub, payload).catch(() => {});
  }
}

/**
 * Sends one Web Push. High urgency so phones in battery-saving mode deliver it right away
 * instead of batching it for later; expired subscriptions are removed.
 */
export async function sendPush(sub, payload) {
  try {
    const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
      { TTL: 24 * 3600, urgency: 'high' });
    return { ok: true, status: res.statusCode };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) dropSubStmt.run(sub.id);
    else console.warn(`[push] ${new URL(sub.endpoint).host} → ${err.statusCode || err.code || err.message} ${String(err.body || '').slice(0, 200)}`);
    throw err;
  }
}

/** Pushes a test notification to every browser `userId` subscribed; reports what each push service answered. */
export async function testPush(userId) {
  const subs = subsStmt.all(userId);
  const payload = JSON.stringify({ title: '🔔 إشعار تجريبي', body: 'الإشعارات شغالة على الجهاز ده ✅', link: '/profile', tag: `test-${Date.now()}` });
  return Promise.all(subs.map((sub) => sendPush(sub, payload)
    .then((r) => ({ service: new URL(sub.endpoint).host, ok: true, status: r.status }))
    .catch((err) => ({ service: new URL(sub.endpoint).host, ok: false, status: err.statusCode || null, error: String(err.body || err.message).slice(0, 200) }))));
}

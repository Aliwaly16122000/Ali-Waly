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
    for (const sub of subsStmt.all(uid)) {
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 })
        .catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) dropSubStmt.run(sub.id);
        });
    }
  }
}

import bcrypt from 'bcryptjs';
import db from './db.js';

/** On a brand-new database, create the first admin so the system can be set up from the UI. */
export function ensureAdmin() {
  const hasUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (hasUsers) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare(`INSERT INTO users (name, username, role, password_hash, must_change_password) VALUES (?, ?, 'admin', ?, 1)`)
    .run('مدير النظام', username, bcrypt.hashSync(password, 10));
  console.log(`👤 Created initial admin account: ${username} / ${password} (change it after first login)`);
}

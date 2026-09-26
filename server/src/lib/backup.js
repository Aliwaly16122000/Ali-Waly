import fs from 'node:fs';
import path from 'node:path';
import db, { getSetting, setSetting } from '../db.js';
import { DATA_DIR } from '../config.js';
import { localNow } from './clock.js';

export const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(DATA_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const NAME_RE = /^engportal-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/;

/** Consistent online snapshot of the database (safe while the app is running). */
export async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const file = path.join(BACKUP_DIR, `engportal-${stamp}.db`);
  await db.backup(file);
  prune();
  const { size } = fs.statSync(file);
  return { name: path.basename(file), size, created_at: new Date().toISOString() };
}

function prune() {
  const files = listBackups();
  for (const f of files.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, f.name), { force: true });
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function backupPath(name) {
  if (!NAME_RE.test(name)) return null;
  const file = path.join(BACKUP_DIR, name);
  return fs.existsSync(file) ? file : null;
}

/** Called every minute by the scheduler: one backup per day, after 3 AM local time. */
export async function dailyBackup() {
  const now = localNow();
  if (now.minutes < 3 * 60 || getSetting('last_backup_date') === now.date) return;
  setSetting('last_backup_date', now.date);
  const b = await runBackup();
  console.log(`💾 Daily backup: ${b.name}`);
}

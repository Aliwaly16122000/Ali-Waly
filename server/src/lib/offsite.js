import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import nodemailer from 'nodemailer';
import { DATA_DIR } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { localNow } from './clock.js';
import { BACKUP_DIR, runBackup } from './backup.js';

/**
 * Weekly copy of the database sent by email, so a lost server doesn't take every backup
 * with it. Mail settings live in a file next to the database (not inside it), so the
 * mailbox password never ends up in the backups themselves.
 */
const CONFIG_FILE = path.join(DATA_DIR, 'offsite-email.json');
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function readOffsite() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { enabled: false, host: 'smtp.gmail.com', port: 465, user: '', pass: '', to: '', weekday: 5 };
  }
}

export function writeOffsite(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Settings for the admin screen: everything but the password. */
export function publicOffsite() {
  const { pass, ...rest } = readOffsite();
  return { ...rest, has_password: !!pass, last_sent: getSetting('offsite_last_sent') || null, last_error: getSetting('offsite_last_error') || null };
}

/** Snapshots the database now, gzips it and mails it. Throws with a readable message on failure. */
export async function sendOffsiteBackup(cfg = readOffsite()) {
  if (!cfg.user || !cfg.pass || !cfg.to) throw new Error('كمّل بيانات الإيميل الأول (الإيميل المرسل وكلمة سر التطبيق والإيميل المستلم)');
  const backup = await runBackup();
  const gz = zlib.gzipSync(fs.readFileSync(path.join(BACKUP_DIR, backup.name)));
  const transport = nodemailer.createTransport({
    host: cfg.host || 'smtp.gmail.com', port: Number(cfg.port) || 465, secure: Number(cfg.port || 465) === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  const day = localNow().date;
  try {
    await transport.sendMail({
      from: `بوابة الكلية <${cfg.user}>`,
      to: cfg.to,
      subject: `نسخة احتياطية من بوابة الكلية - ${day}`,
      text: [
        'دي النسخة الاحتياطية الأسبوعية لقاعدة بيانات البوابة (المستخدمين، المواد، الدرجات، الحضور، الرسائل).',
        'احتفظ بالإيميل ده. لو السيرفر اتعطل، النسخة دي بترجّع كل البيانات.',
        '',
        `الملف: ${backup.name}.gz (${Math.round(gz.length / 1024)} KB)`,
        'ملحوظة: الملفات المرفوعة (PDF وغيرها) مش جوه النسخة دي — هي على السيرفر.',
      ].join('\n'),
      attachments: [{ filename: `${backup.name}.gz`, content: gz }],
    });
  } catch (err) {
    const msg = err.responseCode === 535 || /auth|Username and Password/i.test(err.message)
      ? 'الإيميل أو كلمة سر التطبيق غلط (لازم App Password من إعدادات جوجل مش كلمة سر الإيميل العادية)'
      : `فشل الإرسال: ${err.message}`;
    setSetting('offsite_last_error', `${day}: ${msg}`);
    throw new Error(msg);
  }
  setSetting('offsite_last_sent', new Date().toISOString());
  setSetting('offsite_last_error', '');
  return { name: `${backup.name}.gz`, size: gz.length, to: cfg.to };
}

/** Called every minute: once on the chosen weekday, after 4 AM local time. */
export async function weeklyOffsite(onFail) {
  const cfg = readOffsite();
  const now = localNow();
  if (!cfg.enabled || now.dow !== Number(cfg.weekday) || now.minutes < 4 * 60) return;
  if (getSetting('offsite_last_date') === now.date) return;
  setSetting('offsite_last_date', now.date);
  try {
    const r = await sendOffsiteBackup(cfg);
    console.log(`📧 Weekly backup emailed to ${r.to}`);
  } catch (err) {
    console.error('weekly backup email failed:', err.message);
    onFail?.(err.message);
  }
}

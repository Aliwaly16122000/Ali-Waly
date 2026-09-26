import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR, MAX_UPLOAD_MB } from '../config.js';
import { badRequest, notFound } from './http.js';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BLOCKED_EXT = new Set(['.exe', '.bat', '.cmd', '.sh', '.msi', '.com', '.scr', '.js', '.html', '.htm', '.svg']);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Browsers send multipart filenames as latin1; restore UTF-8 so Arabic names survive.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(badRequest('نوع الملف غير مسموح'));
    cb(null, true);
  },
});

export const storedName = (file) => (file ? path.basename(file.path) : null);

export function removeUpload(name) {
  if (!name) return;
  fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(name))).catch(() => {});
}

export function sendUpload(res, name, downloadName) {
  if (!name) throw notFound('لا يوجد ملف');
  const full = path.join(UPLOAD_DIR, path.basename(name));
  if (!fs.existsSync(full)) throw notFound('الملف غير موجود');
  res.download(full, downloadName || name, { headers: { 'X-Content-Type-Options': 'nosniff' } });
}

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getSetting, setSetting } from '../db.js';
import { parse, badRequest, notFound } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { upload, storedName, removeUpload } from '../lib/upload.js';
import { UPLOAD_DIR } from '../config.js';

/**
 * Institution identity shown across the app (login page, sidebar, projector QR screen,
 * browser tab): university + faculty name and an uploaded logo. Public, since the login
 * page needs it before anyone signs in.
 */
const router = Router();
const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function branding() {
  const logo = getSetting('brand_logo');
  return {
    university: getSetting('brand_university') || '',
    faculty: getSetting('brand_faculty') || 'كلية الهندسة',
    logo_url: logo ? `/api/branding/logo?v=${encodeURIComponent(logo)}` : null,
  };
}

router.get('/', (_req, res) => res.json(branding()));

router.get('/logo', (_req, res) => {
  const logo = getSetting('brand_logo');
  const file = logo && path.join(UPLOAD_DIR, path.basename(logo));
  if (!file || !fs.existsSync(file)) throw notFound();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type(LOGO_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.sendFile(file);
});

router.put('/', requireAuth, requireRole('admin'), (req, res) => {
  const b = parse(z.object({
    university: z.string().trim().max(80).default(''),
    faculty: z.string().trim().min(2, 'اكتب اسم الكلية').max(80),
  }), req.body);
  setSetting('brand_university', b.university);
  setSetting('brand_faculty', b.faculty);
  res.json(branding());
});

router.post('/logo', requireAuth, requireRole('admin'), upload.single('logo'), (req, res) => {
  const ext = req.file && path.extname(req.file.originalname).toLowerCase();
  if (!req.file || !LOGO_TYPES[ext]) {
    removeUpload(storedName(req.file));
    throw badRequest('ارفع صورة PNG أو JPG أو WEBP');
  }
  if (req.file.size > 2 * 1024 * 1024) {
    removeUpload(storedName(req.file));
    throw badRequest('حجم اللوجو لازم يكون أقل من 2 ميجا');
  }
  const previous = getSetting('brand_logo');
  setSetting('brand_logo', storedName(req.file));
  if (previous) removeUpload(previous);
  res.json(branding());
});

router.delete('/logo', requireAuth, requireRole('admin'), (_req, res) => {
  const previous = getSetting('brand_logo');
  setSetting('brand_logo', '');
  if (previous) removeUpload(previous);
  res.json(branding());
});

export default router;

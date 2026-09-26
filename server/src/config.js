import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const CLIENT_DIST = path.resolve(ROOT_DIR, '..', 'client', 'dist');
export const PORT = Number(process.env.PORT) || 4000;
export const IS_PROD = process.env.NODE_ENV === 'production';
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 20;
export const PUSH_SUBJECT = process.env.PUSH_SUBJECT || 'mailto:admin@engportal.local';
export const TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Cairo';

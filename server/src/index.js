import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import './db.js';
import { ensureAdmin } from './bootstrap.js';
import { PORT, CLIENT_DIST, IS_PROD, MAX_UPLOAD_MB } from './config.js';
import { requireAuth } from './lib/auth.js';
import { initRealtime } from './lib/realtime.js';
import { startScheduler } from './lib/scheduler.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import courseRoutes, { postsRouter } from './routes/courses.js';
import assessmentRoutes, { courseAssessments, submissionsRouter } from './routes/assessments.js';
import gradeRoutes from './routes/grades.js';
import attendanceRoutes, { courseAttendance } from './routes/attendance.js';
import chatRoutes, { messagesRouter } from './routes/chat.js';
import notificationRoutes from './routes/notifications.js';
import dashboardRoutes from './routes/dashboard.js';
import scheduleRoutes, { courseSchedule } from './routes/schedule.js';
import calendarRoutes from './routes/calendar.js';
import examRoutes from './routes/exams.js';
import brandingRoutes from './routes/branding.js';
import oversightRoutes from './routes/oversight.js';
import surveyRoutes from './routes/surveys.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const api = express.Router();
api.get('/health', (_req, res) => res.json({ ok: true }));
api.use('/auth', authRoutes);
api.use('/branding', brandingRoutes);
api.use(requireAuth);
api.use('/admin', adminRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/courses/:courseId/assessments', courseAssessments);
api.use('/courses/:courseId/attendance', courseAttendance);
api.use('/courses/:courseId/schedule', courseSchedule);
api.use('/courses/:courseId', gradeRoutes);
api.use('/courses', courseRoutes);
api.use('/posts', postsRouter);
api.use('/assessments', assessmentRoutes);
api.use('/submissions', submissionsRouter);
api.use('/attendance', attendanceRoutes);
api.use('/schedule', scheduleRoutes);
api.use('/calendar', calendarRoutes);
api.use('/exams', examRoutes);
api.use('/oversight', oversightRoutes);
api.use('/surveys', surveyRoutes);
api.use('/chat', chatRoutes);
api.use('/messages', messagesRouter);
api.use('/notifications', notificationRoutes);
api.use((_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));
app.use('/api', api);

// Serve the built React app in production (single deployable).
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: IS_PROD ? '1h' : 0 }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `حجم الملف أكبر من ${MAX_UPLOAD_MB} ميجا` : 'خطأ في رفع الملف';
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بيانات غير صالحة' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ ...(status < 500 && err.extra), error: status >= 500 ? 'حدث خطأ غير متوقع في الخادم' : err.message });
});

ensureAdmin();

const server = http.createServer(app);
initRealtime(server);
startScheduler();
server.listen(PORT, () => console.log(`🎓 EngPortal running on http://localhost:${PORT}`));

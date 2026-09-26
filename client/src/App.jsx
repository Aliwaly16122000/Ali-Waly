import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { RealtimeProvider } from './context/RealtimeContext';
import Layout from './components/Layout';
import { PageLoader } from './components/ui';
import Login from './pages/Login';
import ForceChangePassword from './pages/ForceChangePassword';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseDetail = lazy(() => import('./pages/CourseDetail'));
const AssessmentDetail = lazy(() => import('./pages/AssessmentDetail'));
const AttendanceLive = lazy(() => import('./pages/AttendanceLive'));
const Scan = lazy(() => import('./pages/Scan'));
const Chat = lazy(() => import('./pages/Chat'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const AdminDepartments = lazy(() => import('./pages/admin/Departments'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminCourses = lazy(() => import('./pages/admin/Courses'));
const AdminCourseManage = lazy(() => import('./pages/admin/CourseManage'));
const AdminBroadcast = lazy(() => import('./pages/admin/Broadcast'));
const AdminSystem = lazy(() => import('./pages/admin/System'));
const MySchedule = lazy(() => import('./pages/MySchedule'));
const StartSlotAttendance = lazy(() => import('./pages/StartSlotAttendance'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Exams = lazy(() => import('./pages/Exams'));
const AdminExams = lazy(() => import('./pages/admin/Exams'));
const Oversight = lazy(() => import('./pages/Oversight'));
const PrintCards = lazy(() => import('./pages/PrintCards'));
const AdminFaculties = lazy(() => import('./pages/admin/Faculties'));
const AdminSurveys = lazy(() => import('./pages/admin/Surveys'));
const SurveyList = lazy(() => import('./pages/surveys/Student').then((m) => ({ default: m.SurveyList })));
const SurveyForm = lazy(() => import('./pages/surveys/Student').then((m) => ({ default: m.SurveyForm })));

function Protected({ roles, children }) {
  const { user } = useAuth();
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <div className="min-h-screen grid place-items-center"><PageLoader /></div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    );
  }
  if (user.must_change_password) return <ForceChangePassword />;

  return (
    <RealtimeProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Navigate to={location.state?.from || '/'} replace />} />
          <Route path="/print/cards" element={<Protected roles={['admin']}><PrintCards /></Protected>} />
          <Route path="/attendance/:id/live" element={<Protected roles={['doctor', 'ta', 'admin']}><AttendanceLive /></Protected>} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="courses" element={<Courses />} />
            <Route path="courses/:id" element={<CourseDetail />} />
            <Route path="courses/:courseId/assessments/:id" element={<AssessmentDetail />} />
            <Route path="scan" element={<Protected roles={['student']}><Scan /></Protected>} />
            <Route path="attend" element={<Protected roles={['student']}><Scan /></Protected>} />
            <Route path="chat" element={<Protected roles={['student', 'ta', 'doctor', 'admin']}><Chat /></Protected>} />
            <Route path="chat/:id" element={<Protected roles={['student', 'ta', 'doctor', 'admin']}><Chat /></Protected>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="surveys" element={<Protected roles={['student']}><SurveyList /></Protected>} />
            <Route path="surveys/:id/:courseId" element={<Protected roles={['student']}><SurveyForm /></Protected>} />
            <Route path="admin/surveys" element={<Protected roles={['admin']}><AdminSurveys /></Protected>} />
            <Route path="oversight" element={<Oversight />} />
            <Route path="oversight/:level/:id" element={<Oversight />} />
            <Route path="admin/faculties" element={<Protected roles={['admin']}><AdminFaculties /></Protected>} />
            <Route path="exams" element={<Protected roles={['student', 'ta', 'doctor']}><Exams /></Protected>} />
            <Route path="admin/exams" element={<Protected roles={['admin']}><AdminExams /></Protected>} />
            <Route path="schedule" element={<Protected roles={['student', 'ta', 'doctor']}><MySchedule /></Protected>} />
            <Route path="schedule/:id/attend" element={<Protected roles={['ta', 'doctor', 'admin']}><StartSlotAttendance /></Protected>} />
            <Route path="admin/system" element={<Protected roles={['admin']}><AdminSystem /></Protected>} />
            <Route path="admin/broadcast" element={<Protected roles={['admin']}><AdminBroadcast /></Protected>} />
            <Route path="profile" element={<Profile />} />
            <Route path="admin/departments" element={<Protected roles={['admin']}><AdminDepartments /></Protected>} />
            <Route path="admin/users" element={<Protected roles={['admin']}><AdminUsers /></Protected>} />
            <Route path="admin/courses" element={<Protected roles={['admin']}><AdminCourses /></Protected>} />
            <Route path="admin/courses/:id" element={<Protected roles={['admin']}><AdminCourseManage /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </RealtimeProvider>
  );
}

export default function App() {
  return (
    <BrandingProvider>
    <AuthProvider>
      <AppRoutes />
      <Toaster position="top-center" dir="rtl" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
    </AuthProvider>
    </BrandingProvider>
  );
}

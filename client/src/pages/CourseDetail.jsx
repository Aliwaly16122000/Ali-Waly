import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Megaphone, BookOpen, FileText, Award, CalendarCheck, BarChart3, Users, ChevronRight, MessageCircle, CalendarDays, Archive, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { LEVEL_LABELS, SEMESTER_LABELS, titled } from '../lib/format';
import { openConversation } from '../lib/chat';
import { Alert, ErrorState, PageLoader, Tabs, Avatar } from '../components/ui';
import { courseGradient } from './Courses';
import Posts from './course/Posts';
import Assessments from './course/Assessments';
import StudentGrades from './course/StudentGrades';
import Gradebook from './course/Gradebook';
import Attendance from './course/Attendance';
import Stats from './course/Stats';
import Students from './course/Students';
import Schedule from './course/Schedule';

export default function CourseDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: course, error, loading, reload } = useApi(`/courses/${id}`);

  if (loading && !course) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const role = course.my_role;
  const staff = ['doctor', 'ta', 'admin', 'observer'].includes(role); // observers (leadership) get read-only staff views
  const tabs = [
    { id: 'assessments', label: 'الشيتات والتقييمات', icon: FileText },
    { id: 'announcements', label: 'الإعلانات', icon: Megaphone },
    { id: 'materials', label: 'المحاضرات والملفات', icon: BookOpen },
    { id: 'grades', label: staff ? 'كشف الدرجات' : 'درجاتي', icon: Award },
    { id: 'attendance', label: 'الحضور', icon: CalendarCheck },
    { id: 'schedule', label: 'المواعيد', icon: CalendarDays },
    ...(staff ? [{ id: 'stats', label: 'الإحصائيات', icon: BarChart3 }, { id: 'students', label: 'الطلاب', icon: Users }] : []),
  ];
  const tab = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'assessments';
  const setTab = (t) => setParams({ tab: t }, { replace: true });

  const message = async (userId) => {
    try {
      navigate(`/chat/${await openConversation(userId)}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <Link to="/courses" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4"><ChevronRight className="size-4" /> المواد</Link>
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${courseGradient(course.code)} text-white p-6 sm:p-8 mb-6`}>
        <div className="absolute -left-10 -top-10 size-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold bg-white/20 rounded-lg px-2.5 py-1 ltr">{course.code}</span>
            <span className="bg-white/15 rounded-lg px-2.5 py-1">{course.credit_hours} ساعات</span>
            <span className="bg-white/15 rounded-lg px-2.5 py-1">{SEMESTER_LABELS[course.semester]} {course.academic_year}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold mt-3">{course.name}</h1>
          <p className="text-white/80 mt-1">{course.department_name} · {LEVEL_LABELS[course.level] ?? ''} · {course.students_count} طالب</p>
          {course.description && <p className="text-white/85 mt-3 max-w-3xl text-sm leading-relaxed">{course.description}</p>}
          {role === 'student' && course.my_section && (
            <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-xl bg-white/15 px-3 py-1.5 text-sm">
              <span className="font-bold">{course.my_section}</span>
              {course.section_staff.length > 0 && <span>· معيد السكشن: {course.section_staff.map((s) => titled(s)).join('، ')}</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-5">
            {course.staff.map((s) => (
              <button key={s.id} onClick={() => !['admin', 'observer'].includes(role) && message(s.id)} disabled={['admin', 'observer'].includes(role)}
                className="flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 ps-1 pe-3 py-1 text-sm transition">
                <Avatar name={s.name} size="sm" />
                <span className="font-semibold">{titled(s)}</span>
                {!['admin', 'observer'].includes(role) && <MessageCircle className="size-3.5 opacity-80" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {course.archived && (
        <Alert tone="amber" icon={Archive} className="mb-4" title="مادة من ترم سابق (أرشيف)">
          تقدر تشوف كل الدرجات والملفات والحضور وتصدّرهم، لكن مفيش تسليمات جديدة ولا تسجيل حضور ولا تذكيرات.
        </Alert>
      )}
      {role === 'observer' && <Alert tone="blue" icon={Eye} className="mb-4">وضع المتابعة: بتشوف الإحصائيات والدرجات والحضور من غير تعديل.</Alert>}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === 'assessments' && <Assessments course={course} />}
        {tab === 'announcements' && <Posts course={course} type="announcement" />}
        {tab === 'materials' && <Posts course={course} type="material" />}
        {tab === 'grades' && (staff ? <Gradebook course={course} /> : <StudentGrades course={course} />)}
        {tab === 'attendance' && <Attendance course={course} />}
        {tab === 'schedule' && <Schedule course={course} />}
        {tab === 'stats' && <Stats course={course} />}
        {tab === 'students' && <Students course={course} onMessage={message} />}
      </div>
    </>
  );
}

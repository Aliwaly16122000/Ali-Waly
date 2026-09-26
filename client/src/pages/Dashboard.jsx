import { Link, Navigate } from 'react-router-dom';
import {
  BookOpen, FileText, Award, CalendarCheck, QrCode, Megaphone, ChevronLeft, ClipboardCheck, Users,
  Building2, Library, GraduationCap, UserCheck, AlertTriangle, Radio, Inbox, Clock, CalendarDays, ClipboardList,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { EXAM_KINDS, daysUntil, examDay, untilLabel } from './exams/shared';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../lib/useApi';
import { DAY_LABELS, KIND_LABELS, TYPE_LABELS, clock12, dueInfo, num, pctTone, timeAgo, titled } from '../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageLoader, Progress, StatCard, cx } from '../components/ui';
import { SlotRow } from './MySchedule';

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** The next lecture/section from the weekly timetable, with a live countdown. */
function NextClass() {
  const { data } = useApi('/schedule/me');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  if (!data?.slots.length) return null;
  const nowD = new Date();
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  let next = null;
  for (let add = 0; add < 7 && !next; add++) {
    const dow = (nowD.getDay() + add) % 7;
    const candidates = data.slots.filter((s) => s.day_of_week === dow && (add > 0 || toMin(s.end_time) > nowMin))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (candidates.length) next = { slot: candidates[0], add };
  }
  if (!next) return null;
  const { slot, add } = next;
  const live = add === 0 && toMin(slot.start_time) <= nowMin;
  const mins = add * 1440 + toMin(slot.start_time) - nowMin;
  const when = live ? 'دلوقتي' : mins < 60 ? `بعد ${mins} دقيقة` : add === 0 ? `النهارده ${clock12(slot.start_time)}` : add === 1 ? `بكرة ${clock12(slot.start_time)}` : `${DAY_LABELS[slot.day_of_week]} ${clock12(slot.start_time)}`;
  return (
    <Link to={`/courses/${slot.course_id}`} className="block mb-6">
      <div className={cx('relative overflow-hidden rounded-3xl p-5 sm:p-6 text-white shadow-lg', live ? 'bg-gradient-to-l from-emerald-600 to-teal-600' : 'bg-gradient-to-l from-brand-600 to-indigo-700')}>
        <div className="absolute -left-8 -top-8 size-40 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="size-14 rounded-2xl bg-white/15 grid place-items-center"><Clock className="size-7" /></div>
          <div className="flex-1 min-w-48">
            <p className="text-white/80 text-sm">{live ? 'شغال دلوقتي' : { lecture: 'محاضرتك الجاية', section: 'سكشنك الجاي', lab: 'معملك الجاي' }[slot.kind]}</p>
            <p className="text-xl sm:text-2xl font-extrabold">{KIND_LABELS[slot.kind]} {slot.course_name}</p>
            <p className="text-white/85 text-sm mt-0.5">{[slot.section, slot.location, slot.staff_name && titled({ name: slot.staff_name, role: slot.staff_role })].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-left">
            <p className="text-2xl sm:text-3xl font-extrabold">{when}</p>
            <p className="text-white/80 text-sm">{clock12(slot.start_time)} – {clock12(slot.end_time)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function UpcomingExams() {
  const { data } = useApi('/exams/me');
  const upcoming = (data?.exams || []).filter((x) => daysUntil(x.exam_date) >= 0).slice(0, 4);
  if (!upcoming.length) return null;
  return (
    <Card className="mb-6">
      <CardHeader icon={ClipboardList} title="امتحاناتك الجاية" action={<Button variant="ghost" size="sm" to="/exams">الجدول كامل</Button>} />
      <div className="px-3 pb-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {upcoming.map((x) => (
          <Link key={x.id} to="/exams" className="rounded-xl border border-line p-3 hover:border-brand-300">
            <div className="flex items-center justify-between"><Badge tone={daysUntil(x.exam_date) <= 1 ? 'red' : 'amber'}>{untilLabel(x.exam_date)}</Badge><span className="text-xs text-muted">{EXAM_KINDS[x.kind]}</span></div>
            <p className="font-bold mt-2 truncate">{x.course_name}</p>
            <p className="text-xs text-muted">{examDay(x.exam_date)} · {clock12(x.start_time)}</p>
            <p className="text-xs text-muted">{x.hall || x.location}{x.seat_number && ` · جلوس ${x.seat_number}`}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function TodaySchedule() {
  const { data } = useApi('/schedule/me');
  if (!data || !data.slots.length) return null;
  const today = data.slots.filter((s) => s.is_today);
  return (
    <Card className="mb-6">
      <CardHeader icon={CalendarDays} title="مواعيد النهارده" subtitle={today.length ? `${today.length} مواعيد` : 'مفيش مواعيد النهارده'}
        action={<Button variant="ghost" size="sm" to="/schedule">الجدول كامل</Button>} />
      {today.length > 0 && (
        <div className="px-2 pb-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
          {today.map((s) => <SlotRow key={s.id} s={s} now={data.now_minutes} today />)}
        </div>
      )}
    </Card>
  );
}

function Greeting({ user, subtitle }) {
  const h = new Date().getHours();
  const greet = h < 12 ? 'صباح الخير' : h < 18 ? 'مساء النور' : 'مساء الخير';
  return (
    <div className="mb-6">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{greet}، {titled(user).split(' ').slice(0, user.role === 'student' ? 1 : 2).join(' ')} 👋</h1>
      <p className="text-muted mt-1">{subtitle}</p>
    </div>
  );
}

function LiveSessionBanner({ sessions, student }) {
  if (!sessions?.length) return null;
  return (
    <div className="space-y-3 mb-6">
      {sessions.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-l from-emerald-600 to-teal-600 text-white p-4 sm:p-5 shadow-lg shadow-emerald-600/20">
          <div className="relative size-11 rounded-full bg-white/20 grid place-items-center text-white pulse-ring"><Radio className="relative size-5" /></div>
          <div className="flex-1 min-w-0">
            <p className="font-bold">تسجيل الحضور مفتوح الآن · {s.course_name}</p>
            <p className="text-sm text-emerald-50">{s.title} · يقفل {timeAgo(s.closes_at)}{!student && ` · ${s.present} حاضر`}</p>
          </div>
          {student ? (
            s.attended ? <Badge tone="green" className="bg-white text-emerald-700">✓ تم تسجيل حضورك</Badge>
              : <Button to="/scan" variant="secondary" icon={QrCode} className="bg-white text-emerald-700 border-0">سجّل حضورك</Button>
          ) : (
            <Button to={`/attendance/${s.id}/live`} variant="secondary" icon={QrCode} className="bg-white text-emerald-700 border-0">عرض الـ QR</Button>
          )}
        </div>
      ))}
    </div>
  );
}

function StudentDashboard({ data, user }) {
  return (
    <>
      <Greeting user={user} subtitle={`${user.department_name ?? ''} · ${data.courses} مواد مسجلة هذا الترم`} />
      <LiveSessionBanner sessions={data.active_sessions} student />
      <NextClass />
      <UpcomingExams />
      <TodaySchedule />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={BookOpen} label="موادي" value={data.courses} to="/courses" />
        <StatCard icon={FileText} label="مطلوب تسليمه" value={data.pending.length} tone={data.pending.length ? 'amber' : 'green'} />
        <StatCard icon={CalendarCheck} label="نسبة الحضور" value={data.attendance.rate === null ? '—' : `${data.attendance.rate}%`}
          hint={`${data.attendance.attended} من ${data.attendance.total} محاضرة`} tone={pctTone(data.attendance.rate)} />
        <StatCard icon={Award} label="درجات جديدة" value={data.recent_grades.filter((g) => Date.now() - new Date(g.published_at) < 7 * 864e5).length} hint="آخر 7 أيام" tone="violet" />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader icon={Clock} title="مطلوب منك" subtitle="الشيتات والمشاريع اللي لسه ما سلمتهاش" />
          {!data.pending.length ? (
            <EmptyState title="مفيش حاجة متأخرة عليك 🎉" description="كل الشيتات المطلوبة اتسلمت." />
          ) : (
            <ul className="px-3 pb-3">
              {data.pending.map((a) => {
                const due = dueInfo(a.due_at);
                return (
                  <li key={a.id}>
                    <Link to={`/courses/${a.course_id}/assessments/${a.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
                      <div className="size-10 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300 grid place-items-center shrink-0"><FileText className="size-5" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{a.title} <span className="text-muted font-normal">· {a.course_name}</span></p>
                        <p className="text-xs text-muted">{TYPE_LABELS[a.type]} · من {a.max_score} درجات</p>
                      </div>
                      <Badge tone={due.tone}>{due.text}</Badge>
                      <ChevronLeft className="size-4 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader icon={Award} title="آخر الدرجات" subtitle="الدرجات المعتمدة من الدكتور" />
          {!data.recent_grades.length ? <EmptyState title="لا توجد درجات منشورة بعد" /> : (
            <ul className="px-5 pb-5 space-y-4">
              {data.recent_grades.map((g) => {
                const pct = g.score === null ? 0 : (g.score / g.max_score) * 100;
                return (
                  <li key={g.id}>
                    <Link to={`/courses/${g.course_id}/assessments/${g.id}`} className="block group">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-sm font-semibold truncate group-hover:text-brand-600">{g.title} · <span className="text-muted font-normal">{g.course_name}</span></p>
                        <p className="text-sm font-bold ltr">{g.score === null ? 'لم يُسلَّم' : `${num(g.score)} / ${num(g.max_score)}`}</p>
                      </div>
                      <Progress value={pct} tone={pctTone(g.score === null ? 0 : pct)} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader icon={Megaphone} title="آخر الإعلانات" />
          {!data.announcements.length ? <EmptyState title="لا توجد إعلانات" /> : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 px-5 pb-5">
              {data.announcements.map((p) => (
                <Link key={p.id} to={`/courses/${p.course_id}?tab=${p.type === 'material' ? 'materials' : 'announcements'}`}
                  className="rounded-xl border border-line p-4 hover:border-brand-300 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge tone={p.type === 'material' ? 'violet' : 'amber'}>{p.type === 'material' ? 'محتوى' : 'إعلان'}</Badge>
                    <span className="text-xs text-muted truncate">{p.course_name}</span>
                  </div>
                  <p className="font-semibold line-clamp-1">{p.title}</p>
                  <p className="text-xs text-muted mt-1">{p.author_name} · {timeAgo(p.created_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function StaffDashboard({ data, user }) {
  const isDoctor = user.role === 'doctor';
  const returned = data.to_grade.filter((a) => a.review_note);
  return (
    <>
      <Greeting user={user} subtitle={isDoctor ? 'متابعة المواد والدرجات بانتظار اعتمادك' : 'التسليمات اللي محتاجة تصحيح'} />
      <LiveSessionBanner sessions={data.active_sessions} />
      <NextClass />
      <TodaySchedule />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={BookOpen} label="موادي" value={data.courses} to="/courses" />
        <StatCard icon={Users} label="الطلاب" value={data.students} tone="violet" />
        <StatCard icon={Inbox} label="تسليمات بدون تصحيح" value={data.ungraded_total} tone={data.ungraded_total ? 'amber' : 'green'} />
        <StatCard icon={ClipboardCheck} label={isDoctor ? 'بانتظار اعتمادك' : 'مرفوعة للدكتور'} value={data.awaiting_approval.length} tone={data.awaiting_approval.length ? 'red' : 'green'} />
      </div>

      {returned.length > 0 && !isDoctor && (
        <Card className="mb-6 border-rose-200 dark:border-rose-500/30">
          <CardHeader icon={AlertTriangle} title="درجات رجعت لك للمراجعة" />
          <ul className="px-5 pb-5 space-y-2">
            {returned.map((a) => (
              <li key={a.id}><Link to={`/courses/${a.course_id}/assessments/${a.id}`} className="block rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3">
                <p className="font-semibold">{a.title} · {a.course_name}</p>
                <p className="text-sm text-rose-700 dark:text-rose-300 mt-0.5">ملاحظة الدكتور: {a.review_note}</p>
              </Link></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader icon={ClipboardCheck} title={isDoctor ? 'درجات بانتظار الاعتماد' : 'درجات رفعتها للدكتور'} subtitle="راجع الإحصائيات ثم اعتمد لنشرها للطلاب" />
          {!data.awaiting_approval.length ? <EmptyState title="مفيش درجات منتظرة" /> : (
            <ul className="px-3 pb-3">
              {data.awaiting_approval.map((a) => (
                <li key={a.id}>
                  <Link to={`/courses/${a.course_id}/assessments/${a.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
                    <div className="size-10 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 grid place-items-center shrink-0"><ClipboardCheck className="size-5" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{a.title} · <span className="text-muted font-normal">{a.course_name}</span></p>
                      <p className="text-xs text-muted">رفعها {a.submitted_by_name} · {timeAgo(a.submitted_at)} · المتوسط {num(a.avg_score, 1)}/{num(a.max_score)}</p>
                    </div>
                    {isDoctor && <Badge tone="amber">راجع واعتمد</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader icon={Inbox} title="التصحيح" subtitle="التقييمات المفتوحة وحالة التصحيح" />
          {!data.to_grade.length ? <EmptyState title="لا توجد تقييمات مفتوحة" /> : (
            <ul className="px-5 pb-5 space-y-4">
              {data.to_grade.map((a) => (
                <li key={a.id}>
                  <Link to={`/courses/${a.course_id}/assessments/${a.id}`} className="block group">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-sm font-semibold truncate group-hover:text-brand-600">{a.title} · <span className="text-muted font-normal">{a.course_name}</span></p>
                      <div className="flex items-center gap-2">
                        {a.ungraded > 0 && <Badge tone="amber">{a.ungraded} بدون تصحيح</Badge>}
                        <span className="text-xs text-muted ltr">{a.graded}/{a.students}</span>
                      </div>
                    </div>
                    <Progress value={a.graded} max={a.students} tone={a.graded === a.students ? 'green' : 'blue'} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function AdminDashboard({ data, user }) {
  return (
    <>
      <Greeting user={user} subtitle="نظرة عامة على الكلية" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard icon={Building2} label="الأقسام" value={data.departments} to="/admin/departments" />
        <StatCard icon={Library} label="المواد" value={data.courses} to="/admin/courses" tone="violet" />
        <StatCard icon={GraduationCap} label="الطلاب" value={data.students} to="/admin/users?role=student" tone="green" />
        <StatCard icon={UserCheck} label="أعضاء هيئة التدريس" value={data.doctors} to="/admin/users?role=doctor" tone="amber" />
        <StatCard icon={Users} label="المعيدون" value={data.tas} to="/admin/users?role=ta" tone="blue" />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader icon={AlertTriangle} title="مواد بدون دكتور" subtitle="أسند عضو هيئة تدريس لكل مادة" />
          {!data.courses_without_staff.length ? <EmptyState title="كل المواد لها دكاترة ✓" /> : (
            <ul className="px-3 pb-3">{data.courses_without_staff.map((c) => (
              <li key={c.id}><Link to={`/admin/courses/${c.id}`} className="flex justify-between rounded-xl px-3 py-2.5 hover:bg-surface-2"><span>{c.name}</span><span className="text-muted ltr">{c.code}</span></Link></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={AlertTriangle} title="مواد بدون طلاب" subtitle="سجّل الطلاب في المادة" />
          {!data.courses_without_students.length ? <EmptyState title="كل المواد فيها طلاب ✓" /> : (
            <ul className="px-3 pb-3">{data.courses_without_students.map((c) => (
              <li key={c.id}><Link to={`/admin/courses/${c.id}`} className="flex justify-between rounded-xl px-3 py-2.5 hover:bg-surface-2"><span>{c.name}</span><span className="text-muted ltr">{c.code}</span></Link></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Card className="mt-6 p-6 bg-gradient-to-l from-brand-600 to-brand-800 text-white border-0">
        <p className="font-bold text-lg">خطوات تجهيز الترم</p>
        <ol className="mt-3 space-y-1.5 text-brand-100 text-sm list-decimal pr-5">
          <li>أضف الأقسام (مدني، كهرباء، حاسبات…)</li>
          <li>أضف الطلاب (فردي أو استيراد من Excel) — كل طالب بياخد كلمة سر خاصة بيه</li>
          <li>أضف الدكاترة والمعيدين</li>
          <li>أنشئ المواد وأسند لكل مادة الدكتور والمعيدين، وسجّل الطلاب (أو دفعة كاملة بضغطة)</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-4">
          <Button to="/admin/users" variant="secondary" className={cx('bg-white text-brand-700 border-0')}>إدارة المستخدمين</Button>
          <Button to="/admin/courses" variant="secondary" className="bg-white/10 text-white border-white/20 hover:bg-white/20">إدارة المواد</Button>
        </div>
      </Card>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi('/dashboard');
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (user.role === 'leader') return <Navigate to="/oversight" replace />;
  if (user.role === 'student') return <StudentDashboard data={data} user={user} />;
  if (user.role === 'admin') return <AdminDashboard data={data} user={user} />;
  return <StaffDashboard data={data} user={user} />;
}


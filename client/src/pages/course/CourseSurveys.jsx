import { useState } from 'react';
import { ClipboardCheck, BarChart3 } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { Button, Card, CardHeader, Modal, PageLoader } from '../../components/ui';
import SurveyResults from '../surveys/Results';

/** Anonymous survey results for this course (staff / leadership). */
export default function CourseSurveys({ course }) {
  const { data } = useApi(`/surveys/course/${course.id}`);
  const [open, setOpen] = useState(null);
  const { data: results } = useApi(open ? `/surveys/${open.id}/results?course_id=${course.id}` : null);
  if (!data?.length) return null;
  return (
    <Card className="mt-6">
      <CardHeader icon={ClipboardCheck} title="تقييم الطلاب للمادة" subtitle="نتائج الاستبيانات — متوسطات بدون أسماء" />
      <div className="px-5 pb-5 space-y-2">
        {data.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-line p-3">
            <div><p className="font-semibold">{s.title}</p><p className="text-xs text-muted">{s.responses} رد</p></div>
            <Button size="sm" variant="soft" icon={BarChart3} onClick={() => setOpen(s)}>النتائج</Button>
          </div>
        ))}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(null)} size="xl" title={open.title} subtitle={course.name}>
          {results ? <SurveyResults data={results} /> : <PageLoader />}
        </Modal>
      )}
    </Card>
  );
}

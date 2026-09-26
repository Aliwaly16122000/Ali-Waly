import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, ErrorState, PageLoader } from '../components/ui';

/** Target of the "time to take attendance" notification: opens the session and jumps to the QR. */
export default function StartSlotAttendance() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  useEffect(() => {
    let done = false;
    api.post(`/schedule/${id}/start-attendance`)
      .then((r) => { if (!done) navigate(`/attendance/${r.id}/live`, { replace: true }); })
      .catch(setError);
    return () => { done = true; };
  }, [id, navigate]);
  if (error) return <><ErrorState error={error} /><div className="text-center"><Button to="/">الرئيسية</Button></div></>;
  return <PageLoader />;
}

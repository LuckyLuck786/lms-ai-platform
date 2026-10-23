import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { useAppSelector } from '../../store/hooks';
import { Alert, Card, ProgressBar, SkeletonCard } from '../../components/common/ui';
import { Badge, Certificate, Enrollment, Streak } from '../../utils/types';
import { useI18n } from '../../utils/i18n';
import { Download, Medal, ShieldCheck } from '../../components/common/Icon';

export default function StudentDashboard() {
  const { t } = useI18n();
  const user = useAppSelector((s) => s.auth.user);
  const accessToken = useAppSelector((s) => s.auth.accessToken);

  /** Authenticated PDF download (the endpoint requires a Bearer token). */
  const downloadCertificate = async (certId: string) => {
    try {
      const res = await api.get(`/certificates/${certId}/download`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `certificate-${certId}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollments', 'me'],
    queryFn: async () => (await api.get<{ items: Enrollment[] }>('/enrollments/me')).data,
  });

  const streak = useQuery({
    queryKey: ['streak'],
    queryFn: async () => (await api.get<Streak>('/users/me/streak')).data,
  });

  const badges = useQuery({
    queryKey: ['badges'],
    queryFn: async () => (await api.get<{ items: Badge[] }>('/users/me/badges')).data,
  });

  const certificates = useQuery({
    queryKey: ['certificates'],
    queryFn: async () => (await api.get<{ items: Certificate[] }>('/users/me/certificates')).data,
  });

  const recommendations = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () =>
      (
        await api.get<{
          items: {
            course_id: string;
            title: string;
            difficulty: string | null;
            instructor_name: string;
            score: number;
            reason: string;
          }[];
        }>('/ai/recommendations')
      ).data,
  });

  const enrollments = data?.items ?? [];
  const avgProgress = enrollments.length
    ? enrollments.reduce((sum, e) => sum + Number(e.progress_percent), 0) / enrollments.length
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">{t('dashboard.subtitle')}</p>
          <h1 className="font-display text-3xl text-ink-950 dark:text-white">
            {t('dashboard.welcome', { name: user?.full_name?.split(' ')[0] ?? '' })}
          </h1>
        </div>
        <div className="card flex items-center gap-6 py-3">
          <div>
            <div className="eyebrow">{t('dashboard.coursesCount')}</div>
            <div className="text-xl font-semibold nums">{enrollments.length}</div>
          </div>
          <div className="h-8 w-px bg-slate-200 dark:bg-white/10" />
          <div>
            <div className="eyebrow">{t('dashboard.avgProgress')}</div>
            <div className="text-xl font-semibold nums">{Math.round(avgProgress)}%</div>
          </div>
          <div className="h-8 w-px bg-slate-200 dark:bg-white/10" />
          <div>
            <div className="eyebrow">{t('dashboard.streak')}</div>
            <div className="text-xl font-semibold nums">{streak.data?.current_streak ?? 0}</div>
          </div>
        </div>
      </div>

      {error && <Alert>{apiErrorMessage(error)}</Alert>}

      {badges.data && badges.data.items.length > 0 && (
        <section aria-label={t('dashboard.badges')}>
          <h2 className="eyebrow mb-2">{t('dashboard.badgesEarned')}</h2>
          <div className="flex flex-wrap gap-2">
            {badges.data.items.map((b) => (
              <span key={b.id} title={b.description ?? b.name} className="chip-gold capitalize">
                <Medal className="h-3.5 w-3.5" />
                {b.name.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </section>
      )}

      <section aria-label={t('dashboard.myCourses')} className="space-y-3">
        <h2 className="section-title">{t('dashboard.myCourses')}</h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : enrollments.length === 0 ? (
          <Card className="text-center">
            <p className="mb-4 text-slate-600 dark:text-slate-400">{t('dashboard.noCourses')}</p>
            <Link to="/catalog" className="btn-primary">{t('dashboard.browseCatalog')}</Link>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {enrollments.map((e) => (
              <Link key={e.id} to={`/catalog/${e.course_id}`} className="card card-hover">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{e.title}</h3>
                  <span className="chip shrink-0 capitalize">{e.difficulty ?? t('course.allLevels')}</span>
                </div>
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{e.instructor_name}</p>
                <ProgressBar percent={Number(e.progress_percent)} label={t('dashboard.progressFor', { title: e.title })} />
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                  {t('dashboard.percentComplete', { value: Number(e.progress_percent) })}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {recommendations.data && recommendations.data.items.length > 0 && (
        <section aria-label={t('dashboard.recommended')} className="space-y-3">
          <h2 className="section-title">{t('dashboard.recommended')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {recommendations.data.items.map((r) => (
              <Link key={r.course_id} to={`/catalog/${r.course_id}`} className="card card-hover">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{r.title}</h3>
                  <span className="chip shrink-0 nums">{Math.round(r.score)}% fit</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{r.reason}</p>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{r.instructor_name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {certificates.data && certificates.data.items.length > 0 && (
        <section aria-label={t('dashboard.certificates')} className="space-y-3">
          <h2 className="section-title">{t('dashboard.certificates')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {certificates.data.items.map((cert) => (
              <article
                key={cert.id}
                className="rounded-lg border border-slate-300/70 bg-paper-card p-5
                  dark:border-white/10 dark:bg-ink-900"
              >
                <div className="">
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5 h-8 w-1 shrink-0 rounded-sm bg-gold-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="eyebrow">{t('dashboard.certificate')}</p>
                      <h3 className="font-display text-lg leading-snug text-ink-950 dark:text-white">
                        {cert.course_title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {t('dashboard.issuedOn', {
                          date: new Date(cert.issued_at).toLocaleDateString(),
                        })}
                        {cert.serial ? ` · ${cert.serial}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="btn-primary" onClick={() => void downloadCertificate(cert.id)}>
                      <Download />
                      {t('dashboard.downloadPdf')}
                    </button>
                    <Link className="btn-secondary" to={`/verify/${cert.id}`}>
                      <ShieldCheck />
                      {t('dashboard.verifyCredential')}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

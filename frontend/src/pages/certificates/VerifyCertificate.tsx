import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { Spinner } from '../../components/common/ui';
import { ShieldCheck, X } from '../../components/common/Icon';
import { useI18n } from '../../utils/i18n';

interface VerifiedCertificate {
  valid: true;
  certificate_id: string;
  serial: string;
  student_name: string;
  course_title: string;
  instructor_name: string | null;
  issued_at: string;
}

const formatIssued = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Public credential verification page (FR-S8, no auth).
 *
 * The QR code printed on the certificate PDF resolves here; the page confirms
 * against the same registry the PDF is rendered from. Reached by scanning the
 * certificate — hence public, and deliberately quiet rather than app-like.
 */
export default function VerifyCertificate() {
  const { t } = useI18n();
  const { id = '' } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['certificate-verify', id],
    queryFn: async () => (await api.get<VerifiedCertificate>(`/certificates/verify/${id}`)).data,
    enabled: !!id,
    retry: false,
  });

  const meta = (
    <div className="grid gap-6 border-t border-slate-300/80 pt-6 text-left sm:grid-cols-3 dark:border-white/10">
      <Meta label={t('verify.credentialId')} value={data?.serial ?? 'n/a'} mono />
      <Meta label={t('verify.issued')} value={data ? formatIssued(data.issued_at) : 'n/a'} />
      <Meta label={t('verify.instructor')} value={data?.instructor_name ?? 'n/a'} />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl py-6">
      <p className="eyebrow mb-4 text-center">{t('verify.registry')}</p>

      {/* Double frame, the way a printed certificate is ruled. */}
      <div className="rounded-md border border-gold-400/60 p-1.5">
        <div className="rounded-sm border border-slate-300/80 bg-paper-card px-6 py-10 text-center sm:px-12 dark:border-white/15 dark:bg-ink-900">
          {isLoading && (
            <div className="flex flex-col items-center gap-3 py-10 text-slate-500">
              <Spinner />
              <p className="text-sm">{t('verify.checking')}</p>
            </div>
          )}

          {!isLoading && (isError || !data?.valid) && (
            <div className="flex flex-col items-center gap-3 py-8">
              <span className="flex h-10 w-10 items-center justify-center rounded-sm border border-slate-300 text-red-700 dark:border-white/15 dark:text-red-400">
                <X size={18} />
              </span>
              <h1 className="font-display text-2xl text-ink-950 dark:text-white">
                {t('verify.notFoundTitle')}
              </h1>
              <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
                {t('verify.notFoundBody')}
              </p>
            </div>
          )}

          {!isLoading && data?.valid && (
            <>
              <span className="mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-sm border border-gold-400/50 text-gold-600 dark:text-gold-300">
                <ShieldCheck size={20} />
              </span>
              <p className="eyebrow text-emerald-800 dark:text-emerald-400">{t('verify.valid')}</p>

              <div className="my-7 border-y border-slate-300/80 py-7 dark:border-white/10">
                <p className="font-display text-4xl text-ink-950 dark:text-white">
                  {data.student_name}
                </p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {t('verify.completed')}
                </p>
                <p className="mt-2 font-display text-xl text-ink-800 dark:text-slate-200">
                  “{data.course_title}”
                </p>
              </div>

              {meta}

              <p className="mt-6 text-xs text-slate-400">{t('verify.confirm')}</p>
            </>
          )}
        </div>
      </div>

      <p className="mt-6 text-center">
        <Link to="/" className="link-quiet text-sm">
          {t('verify.backHome')}
        </Link>
      </p>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className={`text-sm font-medium text-ink-900 dark:text-slate-200 ${mono ? 'font-mono tracking-tight' : ''}`}>
        {value}
      </div>
    </div>
  );
}

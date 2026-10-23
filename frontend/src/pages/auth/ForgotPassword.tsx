import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card } from '../../components/common/ui';
import { useI18n } from '../../utils/i18n';

/** Request a password-reset link. The reply is identical for unknown emails. */
export default function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const send = useMutation({
    mutationFn: async () => (await api.post('/auth/forgot-password', { email })).data,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-2 text-xl font-bold">{t('reset.forgotTitle')}</h1>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{t('reset.forgotHint')}</p>
        {send.isSuccess ? (
          <Alert kind="success">{t('reset.sent', { email })}</Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {send.isError && <Alert>{apiErrorMessage(send.error)}</Alert>}
            <div>
              <label className="label" htmlFor="forgot-email">{t('auth.email')}</label>
              <input id="forgot-email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={send.isPending}>{t('reset.sendLink')}</button>
          </form>
        )}
        <p className="mt-4 text-sm">
          <Link to="/login" className="link-quiet">{t('reset.backToLogin')}</Link>
        </p>
      </Card>
    </div>
  );
}

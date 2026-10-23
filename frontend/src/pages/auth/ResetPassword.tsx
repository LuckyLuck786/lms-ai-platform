import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card } from '../../components/common/ui';
import { useI18n } from '../../utils/i18n';

/** Landing page for the emailed reset link (/reset-password?token=…). */
export default function ResetPassword() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const reset = useMutation({
    mutationFn: async () => (await api.post('/auth/reset-password', { token, new_password: password })).data,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMismatch(password !== confirm);
    if (password === confirm) reset.mutate();
  };
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-4 text-xl font-bold">{t('reset.title')}</h1>
        {!token ? (
          <Alert>{t('reset.noToken')}</Alert>
        ) : reset.isSuccess ? (
          <>
            <Alert kind="success">{t('reset.done')}</Alert>
            <Link to="/login" className="btn-primary mt-4 inline-flex">{t('auth.login')}</Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {mismatch && <Alert>{t('account.passwordMismatch')}</Alert>}
            {reset.isError && <Alert>{apiErrorMessage(reset.error)}</Alert>}
            <div>
              <label className="label" htmlFor="reset-new">{t('account.newPassword')}</label>
              <input id="reset-new" type="password" required minLength={8} autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="reset-confirm">{t('account.confirmNewPassword')}</label>
              <input id="reset-confirm" type="password" required minLength={8} autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">{t('reset.hint')}</p>
            <button type="submit" className="btn-primary w-full" disabled={reset.isPending}>{t('reset.submit')}</button>
          </form>
        )}
      </Card>
    </div>
  );
}

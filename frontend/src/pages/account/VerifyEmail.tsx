import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiErrorMessage } from '../../services/api';
import { setUser } from '../../store/authSlice';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { User } from '../../utils/types';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { useI18n } from '../../utils/i18n';

/** Landing page for the link in a verification email (/verify-email?token=…). */
export default function VerifyEmail() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const dispatch = useAppDispatch();
  const signedIn = useAppSelector((s) => !!s.auth.user);
  const [state, setState] = useState<{ kind: 'pending' | 'done' | 'error'; text?: string }>({ kind: 'pending' });
  // A link works once. React's development double-run of effects would spend
  // it on the first call and report failure on the second, so run exactly once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState({ kind: 'error', text: t('verify.missing') });
      return;
    }
    api
      .post<{ email: string }>('/auth/verify-email', { token })
      .then(async ({ data }) => {
        setState({ kind: 'done', text: t('verify.done', { email: data.email }) });
        if (signedIn) dispatch(setUser((await api.get<User>('/auth/me')).data));
      })
      .catch((e) => setState({ kind: 'error', text: apiErrorMessage(e) }));
  }, [token, signedIn, dispatch, t]);

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-4 text-xl font-bold">{t('verify.title')}</h1>
        {state.kind === 'pending' && <Spinner />}
        {state.kind === 'done' && <Alert kind="success">{state.text}</Alert>}
        {state.kind === 'error' && <Alert>{state.text}</Alert>}
        {state.kind !== 'pending' && (
          <p className="mt-4 text-sm">
            <Link to={signedIn ? '/account' : '/login'} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
              {signedIn ? t('verify.toAccount') : t('auth.login')}
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}

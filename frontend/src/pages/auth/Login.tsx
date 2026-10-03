import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { setAuth } from '../../store/authSlice';
import { useAppDispatch } from '../../store/hooks';
import { AuthResponse } from '../../utils/types';
import { Alert, Card } from '../../components/common/ui';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../services/demo';
import { DEMO_MODE } from '../../services/api';

export default function Login() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
      return data;
    },
    onSuccess: (data) => {
      dispatch(setAuth(data));
      navigate('/');
    },
    onError: (err) => setFormError(apiErrorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    mutation.mutate();
  };

  const signInAs = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setFormError(null);
    mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-4 text-xl font-bold">Log in</h1>
        {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ananya@example.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          No account?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline">
            Register
          </Link>
        </p>

        {DEMO_MODE && (
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="mb-2 text-xs uppercase text-slate-400">Demo accounts</div>
            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => signInAs(account.email)}
                  disabled={mutation.isPending}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{account.label}</span>
                    <span className="ml-2 text-xs text-slate-400">{account.email}</span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
                    {account.hint}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Password for all three: <code>{DEMO_PASSWORD}</code>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

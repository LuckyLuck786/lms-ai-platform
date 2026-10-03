import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { setAuth } from '../../store/authSlice';
import { useAppDispatch } from '../../store/hooks';
import { AuthResponse } from '../../utils/types';
import { Alert, Card } from '../../components/common/ui';

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
      </Card>
    </div>
  );
}

import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { setAuth } from '../../store/authSlice';
import { useAppDispatch } from '../../store/hooks';
import { AuthResponse } from '../../utils/types';
import { Alert, Card } from '../../components/common/ui';

export default function Register() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AuthResponse>('/auth/register', {
        full_name: fullName,
        email,
        password,
        role,
      });
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
        <h1 className="mb-4 text-xl font-bold">Create your account</h1>
        {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="full_name">Full name</label>
            <input
              id="full_name"
              required
              minLength={2}
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ananya Sharma"
            />
          </div>
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
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="label" htmlFor="role">I am a…</label>
            <select id="role" className="input" value={role} onChange={(e) => setRole(e.target.value as 'student' | 'instructor')}>
              <option value="student">Student</option>
              <option value="instructor">Instructor</option>
            </select>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating account…' : 'Register'}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}

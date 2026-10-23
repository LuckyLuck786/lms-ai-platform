import { FormEvent, ReactNode, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { setUser } from '../../store/authSlice';
import { useAppDispatch } from '../../store/hooks';
import { User } from '../../utils/types';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { useI18n } from '../../utils/i18n';

type Status = { kind: 'success' | 'error'; text: string } | null;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="section-title mb-4">{title}</h2>
      {children}
    </Card>
  );
}

/** Self-service account page: profile, email address, password. */
export default function Account() {
  const { t } = useI18n();
  const dispatch = useAppDispatch();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<User>('/auth/me')).data,
  });

  if (me.isLoading) return <Spinner />;
  if (me.isError || !me.data) return <Alert>{apiErrorMessage(me.error)}</Alert>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="eyebrow mb-1">{t('account.eyebrow')}</div>
        <h1 className="font-display text-3xl text-ink-950 dark:text-white">{t('account.title')}</h1>
      </div>
      <ProfileForm
        user={me.data}
        onSaved={(u) => {
          dispatch(setUser(u));
          void me.refetch();
        }}
      />
      <EmailSection user={me.data} />
      <PasswordForm />
    </div>
  );
}

function ProfileForm({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [status, setStatus] = useState<Status>(null);

  const save = useMutation({
    mutationFn: async () => (await api.patch<User>('/users/me', { full_name: fullName, phone })).data,
    onSuccess: (u) => {
      setStatus({ kind: 'success', text: t('account.saved') });
      onSaved(u);
    },
    onError: (e) => setStatus({ kind: 'error', text: apiErrorMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    save.mutate();
  };

  return (
    <Section title={t('account.profile')}>
      {status && <div className="mb-4"><Alert kind={status.kind}>{status.text}</Alert></div>}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="acct-name">{t('auth.fullName')}</label>
          <input
            id="acct-name"
            className="input"
            required
            minLength={2}
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="acct-phone">{t('account.phone')}</label>
          <input
            id="acct-phone"
            className="input"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            pattern="\+?[0-9 ()\-]{7,20}"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            aria-describedby="acct-phone-hint"
          />
          <p id="acct-phone-hint" className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {t('account.phoneHint')}
          </p>
        </div>
        <div>
          <span className="label">{t('account.role')}</span>
          <p className="text-sm capitalize">{user.roles.join(', ')}</p>
        </div>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? t('account.saving') : t('account.save')}
        </button>
      </form>
    </Section>
  );
}

function EmailSection({ user }: { user: User }) {
  const { t } = useI18n();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>(null);

  const resend = useMutation({
    mutationFn: async () => (await api.post<{ sent: boolean }>('/auth/resend-verification')).data,
    onSuccess: () => setStatus({ kind: 'success', text: t('account.verificationSent', { email: user.email }) }),
    onError: (e) => setStatus({ kind: 'error', text: apiErrorMessage(e) }),
  });

  const change = useMutation({
    mutationFn: async () =>
      (await api.post<{ to: string }>('/users/me/email', { new_email: newEmail, password })).data,
    onSuccess: (d) => {
      setStatus({ kind: 'success', text: t('account.changeSent', { email: d.to }) });
      setNewEmail('');
      setPassword('');
    },
    onError: (e) => setStatus({ kind: 'error', text: apiErrorMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    change.mutate();
  };

  return (
    <Section title={t('account.email')}>
      {status && <div className="mb-4"><Alert kind={status.kind}>{status.text}</Alert></div>}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="font-medium">{user.email}</span>
        {user.email_verified ? (
          <span className="chip">{t('account.verified')}</span>
        ) : (
          <>
            <span className="chip-gold">{t('account.unverified')}</span>
            <button
              type="button"
              className="btn-secondary"
              disabled={resend.isPending}
              onClick={() => {
                setStatus(null);
                resend.mutate();
              }}
            >
              {t('account.resend')}
            </button>
          </>
        )}
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="acct-new-email">{t('account.newEmail')}</label>
          <input
            id="acct-new-email"
            className="input"
            type="email"
            required
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="acct-email-password">{t('account.confirmPassword')}</label>
          <input
            id="acct-email-password"
            className="input"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('account.changeHint')}</p>
        <button type="submit" className="btn-secondary" disabled={change.isPending}>
          {t('account.changeEmail')}
        </button>
      </form>
    </Section>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>(null);

  const change = useMutation({
    mutationFn: async () =>
      (await api.put('/users/me/password', { current_password: current, new_password: next })).data,
    onSuccess: () => {
      setStatus({ kind: 'success', text: t('account.passwordChanged') });
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (e) => setStatus({ kind: 'error', text: apiErrorMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (next !== confirm) {
      setStatus({ kind: 'error', text: t('account.passwordMismatch') });
      return;
    }
    change.mutate();
  };

  return (
    <Section title={t('account.password')}>
      {status && <div className="mb-4"><Alert kind={status.kind}>{status.text}</Alert></div>}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="acct-current">{t('account.currentPassword')}</label>
          <input
            id="acct-current"
            className="input"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="acct-next">{t('account.newPassword')}</label>
          <input
            id="acct-next"
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="acct-confirm">{t('account.confirmNewPassword')}</label>
          <input
            id="acct-confirm"
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('account.passwordHint')}</p>
        <button type="submit" className="btn-secondary" disabled={change.isPending}>
          {t('account.changePassword')}
        </button>
      </form>
    </Section>
  );
}

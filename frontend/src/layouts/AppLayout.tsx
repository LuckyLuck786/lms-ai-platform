import { useEffect } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { User } from '../utils/types';
import { clearAuth, setUser } from '../store/authSlice';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import ThemeToggle from '../components/common/ThemeToggle';
import NotificationBell from '../components/common/NotificationBell';
import DemoBanner from '../components/common/DemoBanner';
import { useI18n, Locale } from '../utils/i18n';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm transition-colors ${
    isActive
      ? 'border-brand-700 font-medium text-slate-900 dark:border-brand-400 dark:text-white'
      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
  }`;

/** Top-level chrome: brand, nav, user menu, theme toggle. */
export default function AppLayout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { t, locale, setLocale } = useI18n();

  // The stored user is a snapshot from sign-in. Refresh it from the server so
  // a verification, rename or role change made elsewhere shows up here.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<User>('/auth/me')).data,
    enabled: !!user,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (me.data) dispatch(setUser(me.data));
  }, [me.data, dispatch]);

  const logout = () => {
    dispatch(clearAuth());
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b border-slate-300/70 bg-paper-card dark:border-white/10 dark:bg-ink-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link
            to="/"
            className="whitespace-nowrap font-display text-lg font-semibold text-slate-900 dark:text-white"
          >
            Vertexon <span className="text-slate-600 dark:text-slate-400">LMS-AI</span>
          </Link>
          {/* Sits inline on wide screens and wraps onto its own row on narrow ones. */}
          <nav
            aria-label={t('nav.main')}
            className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto"
          >
            <NavLink to="/" end className={navLinkClass}>
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/catalog" className={navLinkClass}>
              {t('nav.catalog')}
            </NavLink>
            {user?.roles.includes('instructor') && (
              <NavLink to="/instructor" className={navLinkClass}>
                {t('nav.instructor')}
              </NavLink>
            )}
            {user?.roles.includes('admin') && (
              <NavLink to="/admin" className={navLinkClass}>
                {t('nav.admin')}
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <label htmlFor="lang-select" className="sr-only">
              {t('app.language')}
            </label>
            <select
              id="lang-select"
              className="rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm
                dark:border-white/15"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
              <option value="hi">HI</option>
            </select>
            <ThemeToggle />
            {user && <NotificationBell />}
            {user ? (
              <>
                <Link
                  to="/account"
                  className="hidden text-sm text-slate-600 hover:text-slate-900 hover:underline sm:inline dark:text-slate-400 dark:hover:text-white"
                >
                  {user.full_name}
                  <span className="ml-1 text-[11px] uppercase tracking-caps text-slate-600 dark:text-slate-400">
                    {user.role}
                  </span>
                </Link>
                <button type="button" onClick={logout} className="btn-secondary">
                  {t('auth.logout')}
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary">
                {t('auth.login')}
              </Link>
            )}
          </div>
        </div>
      </header>
      <DemoBanner />
      {user && user.email_verified === false && (
        <div
          role="status"
          className="border-b border-gold-400/40 bg-paper-sunk px-4 py-2 text-center text-sm text-slate-800 dark:bg-ink-800 dark:text-slate-200"
        >
          {t('verify.banner', { email: user.email })}{' '}
          <Link to="/account" className="font-medium text-brand-700 underline dark:text-brand-300">
            {t('verify.bannerAction')}
          </Link>
        </div>
      )}
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mt-12 border-t border-slate-300/70 py-6 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-slate-600 dark:text-slate-400">
          <span>{t('app.footer')}</span>
          <nav aria-label={t('legal.title')} className="flex items-center gap-4">
            <Link to="/terms" className="link-quiet">{t('legal.terms')}</Link>
            <Link to="/privacy" className="link-quiet">{t('legal.privacy')}</Link>
            <Link to="/catalog" className="link-quiet">{t('nav.catalog')}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

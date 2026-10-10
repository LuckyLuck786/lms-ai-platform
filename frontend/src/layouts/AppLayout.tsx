import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearAuth } from '../store/authSlice';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import ThemeToggle from '../components/common/ThemeToggle';
import NotificationBell from '../components/common/NotificationBell';
import DemoBanner from '../components/common/DemoBanner';
import { useI18n, Locale } from '../utils/i18n';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-100'
      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
  }`;

/** Top-level chrome: brand, nav, user menu, theme toggle. */
export default function AppLayout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { t, locale, setLocale } = useI18n();

  const logout = () => {
    dispatch(clearAuth());
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link
            to="/"
            className="whitespace-nowrap text-lg font-bold text-brand-700 dark:text-brand-100"
          >
            Vertexon <span className="text-slate-400">LMS-AI</span>
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
              className="rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm
                dark:border-slate-700"
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
                <span className="hidden text-sm text-slate-600 sm:inline dark:text-slate-300">
                  {user.full_name} · <span className="uppercase text-xs">{user.role}</span>
                </span>
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
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400 dark:border-slate-800">
        {t('app.footer')}
      </footer>
    </div>
  );
}

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

/**
 * Basic i18n scaffolding (PRD §3.1 — full translation is out of scope).
 * Add a locale by extending STRINGS; the language picker persists to
 * localStorage and falls back to English for missing keys.
 */

export type Locale = 'en' | 'es' | 'hi';

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.catalog': 'Catalog',
    'nav.instructor': 'My Courses',
    'nav.admin': 'Admin',
    'auth.login': 'Log in',
    'auth.logout': 'Log out',
    'common.loading': 'Loading…',
    'common.search': 'Search',
    'common.submit': 'Submit',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
  },
  es: {
    'nav.dashboard': 'Panel',
    'nav.catalog': 'Catálogo',
    'nav.instructor': 'Mis cursos',
    'nav.admin': 'Administración',
    'auth.login': 'Iniciar sesión',
    'auth.logout': 'Cerrar sesión',
    'common.loading': 'Cargando…',
    'common.search': 'Buscar',
    'common.submit': 'Enviar',
    'theme.light': 'Claro',
    'theme.dark': 'Oscuro',
  },
  hi: {
    'nav.dashboard': 'डैशबोर्ड',
    'nav.catalog': 'कैटलॉग',
    'nav.instructor': 'मेरे पाठ्यक्रम',
    'nav.admin': 'व्यवस्थापक',
    'auth.login': 'लॉग इन',
    'auth.logout': 'लॉग आउट',
    'common.loading': 'लोड हो रहा है…',
    'common.search': 'खोजें',
    'common.submit': 'जमा करें',
    'theme.light': 'हल्का',
    'theme.dark': 'गहरा',
  },
};

const STORAGE_KEY = 'lms.lang';

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  setLocale: () => undefined,
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Locale) ?? 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (key: string) => STRINGS[locale][key] ?? STRINGS.en[key] ?? key;

  return (
    <I18nContext.Provider value={{ locale, setLocale: setLocaleState, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

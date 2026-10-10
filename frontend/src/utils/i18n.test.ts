import { describe, expect, it } from 'vitest';
import { LOCALES, STRINGS, interpolate, translate } from './i18n';

/**
 * A translation that silently falls back to English is invisible in review, so
 * the catalogue is checked mechanically: every locale must define exactly the
 * same keys as English, and no value may be empty.
 */
describe('i18n catalogue', () => {
  const englishKeys = Object.keys(STRINGS.en).sort();

  it('ships the locales the language picker offers', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(Object.keys(STRINGS).sort());
  });

  it.each(Object.keys(STRINGS) as (keyof typeof STRINGS)[])(
    '%s defines exactly the English key set',
    (locale) => {
      expect(Object.keys(STRINGS[locale]).sort()).toEqual(englishKeys);
    },
  );

  it.each(Object.keys(STRINGS) as (keyof typeof STRINGS)[])(
    '%s has no empty or placeholder-only values',
    (locale) => {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    },
  );

  it('keeps every interpolation placeholder consistent across locales', () => {
    const placeholders = (value: string) =>
      (value.match(/\{(\w+)\}/g) ?? []).sort().join(',');

    for (const key of englishKeys) {
      const expected = placeholders(STRINGS.en[key]);
      for (const locale of Object.keys(STRINGS) as (keyof typeof STRINGS)[]) {
        expect(placeholders(STRINGS[locale][key]), `${locale}:${key}`).toBe(expected);
      }
    }
  });
});

describe('translate', () => {
  it('returns the locale string when present', () => {
    expect(translate('es', 'nav.catalog')).toBe('Catálogo');
    expect(translate('hi', 'nav.catalog')).toBe('कैटलॉग');
  });

  it('falls back to English, then to the key itself', () => {
    expect(translate('es', 'brand.notARealKey')).toBe('brand.notARealKey');
    // A key only present in English still resolves for other locales.
    expect(translate('hi', 'nav.main')).toBe('मुख्य');
  });

  it('interpolates named placeholders', () => {
    expect(translate('en', 'dashboard.welcome', { name: 'Riya' })).toContain('Riya');
    expect(translate('en', 'common.percentage', { value: 42 })).toBe('42%');
    expect(translate('es', 'common.percentage', { value: 42 })).toBe('42 %');
  });
});

describe('interpolate', () => {
  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('Hi {name}, you have {count}', { name: 'Sam' })).toBe(
      'Hi Sam, you have {count}',
    );
  });

  it('passes the template through when no vars are given', () => {
    expect(interpolate('{name}')).toBe('{name}');
  });
});

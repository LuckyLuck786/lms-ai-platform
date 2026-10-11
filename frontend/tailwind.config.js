/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Institutional pairing: Plex for the interface, a text serif for
        // display type. Deliberately not Inter/Geist/Space Grotesk.
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['"Source Serif 4"', '"Iowan Old Style"', 'Georgia', 'Cambria', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Institutional deep blue. No violet/indigo cast, nothing neon.
        brand: {
          50: '#eff4f9',
          100: '#dce7f1',
          200: '#bdd1e5',
          300: '#93b2d2',
          400: '#5f8bb8',
          500: '#3d6b9c',
          600: '#2c5480',
          700: '#22436a',
          800: '#1a3353',
          900: '#13263f',
        },
        // Neutral dark surfaces (was a purple-ish navy).
        ink: {
          950: '#0f1115',
          900: '#15181e',
          800: '#1c2027',
          700: '#252a33',
          600: '#333a45',
        },
        // Warm paper, so no surface is pure white.
        paper: {
          DEFAULT: '#f5f3ee',
          card: '#fdfcfa',
          sunk: '#efece5',
        },
        gold: {
          300: '#d5c6a2',
          400: '#b9a375',
          500: '#967d47',
          600: '#75613a',
        },
      },
      boxShadow: {
        // A hairline does the work a drop shadow would: cards get no shadow,
        // only popovers get a restrained lift.
        card: 'none',
        lift: 'none',
        seal: 'none',
        pop: '0 10px 28px -20px rgba(15, 17, 21, 0.5)',
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
        lg: '5px',
        xl: '6px',
        '2xl': '8px',
      },
      letterSpacing: {
        caps: '0.16em',
      },
    },
  },
  plugins: [],
};

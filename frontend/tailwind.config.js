/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6fe',
          500: '#4f6ef7',
          600: '#3b54e0',
          700: '#3142b8',
        },
      },
    },
  },
  plugins: [],
};

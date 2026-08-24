/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"Segoe UI Variable Display"', '"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Code"', '"Cascadia Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      colors: {
        ok: '#3fd08a',
        watch: '#f0b429',
        crit: '#ff5a5f',
        intel: '#a986ff',
        azure: '#3f96ff',
        ink: '#06080d',
      },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pingslow: { '0%': { transform: 'scale(1)', opacity: '0.7' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
      },
      animation: {
        floaty: 'floaty 5s ease-in-out infinite',
        shimmer: 'shimmer 2.2s infinite',
        pingslow: 'pingslow 2.4s cubic-bezier(0,0,0.2,1) infinite',
      },
    },
  },
  plugins: [],
};

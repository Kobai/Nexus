/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--cafe-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cafe: {
          primary: c('primary'),
          secondary: c('secondary'),
          surface: c('surface'),
          text: c('text'),
          muted: c('muted'),
          border: c('border'),
          hover: c('hover'),
          active: c('active'),
          success: c('success'),
          warning: c('warning'),
          danger: c('danger'),
        },
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'cafe-sm': 'var(--shadow-sm)',
        cafe: 'var(--shadow-md)',
        'cafe-lg': 'var(--shadow-lg)',
      },
      keyframes: {
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'tab-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'status-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--cafe-success) / 0.5)' },
          '70%, 100%': { boxShadow: '0 0 0 5px rgb(var(--cafe-success) / 0)' },
        },
      },
      animation: {
        blink: 'blink 1s step-start infinite',
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'tab-in': 'tab-in 160ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
        'status-pulse': 'status-pulse 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}

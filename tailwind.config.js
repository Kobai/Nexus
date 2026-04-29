/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cafe: {
          primary: '#5D4432',
          secondary: '#E9E3DD',
          surface: '#F9F7F5',
          text: '#3E2B1E',
          muted: '#9E8E84',
          border: '#D4C9BF',
          hover: '#EDE8E3',
          active: '#D9CFC8',
          success: '#16A34A',
          warning: '#D97706',
          danger: '#DC2626',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

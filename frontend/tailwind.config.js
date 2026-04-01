/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f172a', // slate-900
          raised: '#1e293b',  // slate-800
          overlay: '#334155', // slate-700
        },
        accent: {
          DEFAULT: '#3b82f6', // blue-500
          hover: '#60a5fa',   // blue-400
          muted: '#1d4ed8',   // blue-700
        },
        muted: {
          DEFAULT: '#94a3b8', // slate-400
          strong: '#cbd5e1',  // slate-300
        },
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

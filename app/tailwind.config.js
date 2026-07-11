/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          2: 'rgb(var(--color-surface-2) / <alpha-value>)',
          3: 'rgb(var(--color-surface-3) / <alpha-value>)',
          sunken: 'rgb(var(--color-surface-sunken) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-content) / <alpha-value>)',
          2: 'rgb(var(--color-content-2) / <alpha-value>)',
          3: 'rgb(var(--color-content-3) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          "'Inter Variable'",
          "'Inter'",
          '-apple-system',
          'BlinkMacSystemFont',
          "'Segoe UI'",
          'Roboto',
          "'Helvetica Neue'",
          'sans-serif',
        ],
        display: [
          "'Andada Pro'",
          'Georgia',
          'serif',
        ],
        mono: [
          'ui-monospace',
          "'Cascadia Code'",
          "'JetBrains Mono'",
          'Consolas',
          'monospace',
        ],
      },
      borderColor: {
        DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

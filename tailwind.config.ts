import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#12202f',
        paper: '#eef2f6',
        brand: { DEFAULT: '#0b6e6a', dark: '#075350', light: '#d7efed' },
        amber: { DEFAULT: '#b7791f', light: '#fbefd5' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        black: '#000000',
        bg1: '#0a0a0a',
        bg2: '#111111',
        bg3: '#161616',
        border: '#222222',
        green: '#00FF41',
        amber: '#F59E0B',
        red: '#EF4444',
        cyan: '#22D3EE',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Syne', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

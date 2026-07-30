/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        abyssal: '#1B2632',
        marine: '#2C3B4D',
        palladian: '#EEE9DF',
        oatmeal: '#C9C1B1',
        flamme: '#FFB162',
        truffe: '#A35139',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
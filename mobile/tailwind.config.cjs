/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary:     '#00BFFF',
        background:  '#0a0a0a',
        card:        '#141414',
        border:      '#2a2a2a',
        foreground:  '#f5f5f5',
        muted:       '#888888',
        destructive: '#ef4444',
        success:     '#22c55e',
      },
    },
  },
  plugins: [],
}

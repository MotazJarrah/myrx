/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          border: 'hsl(var(--sidebar-border))',
          primary: 'hsl(var(--sidebar-primary))',
        },
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '6px',
        md: '6px',
        lg: '9px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        shrink: { '0%': { width: '100%' }, '100%': { width: '0%' } },
        // Barcode scanner aim overlay — the thin horizontal line travels
        // from the top of the aim frame to the bottom and back, giving
        // the user a visual cue that the scanner is live. Uses `top`
        // (not transform) so it overrides the static `top-1/2`
        // positioning class in BarcodeScanner.jsx during the animation.
        scanline: { from: { top: '0%' }, to: { top: 'calc(100% - 1px)' } },
      },
      animation: {
        shrink:   'shrink 3s linear forwards',
        // `alternate` so the line bounces between top and bottom without
        // a hard snap. 2s = one full top→bottom→top cycle (4s round trip).
        scanline: 'scanline 2s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
}

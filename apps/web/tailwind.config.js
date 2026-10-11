/** @type {import('tailwindcss').Config} */
// V12 design tokens. Colours are RGB channels defined in src/index.css (:root) so that the
// opacity modifier works: `bg-ink-900/60`, `text-glacier/80`, `border-line/40`.
const channel = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Midnight ink: the field everything sits on, darkest to lightest.
        ink: {
          950: channel("ink-950"),
          900: channel("ink-900"),
          800: channel("ink-800"),
          700: channel("ink-700"),
          600: channel("ink-600"),
          500: channel("ink-500"),
        },
        // Text roles (all >= 4.5:1 on ink-900).
        fg: { DEFAULT: channel("fg"), 2: channel("fg-2"), 3: channel("fg-3") },
        // Glacial accent family.
        glacier: channel("glacier"),
        cobalt: channel("cobalt"),
        indigo: { DEFAULT: channel("indigo") },
        amethyst: channel("amethyst"),
        // Scientific status roles.
        ev: {
          reference: channel("ev-reference"),
          validated: channel("ev-validated"),
          simulated: channel("ev-simulated"),
          hypothesis: channel("ev-hypothesis"),
          inconclusive: channel("ev-inconclusive"),
        },
        danger: channel("danger"),
        line: channel("line"),
        // Legacy aliases kept so older class names keep resolving.
        background: channel("ink-950"),
        surface: channel("ink-900"),
        "surface-elevated": channel("ink-700"),
        "cyan-glow": channel("glacier"),
        "uv-purple": channel("amethyst"),
        "status-pass": channel("ev-validated"),
        "status-fail": channel("danger"),
        "status-warn": channel("ev-hypothesis"),
      },
      fontFamily: {
        sans: ['"Instrument Sans Variable"', '"Instrument Sans"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        display: ['"Newsreader Variable"', "Newsreader", "ui-serif", "Georgia", "serif"],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Type scale: nothing below 12px for information. 2xs is reserved for kbd hints / counters.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.6rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.5rem", { lineHeight: "2.75rem" }],
      },
      borderRadius: {
        panel: "14px",
        control: "10px",
      },
      boxShadow: {
        panel: "0 18px 40px -22px rgb(0 0 0 / 0.7), inset 0 1px 0 rgb(255 255 255 / 0.05)",
        glow: "0 0 0 1px rgb(var(--glacier) / 0.35), 0 0 24px -4px rgb(var(--glacier) / 0.35)",
      },
      transitionTimingFunction: {
        "out-quint": "cubic-bezier(0.2, 0.8, 0.2, 1)",
        "in-out-soft": "cubic-bezier(0.45, 0, 0.2, 1)",
      },
      transitionDuration: {
        fast: "180ms",
        base: "260ms",
        slow: "450ms",
      },
      keyframes: {
        "hud-in": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "none" } },
        "stage-in": { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "none" } },
        "pulse-ring": { "0%": { transform: "scale(0.8)", opacity: "0.8" }, "100%": { transform: "scale(2.2)", opacity: "0" } },
        "toast-in": { "0%": { opacity: "0", transform: "translateY(10px) scale(0.98)" }, "100%": { opacity: "1", transform: "none" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        "hud-in": "hud-in 0.45s cubic-bezier(0.2,0.8,0.2,1) both",
        "stage-in": "stage-in 0.32s cubic-bezier(0.2,0.8,0.2,1) both",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
        "toast-in": "toast-in 0.26s cubic-bezier(0.2,0.8,0.2,1) both",
        shimmer: "shimmer 2.2s linear infinite",
      },
    },
  },
  plugins: [],
};

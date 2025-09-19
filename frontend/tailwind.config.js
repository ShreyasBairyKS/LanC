/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",   // Deep blue
        secondary: "#10B981", // Emerald green
        warning: "#F97316",   // Orange
        danger: "#DC2626",    // Red
        dark: "#111827",      // Almost black
        muted: "#6B7280",     // Muted gray
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
}

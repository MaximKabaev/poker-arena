import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        felt: { DEFAULT: "#0e5132", dark: "#093721", light: "#1a6b46" },
        chip: { red: "#c0392b", blue: "#2980b9", green: "#27ae60" },
      },
      boxShadow: {
        glow: "0 0 24px rgba(255, 215, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;

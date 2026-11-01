/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f6f1",
        ink: "#192721",
        emerald: { 50: "#eff7f1", 100: "#e1f0e5", 600: "#187451", 700: "#106347", 800: "#0d513c" },
        amber: { 50: "#fff6e4", 100: "#ffedca", 700: "#a85a0a" },
        line: "#e9e6de",
      },
      fontFamily: { sans: ["Vazirmatn", "Tahoma", "sans-serif"] },
      boxShadow: { soft: "0 12px 36px rgba(32, 44, 37, .06)" },
    },
  },
  plugins: [],
};

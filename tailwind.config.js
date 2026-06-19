/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 蓝色主题(见 plan.md UI 规范)
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // macOS 红绿灯按钮颜色(用于自定义窗口控制按钮)
        traffic: {
          red: '#ff5f57',
          yellow: '#febc2e',
          green: '#28c840',
        },
      },
    },
  },
  plugins: [],
};

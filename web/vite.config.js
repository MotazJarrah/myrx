import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // .env.local lives at the repo root (one level up from web/), not inside
  // web/. By default Vite would only pick up env files in the project root
  // (web/), so VITE_FOOD_ADMIN_KEY was silently empty in every build —
  // every browser-side call to the worker's protected admin endpoints
  // sent `Authorization: Bearer ` (empty) and got 401 back. Setting
  // envDir='..' tells Vite to load .env files from the repo root.
  envDir: '..',
})

# Module 4 — Source Diff Summary

**Preserved:** `src/styles.css`, premium UI layout, existing Gmail reader/composer, email approval modal, OAuth/session logic, encrypted drafts and attachments, Groq backend/AI prompts, original test suite, demo mode.

**Added:** `backend/src/monitoring/monitor.mjs` (state/cursor/dedup/outbox), `backend/src/monitoring/push.mjs` (optional FCM v1), authenticated monitoring and push endpoints, `/internal/cron/monitor` secret-only endpoint, Settings monitoring controls and FCM consent button, PWA manifest/service worker/Firebase adapter, Android TWA source scaffold, Docker/Caddy source deployment, Cloudflare cron relay, security/privacy/API/Android/setup docs and new deterministic tests.

**Changes:** `backend/src/server.mjs`, `backend/package.json`, `backend/.env.example`, `src/App.tsx`, `src/main.tsx`, `src/services/api.ts`, root `package.json`, root `index.html`, root `.gitignore`.

**Not implemented / not verified:** production website deployment, real Gmail/AI/FCM integration tests, actual scheduled cloud execution, production Android APK, emulator/device integration, distributed SQL migration, backup/restore test and a verified $0 account. Do not describe these as finished.

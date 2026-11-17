# Module 4 Hosting & Secure Deployment — OWNER-RUN, NOT DEPLOYED

**Current status: NO public app URL exists. NO cloud cron is active. NO cloud credentials are included.** These steps must be completed in the owner's accounts. Do not copy secrets into chat or GitHub.

## Why these hosting components?

- **Node.js 22 + SQLite** already exist in the reviewed source. Cloudflare Workers+D1 is **not** a drop-in replacement for `node:sqlite` or the existing Express session/store and cannot be represented as completed without a full backend port.
- **Oracle Cloud Always Free VM** is a potential host for one owner, with persistent boot/block volume and Docker. Eligibility, capacity, card verification, idle-resource reclamation and quotas are real restrictions. It is neither guaranteed obtainable nor guaranteed uninterrupted.
- **Cloudflare Workers Free cron** can call a secret-protected scheduler endpoint at `*/15 * * * *` (UTC), without storing user Gmail data. Up to five cron triggers and current Free platform limits apply; this Worker **is not a replacement** for an always-on durable backend.
- **Firebase Cloud Messaging** is currently a no-cost product, but browser/device support, limits and policy may change. The backend uses FCM HTTP v1; Firebase service-account JSON belongs ONLY in the server secret manager.
- Render Free is unsuitable for this SQLite data because local files can vanish on restarts/idle spindown. Render Free PostgreSQL has a 30-day expiry. Do not deploy current `DB_PATH` there and treat it as durable.

Sources (official, checked November 2026):
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://www.oracle.com/cloud/free/faq/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://render.com/docs/free
- https://firebase.google.com/pricing

## Owner-run production setup

1. Obtain an eligible persistent Linux VM, configure OS security updates, SSH keys, inbound firewall ports 80/443, SSH restricted to your IP, and Docker Compose. This may require adult account/card holder where provider terms demand one.
2. Obtain or control a stable domain name pointing at the VM. A domain can have a separate annual cost; use an existing owned domain if available. Do not assume a custom hostname is free.
3. On the VM, clone the repository privately or upload the release ZIP. Work inside `cloud/oracle/`.
4. Copy `cloud/oracle/.env.example` to `cloud/oracle/.env`. Fill credentials **on the VM** (or host secret manager), generate a different random 32-byte base64 encryption key and high-entropy `MONITOR_CRON_SECRET`. Set `ALLOWED_GMAIL_ADDRESS` to the exact authorized account. NEVER commit this .env.
5. Edit `cloud/oracle/Caddyfile` to replace `example.invalid` with the hostname. Set `BASE_URL` and `FRONTEND_ORIGIN` to **the same HTTPS origin**. Set `GOOGLE_REDIRECT_URI` to `https://YOUR_DOMAIN/api/auth/google/callback`.
6. In Google Cloud Console, create an OAuth Web Application client, enable Gmail API, configure OAuth consent/test account and *exact redirect URI*. This app requests restricted `gmail.modify`, which may require OAuth verification/security assessment for broader production. Testing mode may issue seven-day refresh tokens; don't claim indefinite monitoring in Testing mode.
7. Launch: `docker compose -f cloud/oracle/compose.yaml --project-directory cloud/oracle up -d --build` from repository root after creating the compose `.env`. Confirm TLS/certificates, `GET /api/health`, same-origin CSRF, working OAuth and persistence after restart.
8. Make a private encrypted SQLite backup before and after schema changes. Restore from a tested backup on a stopped server; include `*.sqlite-wal` state or use SQLite online backup, never blindly copy only the live DB file while writes continue.
9. Only after backend is reachable, create a Cloudflare account and set `cloud/cron/wrangler.toml` URL to the HTTPS site. From `cloud/cron` run `npx wrangler secret put MONITOR_CRON_SECRET` (same random value as backend), then `npx wrangler deploy`. Enable `MONITOR_WORKER_ENABLED=true` on backend, restart, opt in through Settings and verify **multiple scheduled checks**; Worker Logs must show successes. A source file alone is NOT proof of monitoring.
10. Set up Firebase Cloud Messaging project only if you want notifications. Store base64-encoded Firebase service-account JSON as `FIREBASE_SERVICE_ACCOUNT_JSON_B64` on the server; browser public config in root `.env` (Vite variables) and `public/firebase-config.js`, not private credentials. Rebuild frontend, select *Enable notifications* in Settings, grant browser permission and verify controlled test push on Android.
11. Test Google OAuth, one controlled inbox message, Roman Urdu summary with Groq consent, a drafted reply, exact recipient/attachment review and **specific manual approval**. Never use an unapproved automated test to send mail.

## PWA / Android

Until the APK is actually built and signed, open the deployed HTTPS website in Chrome on Android and choose **Install app**. For TWA APK source in `android/` see `docs/MODULE4_ANDROID.md`.

## Cost / quota planning

| Component | Free-tier status | Real constraint |
|---|---|---|
| Oracle Always Free VM | Potential $0 | Capacity, card/eligibility, idle reclamation, quotas; no guarantee |
| Cloudflare Workers Cron | Free within limits | Scheduled timing best effort, 5 triggers/account, Workers free limits |
| Firebase Cloud Messaging | No-cost | Device/browser permission, Android delivery not guaranteed |
| Google Gmail API | API usage quotas | OAuth restricted-scope verification/security assessment can create significant compliance burden/cost |
| GroqCloud | Possible free tier | Model/usage limits and policy subject to change; cannot promise free unlimited AI |
| HTTPS | Caddy/Let's Encrypt free software | Stable domain/DNS/service may cost |
| APK development | Android SDK toolchain free | Play Store publishing has separate fees (not included) |

**Measured production usage:** N/A; no deployment or live credentials in this environment. Do not present invented latency, quotas consumed, or a fake URL.

## Recovery

- Scheduler down: monitoring status becomes `Waiting for worker` after its heartbeat ages; manual Gmail refresh remains available.
- Gmail OAuth revoked/expired: monitoring reports Reauthorization Required; reconnect via Google OAuth.
- Gmail history expired (404): baseline resets with explicit missed-change warning; check inbox manually.
- FCM fails: outbox persists pending events and retries (up to five attempts). It may need manual recovery beyond this threshold.
- Uncertain Gmail send: send remains `unknown` and never auto-retries; inspect Gmail Sent and contact support before taking further action.

### Persistent directory ownership

Before starting Compose on Linux, create `cloud/oracle/persistent/` and restrict its permissions to the `node` container user (usually UID 1000): `sudo install -d -m 700 -o 1000 -g 1000 cloud/oracle/persistent`. Otherwise a host-created root-owned bind mount can make SQLite unwritable. Confirm this on the actual server; do not chmod the directory world-writable.

### Private online backup (source script locally tested)

With the `node:sqlite` backup API on a host where Node can see the DB, run `DB_PATH=/srv/lifepilot/lifepilot.sqlite node backend/scripts/backup.mjs /private/secure-backups/lifepilot-YYYYMMDD.sqlite`. The command refuses overwrite and runs an integrity check. The backup contains sensitive metadata: store it on encrypted private media, with a retention policy. Before restore, stop the backend, test the backup using `node backend/scripts/check-db.mjs /path/to/backup.sqlite`, then perform an explicit owner-controlled restoration. Do not commit backups.

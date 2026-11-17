# LifePilot AI — Automatic Drafts + Explicit Approval + PC-Off Deployment

**Version:** Auto-Approval Upgrade, 14 November 2026. **Status:** source implemented and mocked tests passed; NOT deployed. Never claim live PC-off monitoring until measured after cloud deployment.

## Desired flow (no automatic sending)

```
NEW incoming Gmail → secure periodic history synchronization
  → identify direct, eligible message (skip OTP, automated, sensitive categories)
  → if both privacy consents enabled, submit selected message to GroqCloud
  → validate Roman Urdu/English summary + cautious suggested reply
  → save encrypted PENDING draft with original Gmail Reply-To/thread ID
  → queue a generic Android/web alert, linking to Approval Center
  → owner reviews exact To, Cc, Bcc, subject, body, attachments, draft version
  → owner explicitly requests review and approves the current version
  → ONLY THEN Gmail send API is called and message ID checked
```

The model has **no automatic send route**. No promise of sending all emails, perfect drafts, immediate delivery, zero downtime or unlimited provider usage is made. The existing Gmail approval/version/hash and one-attempt send reservation remain unchanged.

## A. Local controlled test on your PC

1. **Make a private backup before replacing code**. Save your existing `backend/.env` privately and back up the current SQLite database using the repository backup script. NEVER include either in source-control or upload them to chat. Keep the *same* `TOKEN_ENCRYPTION_KEY_B64` if you retain the existing database.
2. Stop old backend with **Ctrl+C** and make sure port 8787 is available. From the upgraded project root run `npm install`, `npm --prefix backend install`, `npm run typecheck`, `npm run build`, `npm run test:backend`, `npm test` and `npm run test:e2e` on a machine with working npm registry access. Do not proceed with production use when these fail.
3. In private `backend/.env`, configure valid Google OAuth values and a **new, non-exposed** Groq key. Set `AI_ENABLED=true`, `AI_PROVIDER=groq`, `MONITOR_INTERNAL_TIMER_ENABLED=false`, and `MONITOR_WORKER_ENABLED=false` for normal local tests. Run `npm --prefix backend run check:automation` (prints flags but never secrets) and `npm --prefix backend run check:groq` (live provider availability; avoid sharing output containing any secret).
4. Start `npm run dev:backend` and `npm run dev` in separate terminals. Open **http://localhost:5173** (not port 8787). Confirm Gmail Connected and AI enabled in Settings.
5. Read external-processing notice, enable **Allow AI to process selected Gmail messages** only if you agree to send selected content to GroqCloud. Enable **Monitor new inbox messages**, then **Optional automatic AI summaries and review-only drafts** as a *separate* consent.
6. Set **Which incoming emails** to `Primary only` or explicit `All eligible inbox (Primary, Updates, Forums)`; Promotions/Social/OTPs/security/financial/automated senders stay excluded. Configure daily draft cap between 1 and 25. New email content may leave your backend and be processed by an external AI provider.
7. Click **Check Gmail changes now** once to establish a cursor. This does **not** process the 2,000+ old emails. From a controlled second Gmail account send one NEW, non-sensitive message from a human sender to your connected account. Click **Check Gmail changes now** again. Review the **AI drafts created**, **pending**, **excluded**, and **failed** counters in Settings.
8. Open **Approval Center**. Verify recipient and message are accurate; edit if needed. Do NOT press Approve/Send during a draft-only test. If you choose to test an actual send later, use a recipient you own, explicitly approve that exact message, and inspect Gmail Sent for the accepted ID.
9. Any `Request origin mismatch` during local testing means the browser origin is different from configured `FRONTEND_ORIGIN`; use `http://localhost:5173`, and keep backend `BASE_URL=http://localhost:8787`.

**Local-only limitation:** the automated timer DOES NOT work when your PC is powered off.

## B. Cloud setup needed for PC-OFF monitoring (not completed here)

The current backend uses Node.js 22.13+, Express and `node:sqlite` with encrypted records and session cookies. It requires a continuously reachable **persistent host** with durable storage; Cloudflare Workers alone cannot run this unmodified Node/SQLite application.

1. Provision a legitimate cloud VM/account that permits a running service and durable encrypted storage. Oracle Always Free is one *possible* option, not guaranteed (availability, billing/card verification and idle reclamation apply). Prefer a single dedicated VM for the existing SQLite database.
2. Set up HTTPS with a domain and Caddy, private persistent directory with owner-only access, restricted SSH/firewall, encrypted backups, operating-system patches and monitored server uptime. The repository includes `cloud/oracle/compose.yaml`, `cloud/oracle/Dockerfile` and `cloud/oracle/Caddyfile`.
3. Configure **private** `cloud/oracle/.env`: `NODE_ENV=production`, `BASE_URL=https://YOUR_DOMAIN`, `FRONTEND_ORIGIN=https://YOUR_DOMAIN`, matching `GOOGLE_REDIRECT_URI=https://YOUR_DOMAIN/api/auth/google/callback`, `TRUST_PROXY=true`, persistent `DB_PATH=/srv/lifepilot/lifepilot.sqlite`, Google/Groq credentials, and the existing encryption key if migrating an existing DB. Do not paste any secret into ChatGPT or public GitHub.
4. Add the exact HTTPS callback to Google Auth Platform → Clients → your Web OAuth client. Re-authorize the connected Gmail account on the production hostname. OAuth **External/Testing** with Gmail scopes generally issues a 7-day refresh token; background work will stop when it expires. Account policy/verification may require separate action and cost.
5. On a **single durable cloud VM only**, set `MONITOR_INTERNAL_TIMER_ENABLED=true`, `MONITOR_POLL_INTERVAL_MS=900000` (15 minutes), `AUTO_AI_BATCH_SIZE=3` and `MONITOR_WORKER_ENABLED=false` (don't enable both independent schedulers). Deploy the stack with `docker compose -f cloud/oracle/compose.yaml --project-directory cloud/oracle up -d --build` from the repo root after validating Compose config; verify HTTPS `/api/health`, CSRF, persistent database across restart, and app monitoring status.
6. In the cloud app Settings, enable monitoring and auto AI review, explicitly selecting maximum daily drafts/scope. A scheduler flag alone is NOT proof of an active scheduler. Verify two `last successful sync` timestamps separated by real scheduled intervals.
7. Configure Firebase Cloud Messaging privately if Android/browser push approval alerts are required. Service account JSON stays on server, public Firebase web config stays in public frontend configuration, and a real phone/browser must grant notification permission. Test a generic alert and Approval Center deep link.
8. **PC-off acceptance test:** disconnect/shut down the local PC; send a new test email from another controlled account; confirm cloud monitoring `lastSuccessAt` advanced, an encrypted pending draft exists, a notification reaches the phone, and the exact draft can be reviewed from mobile. Check server/container logs without private message text. Only then describe PC-off monitoring as demonstrated.
9. Test an actual approved send **only with your own Gmail and a controlled recipient after explicit review**. Confirm Gmail message ID, no duplicate send, and web+phone status. Never turn on auto-send.

## C. Why not “every email, 100%”?

- Spam, promotions, automated messages, OTPs and many sensitive items are filtered deliberately. Broad selection includes only eligible Primary, Updates and Forums items.
- The automatic draft cap is **1–25 created replies per UTC day**. Additional pending eligible messages remain queued, subject to privacy settings and retries. The backend attempts **1–5** items per scheduled cycle (`AUTO_AI_BATCH_SIZE`); heavy traffic may back up.
- Email body may be too long; such messages are excluded and require manual review to avoid false claims.
- Groq may rate-limit, go down, or produce inaccurate text; these conditions are surfaced and never cause unapproved sends.
- Gmail's history cursor can expire. The code performs bounded recovery with a warning, not an unconditional guarantee that every message can be recovered.
- Provider quotas, hosting availability, OAuth authorization, device/OS notification delivery and browser speech support cannot be guaranteed.

## D. Safe command checklist

```powershell
# Project root, Windows PowerShell
npm install
npm --prefix backend install
npm run check:backend
npm run test:backend
npm test
npm run typecheck
npm run build
npm run test:e2e
npm --prefix backend run check:automation
npm --prefix backend run check:groq
npm run dev:backend
# In a SECOND terminal:
npm run dev
```

To debug: provide ONLY the redacted error message, never `backend/.env`, OAuth JSON, full email content, tokens or private keys. Rotating a key after pasting it publicly is necessary before using it.

## References (official documentation)

- [Gmail history synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Google OAuth refresh-token expiry](https://developers.google.com/identity/protocols/oauth2)
- [Oracle Always Free constraints](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

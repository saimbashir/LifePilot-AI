# Final Repair Changelog — 13 November 2026

**Source baseline:** Exact nested Module 4 ZIP from the final handoff. No new visual design, replacement UI, Gmail OAuth flow or send method was introduced.

### Added

- `backend/src/monitoring/assistant.mjs`: opt-in auto-summarize + suggested replies, conservative eligibility, daily cap, encryption and pending-only draft creation.
- New monitoring settings and status fields in `src/App.tsx`, `src/services/api.ts`.
- Backend consent-protected `/api/monitoring/auto-ai` and summary/event fields in `backend/src/server.mjs`.
- One process-local periodic scheduler for single-instance deployed VMs, disabled by default.
- Additive SQLite columns for monitoring events and persisted AI processing state (existing DB and cursor retained).
- `backend/test/module4-auto-ai.test.mjs` and expanded monitoring / push tests for consent, replay, failure and approval safety.
- Responsive CSS corrections for small screens and `qa/preview_browser_smoke.py`; offline preview screenshots labeled as demo.
- Final QA, cloud owner-checklist, audit copy and release blocker documentation.

### Changed

- `backend/src/monitoring/monitor.mjs`: Gmail `history.list` expired-cursor bounded reconciliation and post-triage notification ordering.
- `backend/src/monitoring/push.mjs`: per-device state for partial FCM retries; notification route to Inbox or Approval Center.
- `backend/src/gmail.mjs`: conservative automated-mail metadata for AI eligibility (List-Unsubscribe/auto headers).
- `public/sw.js`: whitelisted Inbox/Approval Center notification deep link instead of fixed Inbox only.
- Cloud `.env.example` templates and README: explicit opt-in/timer settings and honest deployment limitations.

### Unchanged safety boundary

`backend/src/store.mjs` send reservation and approval logic, `/api/drafts/:id/request-review`, `/approve`, `/send`, existing Gmail OAuth storage and user confirmation. No direct send method was added to Groq/AI/monitoring. The original design language and navigation remain in place.

### Remaining

Genuine npm lockfiles, production React validation, Android build, HTTPS deployment, Gmail/Groq/FCM live verification and device testing require the owner's runtime/account environment; see `FINAL_QA_REPORT.md`.

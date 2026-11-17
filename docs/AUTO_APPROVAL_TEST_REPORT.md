# Auto-Approval Upgrade — Test Evidence (2026-11-14)

Source: existing LifePilot-AI-Final-Repaired-Source.zip, preserving its original app UI, Gmail routes, Groq provider, encrypted drafts, and send-approval workflow.

## Executed checks

| Check | Observed result | Scope |
|---|---|---|
| `npm run check:backend` | **PASS** | Node syntax for backend modules |
| `npm run test:backend` | **92 passed, 1 skipped, 0 failed** | Mock Gmail, model responses, drafts, monitoring, FCM; 93 total |
| `npm test` | **6 passed** | Offline preview unit tests, not React bundle |
| `python qa/preview_browser_smoke.py` | **27/27 viewport/screen checks passed** | Original standalone preview (1440/390/320), not new React controls |
| TypeScript/TSX source transpile syntax | **5/5 passed** | Syntax only, not semantic typecheck |
| `npm install` | **FAILED: `EAI_AGAIN`** | npmjs.org DNS failure prevents installing React/Playwright deps |
| `npm --prefix backend install` | **FAILED: `EAI_AGAIN`** | npmjs.org DNS failure prevents Express installation |
| `npm run typecheck` | **BLOCKED** | Missing React typings and dependencies; cannot infer semantic pass |
| `npm run build` | **BLOCKED** | tsc cannot resolve npm packages; no production bundle produced |
| `npm run test:e2e` | **NOT VERIFIED** | React dev server and Playwright npm package unavailable |
| Live Gmail/Groq OAuth/send | **NOT VERIFIED** | Requires owner-controlled live account/environment and specific approval |
| PC-off cloud monitoring | **NOT VERIFIED** | No cloud VM connected/deployed |
| Android real push notifications | **NOT VERIFIED** | No configured Firebase service account/device in environment |

## Code changes and verified cases

- Existing React look and layout unchanged. Added monitoring scope selector (`Primary` / `All eligible inbox`) and 1–25/day limit. Client API adapter updated accordingly.
- Added safe eligibility checks for sensitive content and excluded automated senders/categories.
- Queue processes up to 3 eligible messages per scheduled check by default, configurable 1–5; eventual processing is quota-dependent.
- Pending AI review defers push alert until an approval draft is ready; failure/skip can produce generic inbox alert. Prevents premature 'approval ready' interpretation.
- Disabling automatic review marks queued events skipped; revoking external-AI consent disables auto review on backend, so no queued content is uploaded after opt-out.
- Added read-only `npm --prefix backend run check:automation` which prints *flags only*, never credentials.
- Existing server-authoritative approved send, version/content hash check, single send reservation and verified Gmail message ID return were **not modified**.
- Tests cover the broad opt-in, daily cap validation, duplicate-mail dedup, no automatic sends, opt-out, and deferred alert states.

## Remaining blockers

A real working PC-off installation needs a deployed persistent cloud host, HTTPS/domain, Google OAuth production callback, new private Groq key, Gmail renewal, explicit consent, notification provider configuration and device testing. These cannot be performed without the owner's external accounts and device. This ZIP is an improved **source**, not proof of a deployed service. No public URL/APK created.

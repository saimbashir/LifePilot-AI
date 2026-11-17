# LifePilot AI Module 2 — Independent Code Review (13 Nov 2026)

## Verdict

**Conditional pass for moving to Module 3 development after local React-build verification.** The backend's security-critical flow is thoughtfully designed and its mocked tests pass. But this is not yet an end-to-end verified Gmail application: actual Google OAuth/live sending, React dependency installation/build/typecheck, real browser E2E and cloud monitoring remain unverified or undeployed.

## Project actually inspected

- ZIP: `LifePilot-AI-Module2(1).zip` (34 initial archive entries; one project root).
- Backend: Express + Gmail REST, Node 22 built-in SQLite, AES-GCM storage, OAuth PKCE/state, sessions, CSRF, explicit approval + one-time send reservation.
- Frontend: React/Vite/TypeScript and separate offline visual preview, 10 screens, demo vs live Gmail mode, typed API adapter.
- Existing tests: 16 mocked backend security/store/Gmail tests and 6 offline preview tests.

## Positive checks

- Real Gmail OAuth login is designed with a single-email allowlist and server-side tokens.
- Drafts, recipient data and uploaded attachments are encrypted in local SQLite.
- Approval requires current version + content hash, and Gmail sending is one-time reserved.
- Unknown send status is not automatically retried.
- The live Gmail workspace does not pretend template-based AI responses are real.
- Explicit monitoring status is 'manual', not falsely 'always monitoring'.

## Problems found and corrected in v2.0.1

1. **Unnecessary Gmail bursts:** up to 25 full-message requests happened simultaneously; capped to five concurrent detail requests.
2. **Duplicate token refresh:** concurrent Gmail calls could refresh the same account's OAuth token multiple times; added in-flight refresh deduplication.
3. **Potential indefinite delay:** Google API requests had no timeout; added bounded 18-second abort signal (server read requests still need deployment-level timeouts).
4. **Incorrect reply recipient:** `Reply-To` was ignored; outgoing mail was not handled correctly when replying to a sent message. Fixed routing, maintained message threading.
5. **Malformed cookie parsing:** a stray bad URL escape could throw; parsing now handles it gracefully.
6. **Potential draft data loss:** adding/removing attachments could overwrite unsaved To, Cc, Bcc, subject and body changes. Draft content is saved to backend first, then attachment operation returns fresh state.
7. **Wasted Gmail calls in Drafts/Suggested tabs:** these views triggered full Gmail inbox fetching. Now drafts use the persisted local draft API, while Suggested accurately says Module 3 AI is not ready.
8. **Misleading rich text controls:** live Gmail outgoing emails are plain text; formatting buttons are disabled and the editor labels this accurately.
9. **No integrated CI:** added a GitHub Actions workflow that installs dependencies and runs typecheck, build, mocked backend unit tests, preview tests and Playwright E2E. Its actual GitHub run has not happened yet.

## Tests independently executed in this review

- `npm --prefix backend test`: **21 passed / 0 failed** (16 original plus 5 new reliability/security tests).
- `npm test`: **6 passed / 0 failed** (offline design preview, not React).
- `npm run check:backend`: **passed** (Node syntax).
- TypeScript parser diagnostics for `src/App.tsx`, `src/types.ts`, `src/services/api.ts`: **0 parser errors**; this is **not** type checking.
- Chromium offline-design preview via injected CSS/JS at 1440/390/320px: **0 page JS errors, 0 horizontal overflow** on landing. This is **not the actual React application**.
- Secret/config file scan: local DB, OAuth token and private `.env` files were not in the reviewed source ZIP. `.env.example` has placeholders only.

## Not independently verified

- `npm install` failed in the review runtime because `registry.npmjs.org` could not be reached (`EAI_AGAIN`). Consequently **React production build, semantic TypeScript typecheck, and Playwright React E2E were NOT RUN**.
- No real Gmail credentials were provided. **OAuth callback, real message threading/attachments and real approved email sending remain untested end-to-end**.
- Full MIME charset/HTML compatibility, mobile device microphone permission, cloud deployment, notification delivery and monitoring worker were not tested.
- The current backend uses Node-specific SQLite and a persistent local file. It will **not automatically become a Cloudflare Workers/D1 application** without a later storage/hosting adapter and migration work.

## Recommended local verification BEFORE submitting to professor or publishing

```bash
npm install
npm --prefix backend install
npm run typecheck
npm run build
npm run check:backend
npm run test:backend
npm test
npx playwright install chromium
npm run test:e2e
```

Then configure `backend/.env` using `backend/.env.example` and `docs/GOOGLE_OAUTH_SETUP.md`, use a Gmail account and test recipient you control, and verify real login, inbox, search, threading, draft review, attachment preservation, manual sending and logout. Never upload credentials or private Gmail data. Do not call the app production-ready until these pass.

## Module 3 direction

Use the separately supplied `LifePilot_Module3_Developer_Prompt.md` with the corrected Module 2 ZIP. Keep existing Gmail security and approval flows, add backend GroqCloud AI/structured intents/Roman Urdu summaries, typed and voice commands, and user-editable preferences. Defer cloud monitoring, Android and full deployment to Module 4.

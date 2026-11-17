# LifePilot AI — Module 3 Handoff

**Source baseline:** Reviewed Module 2 source. **Stop boundary:** Only implement Module 3 Groq AI + voice, no Android packaging or cloud background monitor yet.

Use `LifePilot_Module3_Developer_Prompt.md` supplied alongside this release for the complete implementation instructions.

## Existing, proven contracts

- Node 22.13+ backend, Express in `backend/src/server.mjs`; secure Gmail adapter in `backend/src/gmail.mjs`.
- OAuth credentials, refresh tokens, and Gmail session only exist in backend; authenticated JSON API has CSRF validation on mutation routes.
- Gmail folders, search, thread reads, attachments, labels, local encrypted drafts, and one-time approved sending already have backend unit tests.
- React/Vite/TypeScript UI in `src/App.tsx`, typed API adapter in `src/services/api.ts` and types in `src/types.ts`.
- Demo mock response engine in `src/services/mockEngine.ts` must stay **demo-only**.
- The `GET /api/monitoring` endpoint explicitly says the cloud monitoring worker is **not deployed**.

## Critical constraints

1. **Do not change** OAuth scope, `Gmail.modify` grant, cookie/CSRF protections, or Gmail send approval endpoints unless a fix is necessary and tested.
2. AI must never invoke `POST /api/drafts/:id/send`; only user-initiated approval UX may do so.
3. AI works only on explicit authorized user actions or later opt-in automatic analysis. Do not send an entire inbox to an LLM.
4. Model/provider key belongs in `backend/.env` or a server secret manager, not React code.
5. Preserve exact draft version, contentHash and approvalId state transitions. AI writes a **proposed** draft; any edit invalidates previous approval.
6. Make Roman Urdu / simple English summaries and typing fallback reliable before claiming voice commands work end to end.
7. React real Gmail app **still requires npm install, typecheck, build and Playwright runs** in a registry-connected environment. CI workflow is included but its outcome is unverified until actually run on GitHub.

## Issues corrected in this review

- Gmail `Reply-To` address routing; sender-self replies now go to the original recipient.
- At most five concurrent Gmail detail fetches per inbox page.
- At most one concurrent refresh-token exchange per account.
- Network requests now have an 18-second timeout rather than hanging indefinitely.
- Malformed cookie escapes no longer crash parsing.
- Attachments save unsaved draft text before server updates; attachment deletion does likewise.
- Drafts and mock-only suggestions no longer perform redundant inbox message fetching.
- Real-Gmail editor now identifies plain-text-only mode and disables formatting buttons that wouldn't survive sending.

## Known limits

- No live Google OAuth, Gmail send or full provider acceptance tests were run; requires an account/credentials controlled by the owner.
- React package installation is blocked by npm registry DNS from this environment, so production build/typecheck/e2e cannot be certified here.
- No deployed cloud worker, Android app, real AI integration, real voice command intelligence or guaranteed free service.

# LifePilot AI — Module 3 Changelog / Diff Summary

## Foundation kept intact

Reviewed `LifePilot-AI-Module2` v2.0.1 used as the source. The existing `gmail.mjs`, security-session helpers, OAuth endpoints, Google scopes, one-time draft approval/send reservations and almost all frontend CSS were preserved. The original app's design/layout and 10 screens remain.

## Changes added

- `backend/src/ai/provider.mjs`: backend-only Groq client with timeout/rate-limit/safe failures and configurable model.
- `backend/src/ai/prompts.mjs`: dedicated role and untrusted-email prompts; Roman Urdu, English, writing style.
- `backend/src/ai/schemas.mjs`: validated inputs and AI output shapes.
- `backend/src/ai/intent.mjs`: structured, bounded command interpretation and deterministic Gmail lookup / ambiguity handling.
- `backend/src/ai/routes.mjs`: status, consent, summarize, reply, compose, command and preferences endpoints.
- `backend/src/store.mjs`: account-scoped AI consent, encrypted writing preferences, usage counters; account deletion cascades.
- `backend/src/server.mjs`: mounted AI endpoints after existing session middleware, passing original CSRF function.
- `src/services/ai.ts`: typed client API adapter using original CSRF-protected request helper.
- `src/App.tsx`: live AI integration in existing reader/composer/summary/voice/settings, language switcher, transcript review, TTS stop/rate, AI opt-in; original demo engine remains isolated.
- `src/styles.css`: small additive component styles for AI instructions and disambiguation (no redesign).
- New provider, schemas, intent and route-handler test suites; conditional Express integration suite; React E2E mock fixtures.
- `backend/scripts/check-groq.mjs`, placeholder-only `.env.example`, updated README and security/API/test docs.

## Explicitly unchanged

No Module 4, no Android build/cloud monitor, no automatic AI sending, no new OAuth scope, and no new logic inserted in the existing Gmail send endpoint.

# LifePilot Module 4 Privacy & Security Notes

## Data processing

The user explicitly connects their own allowlisted Gmail account through Google OAuth. Authorized backend requests can fetch specific Gmail emails and threads. Requests for AI summaries/replies require an independent opt-in; only specifically selected emails are forwarded to Groq. The background monitor **can send eligible new-email content to Groq only after two separate opt-ins** (external AI processing and automatic AI review). It excludes known automated/sensitive messages, enforces a daily draft cap and never sends email. Disabling AI consent also cancels queued automatic review work.

Backend persistence uses local SQLite with encrypted OAuth refresh tokens, message drafts, attachments and FCM device tokens under a 32-byte AES-GCM master key. SQLite records of monitoring events contain opaque message IDs and timestamps (not full emails). The owner must protect server disk, encryption key, cloud credentials and backups. Changing the master encryption key without migrating data will make stored ciphertext unreadable.

In the browser, the application keeps only demo data and UI preferences in local storage. Never store Gmail OAuth tokens, Groq secrets, FCM service-account JSON or complete Gmail archives in browser storage. The `sw.js` cache contains **only the public web shell and static assets**, explicitly excluding all `/api/*` fetches.

FCM messages have the generic lock-screen text *'New email available for review'*. They contain an opaque ID and a route, not sender, subject, or email body. Notification delivery is best-effort; duplicates may occur after network ambiguity. Push device registration is user-initiated and account-scoped; disabling service requires unregistration and/or disconnect.

## Security controls already implemented

- Same-origin server session with HttpOnly cookie, OAuth PKCE+state, allowed Gmail email, CSRF header on mutations and strict Origin validation.
- Strongly encrypted Gmail access/refresh tokens at rest, time-bounded provider requests, strict API input length bounds.
- **Explicit approval** with current draft version/content hash, one-time reservation and Gmail message ID confirmation; failed or ambiguous sends cannot automatically retry.
- Backend AI result validation: model can suggest, but cannot perform send or choose unknown Gmail recipients.
- Background monitoring: opt-in switch, transactional lock/cursor persistence, dedup, bounded history pagination, error status, retryable notification outbox, separate scheduler secret.
- Browser PWA service worker never intercepts or caches authenticated API responses.

## Open risks before production

- Real account threat model, OAuth verification/restricted scope requirements and independent security review remain outstanding.
- HTTP-level Express checks are blocked by missing npm modules; CSRF/session code not live-tested behind cloud reverse proxy.
- Signed APK TWA Digital Asset Links and browser notification permission need device validation.
- No service-side request rate limiting beyond small input bounds; add rate limiting and abuse detection before opening to the public.
- SQLite single-instance durability/backup must be verified across cloud restarts; the Docker stack is not deployed.
- AI output remains probabilistic. Verify factual claims, names, dates, recipients and attachments manually.
- Scheduled AI drafts require a running cloud backend, per-account AI consent, independent auto-review opt-in, sufficient quota, and eligible new mail. No automatic sending is possible through this path.
- Cross-device concurrent edit conflict uses draft `version` check but UI conflict recovery must be device-tested.
- The FCM server credential is an elevated service account; use least privilege, rotation and secret management.

## Account deletion

`DELETE /api/auth/account` deletes the local account, sessions, encrypted drafts, monitoring state, outbox and registered push tokens using foreign-key cascades, while attempting Google token revocation. The owner should also revoke app authorization in Google Account settings if necessary. Deletion of remote Gmail messages is never performed by account disconnect.

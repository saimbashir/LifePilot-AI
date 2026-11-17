# Security and responsible disclosure

This project integrates personal Gmail, OAuth credentials, third-party AI, and email sending. It is a **development-stage portfolio project**, not a production security guarantee.

## Reporting a security issue

Please avoid publishing exploit details, secrets or private email content in GitHub issues. Contact the repository owner privately through the GitHub profile.

## Required private configuration

- Keep `backend/.env` and all access/refresh tokens, local SQLite data/backups, Firebase service account JSON, Android signing keys, and private logs outside Git.
- Use backend-only environment variables or a managed secret store for production.
- Rotate any Google OAuth or Groq keys previously shared in chat or screenshots before relying on them.
- Never commit production Gmail test data or user emails.

## Guardrails

- AI produces draft suggestions only, not sends. The authenticated account must explicitly approve the exact draft; modifications require new approval.
- Confirm live send results with the Gmail API. Do not automatically retry uncertain sends.
- Treat every incoming message as untrusted, including model instructions and links.
- Configure TLS, origin/CSRF protection, hardened session cookies, persistent encrypted storage and backup in any cloud deployment.

See `docs/SECURITY.md` and `docs/MODULE4_PRIVACY_SECURITY.md` for implementation notes and known limitations.

# LifePilot AI Security Policy

LifePilot AI integrates personal Gmail, OAuth, third-party AI and email sending. The project is in **development**, not a claim of production-grade security.

## Responsible reporting

Avoid posting credentials, private emails, proof-of-concept exploits or tokens in public issues. Contact the repository owner privately via their GitHub profile.

## Essential deployment rules

- Never commit `backend/.env`, Google OAuth secrets or refresh tokens, Groq credentials, Firebase service account JSON, private SQLite data, backups or Android signing keys.
- Keep sensitive configuration on a backend server or in a managed secrets store. Use HTTPS in the deployed environment.
- Rotate credentials that were previously exposed in messages or screenshots.
- Grant only the minimum required Gmail scopes. Remember Google's verification requirements for public apps.
- Model-generated email suggestions must **never** bypass the owner's explicit approval of recipient, subject, body, attachments and current draft version.
- Treat incoming email content as untrusted, and never allow it to issue privileged commands.
- Don't retry an uncertain Gmail send without first checking the provider's outcome.

See `docs/SECURITY.md` and `docs/MODULE4_PRIVACY_SECURITY.md` in the full source archive for implementation details and release blockers.

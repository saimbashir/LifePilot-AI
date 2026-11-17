# Module 3 Security and Privacy Notes

## Key exposure and rotation

A previously shared key must be treated as exposed. Revoke it through GroqCloud and generate a replacement. **Never embed credentials in the React bundle, public GitHub, test fixtures, logs, the ZIP or `.env.example`.** The model key is read only from `GROQ_API_KEY` in the backend environment. Provider responses are sanitized; application errors never echo provider raw bodies or the Authorization header.

The source package contains no real API key. The `.env.example` value is deliberately a placeholder. Never commit `backend/.env`, local database files or OAuth refresh tokens.

## Data sharing and consent

- Connecting Gmail does **not** authorize AI processing. AI is disabled by default.
- Server must have `AI_ENABLED=true` and a valid Groq key **and** the connected account must explicitly enable consent in Settings.
- A selected Gmail message and the small metadata necessary for a specific requested AI action may be sent to GroqCloud for processing. AI does not scan the inbox or start monitoring in the background.
- New requests stop when consent is turned off. Previously shared content is subject to the provider's own retention/deletion policy; turning off consent does not recall past provider requests.
- AI preferences and draft text/recipients use the existing AES-256-GCM encrypted local SQLite store; local account deletion cascades to AI preferences and consent.
- Demo mode continues to use separate fictional data; it makes no real Gmail or Groq calls.

## Authority boundary

- Untrusted incoming email text and voice transcripts are treated as **data**. System prompts explicitly forbid following instructions embedded inside email content.
- **Gmail sender, Reply-To, message ID, thread ID, recipient and subject** for replies are resolved by the existing authenticated Gmail adapter, not model strings.
- New-email recipient must be a syntactically valid exact address submitted by the user, not invented by the AI.
- An AI draft is stored as `draft` status, not `approved`, not `sent`. There is no AI send handler, tool, or route calling `/api/drafts/:id/send`.
- The ORIGINAL Module 2 approval chain checks current version, content hash, approval ID, and one-time send reservation before Gmail sending. Editing text or adding/removing attachments invalidates old approval.
- Unknown Gmail send outcome is terminal until manually inspected; automatic resends are blocked.
- AI-generated claims of attachments without actual stored attachment rows are rejected. User must attach and review files manually.
- The UI must not automatically execute raw voice transcriptions: user can correct transcript and click Run. Spoken 'send now' is interpreted as draft-only.

## Provider behavior and reliability

- Uses Groq Chat Completions `POST /openai/v1/chat/completions` with `response_format:{type:'json_object'}`; server verifies required JSON fields, lengths and enum values. JSON syntax alone does **not** guarantee truthfulness.
- Provider timeout, 429, malformed JSON and other failures return safe error statuses; browser offers manual Gmail workflows.
- Long messages are sampled with head, date/action highlights and tail and **explicitly flagged truncated**. Long replies are blocked from AI drafting rather than silently dropping context. Check original emails for any deadline or promise.
- Model hallucinations are still possible. Extracted dates are filtered to strings found in the source; dates in prose and other claims require human verification.
- Data processed by external AI may be subject to the chosen provider's processing terms. Review your provider privacy policy and account configuration before sending sensitive messages to AI.

## Risks and hardening before public production

- Actual package installation, browser audit, live Gmail OAuth, live Groq response quality, production key rotation and live sends have **not been verified** here.
- Enforce HTTPS, strict allowed origins, cookie protections, operational rate/cost limits, a CSP appropriate to Vite, security patches, request-size limits, secure disk backup/retention and monitoring before deployment.
- Gmail restricted-scope verification may be needed for publicly distributed apps. Never let a server-only model call bypass OAuth/CSRF/approval.
- Single SQLite DB supports one backend instance, not independent multiple cloud replicas. No cloud background monitoring worker or Android app has been deployed. These are outside Module 3.
- Browser SpeechRecognition behavior varies by platform; built-in TTS voices may pronounce Roman Urdu poorly. Do not promise flawless voice support.

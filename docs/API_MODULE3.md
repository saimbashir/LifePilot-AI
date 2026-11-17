# Module 3 HTTP API — authenticated Gmail session required

Base path: `/api/ai`. Frontend uses `credentials:'same-origin'` and the existing session cookie. **POST, PATCH and DELETE require** exact allowed `Origin` and `X-CSRF-Token` from `GET /api/session`. Neither the provider key nor the Gmail token is returned to the frontend. `Content-Type: application/json` is required for JSON bodies.

## Status and consent

`GET /api/ai/status`

```json
{"provider":"groq","configured":true,"enabled":true,"model":"openai/gpt-oss-20b","consent":false,"processingNotice":"Only selected content is sent after consent.","usage":{"requests":0,"prompt_tokens":0,"completion_tokens":0}}
```

Example fields; this is not a claim of a live account state. The API never returns the key.

`POST /api/ai/consent` body: `{"enabled":true}` or `{"enabled":false}`. Account-specific and revocable. Configuration `AI_ENABLED=true` is still required.

## Summaries

`POST /api/ai/summarize` body:

```json
{"messageId":"a-real-owned-gmail-message-id","language":"roman-urdu"}
```

`language`: `roman-urdu`, `simple-english`, or `professional-english`. The server loads the selected Gmail message using the logged-in account. It only sends that message's necessary fields to Groq, not an entire inbox.

Response shape:

```json
{
  "messageId":"...", "language":"roman-urdu",
  "summary":"...", "keyPoints":["..."], "dates":["..."],
  "actionItems":["..."], "uncertainties":["..."],
  "sourceTruncated":false,"sourceChars":1024
}
```

Overlong messages use a bounded head + highlights + tail selection and a prominent **truncated/incomplete** warning. AI can still make mistakes: verify important details in the original Gmail message.

## Reply — draft only

`POST /api/ai/reply`

```json
{
  "messageId":"gmail-message-id",
  "instruction":"Thank the sender and say I will review the application.",
  "tone":"Professional", "length":"Medium", "language":"roman-urdu"
}
```

Optional update existing draft (preserves attachment rows and invalidates any previous approval): `"draftId":"existing-draft-id","expectedVersion":2`.

The server derives **To, Re: Subject, Message-ID, References and thread ID** from the Gmail adapter, **never from model output**. Response: the existing `Draft` type, with `aiGenerated:true`, `sendRequiresApproval:true`. It does **not** send.

## New compose — draft only

`POST /api/ai/compose`

```json
{
  "recipient":"exact@example.com", "cc":"", "bcc":"",
  "instruction":"Ask about summer internship availability.",
  "tone":"Professional", "length":"Short", "language":"simple-english"
}
```

Requires exact email address; a human name is insufficient. Phrases that claim files are already attached are rejected until an actual draft attachment is uploaded through the original file API. Optional `draftId`/`expectedVersion` updates the same draft and **preserves** uploaded attachments. No automatic sending.

## Commands — validated intent, not executing code

`POST /api/ai/command` body:

```json
{"text":"Ahmad ki latest email kholo", "language":"roman-urdu"}
```

Output contains one **allowed intent**: `search_email`, `open_email`, `summarize_email`, `reply_to_email`, `compose_email`, `show_unread`, `clarify`, `unsupported` and safe fields like `route`, `query`, `messageId`, `candidates`, `clarification`, `requiresReview`, `autoSend:false`. The model never generates an executable API route or SQL. The backend resolves Gmail message IDs and recipients deterministically, clarifying ambiguous senders. Voice and typed command actions **cannot invoke Gmail send**.

## Writing preferences

`GET /api/ai/preferences`

`PATCH /api/ai/preferences` accepts only `greeting`, `closing`, `tone` (`Professional`, `Warm`, `Concise`), `length` (`Short`, `Medium`, `Detailed`), `summaryLanguage`, `speechRate` (0.7–1.5).

`DELETE /api/ai/preferences` resets locally stored personalized writing preferences. All personalized values are encrypted at rest; consents remain separate.

## Error statuses

- `400`: invalid field, missing/invalid recipient, unsupported language.
- `401`: Gmail authorization expired/reconnect required (handled by original auth middleware).
- `403`: AI consent missing, CSRF failed, unauthorized origin.
- `409`: stale draft, attachment clarification required, too-long reply source.
- `429`: Groq rate limit reached.
- `502`: external provider error/timeout, malformed JSON/schema.
- `503`: Groq key/provider not configured or AI disabled on server.

Actual HTTP wire tests require installing Express and running Playwright; see test report. Every endpoint is intentionally behind the original Gmail session middleware.

# LifePilot Module 2 backend API

Base path: `/api`. Sessions use an **HttpOnly, SameSite=Lax** cookie. All state-changing authenticated requests require `Origin` exactly matching `FRONTEND_ORIGIN` and header `X-CSRF-Token` returned by `GET /api/session`. The frontend API adapter passes this header in memory. All response objects are JSON except attachment downloads. Errors use `{ "error": "message" }` and appropriate 4xx/5xx statuses.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Public health (no Gmail access) |
| GET | `/session` | Connection state, account email and CSRF token when logged in |
| GET | `/auth/google/start` | Redirect to Google consent screen (state + PKCE) |
| GET | `/auth/google/callback` | OAuth callback, scoped email allowlist check, encrypted token storage, secure session |
| POST | `/auth/logout` | Remove this browser session (does not remove connected account) |
| DELETE | `/auth/account` | Disconnect, attempt Google token revocation, delete all local credentials, sessions, drafts, attachments |
| GET | `/mail?folder=inbox&q=from%3A...&pageToken=` | Gmail server-side message search; `folder` = inbox, unread, important, sent, archive; max 25 messages per request |
| GET | `/mail/stats` | Gmail label counts for inbox, unread and important |
| GET | `/mail/:id` | Full message, sender, recipients, bodies, conversation history and attachment metadata |
| PATCH | `/mail/:id/labels` | `{ "action": "star|read|important|archive", "value": true }` |
| GET | `/mail/:id/attachments/:attachmentId` | Authenticated Gmail attachment download |
| GET | `/drafts` | List backend-persisted drafts |
| POST | `/drafts` | Create draft `{to,cc,bcc,subject,body,sourceEmailId?}`; source email is verified on server |
| GET | `/drafts/:id` | Read draft, revision and review fingerprint |
| PATCH | `/drafts/:id` | Update `{to,cc,bcc,subject,body,expectedVersion}`. Editing invalidates approval. |
| POST | `/drafts/:id/attachments` | Upload `{filename,mimeType,data}` base64; 5 MB/file, 12 MB/draft encrypted. Editing invalidates approval. |
| DELETE | `/drafts/:id/attachments/:attachmentId` | Remove stored attachment; invalidates approval |
| POST | `/drafts/:id/request-review` | `{expectedVersion}`: validate and move to pending |
| POST | `/drafts/:id/approve` | `{expectedVersion,contentHash}`: approval of **exact current snapshot**; response contains `approvalId` |
| POST | `/drafts/:id/send` | `{expectedVersion,approvalId}`: one-time approved send; success only after Gmail returns message ID |
| POST | `/drafts/:id/reject` | Reject draft without sending |
| GET | `/monitoring` | Honest status: not deployed, manual mode |
| POST | `/monitoring/refresh` | Force Gmail inbox refresh, return loaded mails + counts + checkedAt |

### Example approval flow

```text
POST /drafts                  -> draft v1
PATCH /drafts/:id            -> draft v2 (approval invalidated)
POST /drafts/:id/attachments -> draft v3 (approval invalidated)
POST /drafts/:id/request-review {expectedVersion:3}
User checks To, Cc/Bcc, subject, COMPLETE body and attachment list
POST /drafts/:id/approve {expectedVersion:3,contentHash:<server-provided>}
POST /drafts/:id/send {expectedVersion:3,approvalId:<server-provided>}
    -> {sent:true, gmailMessageId:...} ONLY on confirmed Gmail API response
```

If Gmail times out or gives an ambiguous result after send has been reserved, the draft becomes `unknown` and **automatic retry is blocked**; examine Gmail Sent before taking further action. Never assume delivery from a locally initiated request. `gmailMessageId` means Gmail API accepted the send, not that final delivery to the recipient's mailbox is guaranteed.

### Scope and limitations

`GET /mail/stats` returns Gmail label counts. The Important count covers Gmail's Important label, which may include messages outside Inbox. Search results are loaded in pages; the count of currently loaded results isn't a whole-mailbox total. Attachments from Gmail are rendered by metadata and downloaded through the backend. Some unusual MIME encodings and very large attachments require additional compatibility work. No Groq/AI/Grok, server-side email intelligence, autonomous send, cloud push worker, or real-time monitoring is included.

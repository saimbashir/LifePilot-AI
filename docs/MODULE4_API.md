# Module 4 API Additions (existing Module 2/3 routes unchanged)

All `/api/*` endpoints except `/api/health` and `/api/session` require a valid HttpOnly server session. POST/PATCH/DELETE require matching `Origin` and `X-CSRF-Token`. No API key or refresh token is returned to the frontend.

| Method | Path | Effect |
|---|---|---|
| GET | `/api/monitoring` | Genuine current monitoring state, heartbeat, count, errors |
| PATCH | `/api/monitoring` `{enabled:boolean}` | Explicit opt-in / pause; defaults off |
| POST | `/api/monitoring/check` `{}` | Manual incremental history synchronization when opted in |
| GET | `/api/monitoring/events` | Last 50 opaque received message IDs and timestamps |
| GET | `/api/push/status` | Provider configured flag and own device IDs/platforms |
| POST | `/api/push/register` `{token, platform:'web'|'android'}` | Store encrypted FCM token for this account; user permission required |
| DELETE | `/api/push/devices/:deviceId` | Remove owned FCM token by ID |
| POST | `/api/push/unregister` `{token}` | Remove a known token on logout/permission revoke |
| POST | `/internal/cron/monitor` | **NOT USER API**; `X-Monitor-Token` secret, enabled cloud scheduler only. Returns anonymous counts. |
| GET | `/api/health` | Generic availability; no personal data |

`GET /api/monitoring` example (data is representative, not live):

```json
{
  "mode":"scheduled","enabled":false,"status":"Paused",
  "workerConfigured":false,"lastCheckedAt":null,"lastSuccessAt":null,
  "lastMessageAt":null,"lastError":null,"cursorInitialized":false,
  "receivedCount":0,"pendingNotifications":0,
  "message":"Cloud worker not configured; the PC must remain on for local checks."
}
```

Status `Monitoring` requires a fresh successful call to the scheduled endpoint; browser manual checks alone cannot make it appear.

**Gmail approval and Groq routes are unchanged.** See `docs/API.md` and `docs/API_MODULE3.md`. The monitor and FCM APIs have **no authority to approve or send** Gmail mail.

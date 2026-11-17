# Optional Gmail change monitoring — design only (not deployed)

**Current Module 2 status:** `Manual refresh`, or `Not deployed` for background monitoring. Clicking Refresh performs a real Gmail read when connected. No background worker is installed, and monitoring does not continue while a laptop-hosted backend is offline.

Future **cloud** design:

1. Deploy Express and persistent encrypted database on an always-on HTTPS host.
2. Create a Google Cloud Pub/Sub topic and authenticated push subscription. Gmail's publisher requires the topic permission documented by Google. Protect the webhook with Google-signed Pub/Sub push identity tokens; don't treat arbitrary JSON posts as trusted Gmail notifications.
3. With explicit opt-in, call Gmail `users.watch` with `labelIds:['INBOX']`, keep the returned **historyId** and **expiration** in the backend. Renew the watch at least every seven days (Google recommends daily).
4. Worker receives and verifies Pub/Sub notifications, enqueues account+historyId, obtains a lock and processes `users.history.list` increments, deduplicating events. On expired history IDs, perform a fresh mailbox sync; never assume one push notification equals one complete email.
5. Store worker heartbeat, last successful sync, OAuth reauthorization state and watch expiration. Reflect statuses: **Connected** (authenticated only), **Monitoring** (watch + worker are both active and healthy), **Paused** (user has stopped sync), **Reauthorization Required**, **Degraded** (watch expired / worker failed). Never mark Monitoring merely because Gmail OAuth succeeded.
6. Support safe replays and backoff, private logs without email bodies, and notify UI by polling a backend status endpoint or a secure server-sent event.

References: [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [Gmail history synchronization](https://developers.google.com/workspace/gmail/api/guides/sync).

**Deployment needed:** cloud credentials, Pub/Sub topic/subscription, IAM grants, persistent queue/worker and TLS public endpoint. These are not in this repository and have not been tested or deployed.

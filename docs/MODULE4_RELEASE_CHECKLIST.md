# Module 4 Release Acceptance Checklist

This matrix is intentionally conservative. A **PASS** means the documented check was really executed in the model's working container. **UNVERIFIED** means no successful run is available.

| Acceptance criterion | Current evidence / status |
|---|---|
| Preserve original UI, screens and CSS | Existing `src/styles.css` untouched; offline preview 6 PASS, React runtime UNVERIFIED |
| All Modules 1–3 original backend regressions | Existing mocked tests PASS |
| Backend Module 4 monitor state/dedup/expired cursor | Mock tests PASS |
| FCM token encryption and mock send | Mock tests PASS; real FCM UNVERIFIED |
| Browser microphone and Roman Urdu transcript | Existing source preserved, live device UNVERIFIED |
| Roman Urdu summary accuracy against real Gmail | UNVERIFIED: no private key/consent/test account |
| True sender identity and ambiguous recipient clarification live | Mock tests exist; real Gmail UNVERIFIED |
| Exact approved send and Gmail message ID | Mock tests PASS; live send NOT PERFORMED |
| No send from AI/cron | Code separation and mocked test PASS |
| No duplicate send on uncertain result | Original backend tests PASS |
| React typecheck / Vite production build | BLOCKED: missing npm packages due EAI_AGAIN |
| React Playwright desktop/mobile browser suite | BLOCKED: Playwright CLI unavailable |
| Source-level TSX syntax | PASS using global TypeScript transpile parser only |
| Local `node:sqlite` online backup + integrity check | PASS on an isolated temporary fixture |
| Docker production image build | UNVERIFIED: image not built / registry unavailable |
| HTTPS production host / working public URL | NOT DEPLOYED |
| Cloudflare Worker cron active | NOT DEPLOYED |
| Gmail scheduled monitoring while PC shut down | UNVERIFIED: cannot test without real cloud |
| Gmail history cursor/duplicate notifications across VM restart | Local mocked logic PASS; cloud/restart UNVERIFIED |
| Real web push / Android notifications while app closed | UNVERIFIED |
| Android APK build/install | NOT BUILT; no Gradle/Android SDK/domain/signing setup |
| Android Google OAuth and TWA Digital Asset Links | NOT TESTED |
| 320/390/desktop real React responsive tests | NOT VERIFIED; original offline preview only |
| SQLite cloud persistence / backup recovery | Local backup smoke PASS; cloud recovery UNVERIFIED |
| Zero recurring cost eligibility/measurement | NOT VERIFIED; potential free-tier architecture only |

### End-to-end acceptance demonstration requested in Module 4 prompt

A) PC closed, cloud detects test email; B) Android receives notification; C) open and summarize in Roman Urdu; D) voice command to open Ahmad's latest email and draft reply; E) resolve ambiguity; F) review To/subject/body/attachments; G) explicitly approve a controlled test message; H) Gmail confirms message ID; I) web/Android sync sent state; J) cancelled draft never sends.

**Result:** Scenarios A–I have **not been performed live** here. The underlying mocked approval/command tests cover parts of D–J, but do not constitute an end-to-end demonstration. Live sending was deliberately not attempted without specific approval for a particular recipient and message.

### Release gates

- All npm dependencies installed and genuine lockfiles committed.
- React typecheck, build, Playwright (desktop/390/320 px) PASS in CI and on developer machine.
- Production HTTPS host, durable SQLite, OAuth callback, clock, backups and Cloudflare cron PASS across restart.
- Controlled OAuth test user, Groq key/model, FCM web notification and Android TWA build PASS.
- Record signed APK, SHA-256 signing certificate fingerprint, verified Digital Asset Links, physical-device screenshots and logs.
- Run separate explicit Gmail send authorization test. No auto-sending, ever.

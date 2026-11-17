# GitHub Portfolio — verification status

This public source contains a four-module React/Express/Gmail/Groq/monitoring architecture.

- **Demonstrated locally by project owner (screenshots in conversation, not included here):** Gmail OAuth connection and displaying real inbox messages; Groq model availability check.
- **Automated tests:** See the included `docs/AUTO_APPROVAL_TEST_REPORT.md` for the most recent recorded mock-test run.
- **Not independently validated on this public revision:** production build, Playwright end-to-end, real AI draft quality, cloud scheduler while PC is off, Android APK, FCM delivery, controlled Gmail send.
- **Before production:** rotate exposed keys, install locked dependencies, pass CI, verify account allowlist and approval check, deploy a persistent HTTPS backend, and run controlled integration tests.

It would be misleading to describe the public repository as deployed, continuously online or Android-installable until there is test evidence.

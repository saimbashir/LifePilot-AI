# Google Cloud / Gmail OAuth setup (Module 2)

No Gmail account is connected by downloading this repository. Do not paste your Google password into LifePilot. This uses Google's OAuth authorization code flow with state and PKCE.

1. Create or select a Google Cloud project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API** for that project.
3. Configure the **OAuth consent screen / Google Auth Platform**. For personal development select the appropriate audience and add your own Gmail address as a **test user**, when required. Use truthful app and contact information.
4. Create an **OAuth Client ID** of type **Web application**. Under authorized redirect URIs enter **exactly** `http://localhost:8787/api/auth/google/callback` for the local setup. The client ID and client secret are server-side values.
5. Copy `backend/.env.example` to `backend/.env`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_GMAIL_ADDRESS` (your exact authorized account). Generate a separate random 32-byte `TOKEN_ENCRYPTION_KEY_B64` using the README command.
6. Confirm `FRONTEND_ORIGIN=http://localhost:5173`, `BASE_URL=http://localhost:8787`, and `GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback`.
7. Run the backend and React frontend, open Settings, choose **Connect Gmail securely**, and consent in the Google window.
8. The frontend sends ordinary API requests to the same-origin `/api` path. In development Vite proxies `/api` to the Node backend. **Google tokens never reach JavaScript**.

**Permissions:** This project requests `https://www.googleapis.com/auth/gmail.modify` to retrieve message bodies, search and read threads, change Gmail labels (read/star/archive/important), create reply context and send explicitly approved messages. It deliberately does not request the broader `https://mail.google.com/` scope. The Gmail modify scope is **restricted**: a public production deployment may require Google's OAuth verification, and storing/transmitting restricted Gmail data may require additional Google review/security assessment. See Google's [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) and [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

**Refresh tokens:** The backend requests offline access. Google may only issue new refresh tokens under certain grant/consent conditions. If authorization says refresh token unavailable or invalid, revoke the test app in Google Account connections and authorize again. Never log or commit tokens.

**Cloud / Android access:** Host both React build and Express backend behind **one HTTPS origin** with a persistent encrypted storage volume; configure `NODE_ENV=production`, HTTPS `FRONTEND_ORIGIN` / `BASE_URL`, exact redirect URI and trusted reverse proxy if applicable. Point both a desktop browser and Android browser/PWA to that HTTPS origin; don't copy session cookies to third parties. Your PC can be switched off only after the backend is truly deployed to a separate cloud host. Native Android packaging/OAuth deep-link details are a later deployment concern; this module is a responsive web application.

# Android Source — Trusted Web Activity (TWA) & PWA

**Status:** Android source scaffold only. No APK compiled, signed, installed, or tested. No live domain exists yet. Native build is conditional on a deployed HTTPS PWA and developer-controlled signing key.

## Why TWA instead of a Capacitor WebView now?

The existing Gmail OAuth/session uses same-origin HttpOnly browser cookies, a CSRF token and a server-side OAuth callback. A Capacitor local WebView would have a different origin from the cloud backend and needs a *separate* secure native login/session design; simply setting `server.url` to a live app is documented by Capacitor as a live-reload facility, NOT a production solution. Android's **Trusted Web Activity** uses the actual Chrome origin, preserving the website's Google OAuth and cookie model. TWA cannot be considered trusted until Digital Asset Links is verified.

Reference: https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities

## Build procedure on your development machine

1. Deploy `https://YOUR_HOST/` first and verify a PWA installation in Chrome.
2. Install Android Studio, Android SDK Platform 35, Android Build Tools and JDK 17 with Gradle 8.11.1. The project is under `android/` (Java-free LauncherActivity provided by androidbrowserhelper).
3. Open the `android/` folder in Android Studio; let Gradle download the Android Gradle plugin and Android Browser Helper dependency.
4. Set `lifepilotHost=YOUR_HOST` in `android/gradle.properties` (do not include `https://`); do NOT use `replace-me.invalid` for release.
5. Generate your signing key **locally** and keep it private. Obtain the certificate SHA-256 fingerprint. Copy the template at `android/app/src/main/assets/assetlinks-template/assetlinks.json` to the live website at `https://YOUR_HOST/.well-known/assetlinks.json` with your **actual** SHA-256 signing certificate fingerprint. Digital Asset Links must validate the package `ai.lifepilot.app`.
6. From Android Studio build a debug APK, install to a device/emulator and confirm launching from app icon, secure Google OAuth, refresh, typed/voice fallback, push permission, notification click, deep links to Inbox, logout and approval flow.
7. Only after those checks, create a signed release APK from Android Studio and decide whether public distribution requires additional Google/Play verification.

**Note:** Push on Android TWA is via browser PWA / Firebase Web Messaging when supported. The FCM backend exists, but no physical Android push delivery, notification click or background survival has been tested here. A native `FCM` Android SDK and token channel are NOT packaged; do not claim a native notification guarantee.

**No APK supplied** because `gradle`, Android SDK, a stable domain, signing key and live device authorization were unavailable in this environment. The `android/` directory is a source scaffold rather than an already installable binary.

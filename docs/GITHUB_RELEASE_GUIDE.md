# GitHub and Release Guide — LifePilot AI

**Current status:** Local source archive only. GitHub repository was not created or modified. GitHub Actions workflow has not run remotely.

## Publish privately

1. Download and extract the Module 4 ZIP to your computer.
2. Run `npm run scan:secrets`. Inspect `git status` to confirm no `.env`, token JSON, private SQLite database or signing keystore is included.
3. Create a **private** GitHub repository you control using GitHub's UI. Do not include a real API key or OAuth secret in commit history.
4. In the extracted project:

```bash
git init
git branch -M main
git add .
git status --short
git commit -m "feat: LifePilot Modules 1–4 integration source and monitoring foundation"
git remote add origin YOUR_PRIVATE_GITHUB_REPOSITORY_URL
git push -u origin main
```

5. CI workflow `.github/workflows/module4-ci.yml` automatically attempts npm installs, mocked backend tests, React typecheck, Vite build and Playwright Chromium E2E. **Do not call CI green until GitHub reports a passing run.** If it fails, use the logs to fix underlying issues.
6. Store only **deployment-specific secrets** in your server/Cloudflare/Firebase dashboards. Browser Firebase config is public, but backend service-account credentials and Groq key are not.
7. Before first real-world release, complete all remaining items in `docs/MODULE4_RELEASE_CHECKLIST.md`.

## Suggested tags

- `v4.0.0-source-preview` — source package without live deployment, use only after verification.
- `v4.0.0-rc1` — after verified CI build, Android emulator and controlled Gmail/Groq tests.
- `v4.0.0` — only after deployment, device notification verification and approval-send acceptance tests.

## Privacy

Keep the repository private while it contains or processes sensitive Gmail data. Never add tokens/drafts/database backups to Git, even in a private repository. The `node_modules` folder and compiled `dist` are rebuildable and intentionally excluded.

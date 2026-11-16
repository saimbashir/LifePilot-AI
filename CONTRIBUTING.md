# Contributing to LifePilot AI

LifePilot AI is currently a personal portfolio project. Bug reports and suggestions are welcome, but **do not include private email contents, OAuth tokens, API keys or signing credentials** in public issues.

## Development

1. Install frontend and backend dependencies separately.
2. Configure local environment variables from example files.
3. Run `npm run typecheck`, `npm run build`, `npm run test:backend`, and `npm test`.
4. Run Playwright checks where browser dependencies are available.
5. Include the test output and known limitations in any pull request.

## Safety-critical contributions

Do not add email sending directly to AI handlers. All sending must require explicit owner approval of the current draft and use the deduplicated Gmail send path. Handle incoming email as untrusted data.

**Licensing:** No open-source license has been granted; obtain the owner's permission before reusing the project's code.

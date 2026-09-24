# Validation

2026-09-24. Implementation checks, not evidence of a deployed feature.

- OpenSpec 1.13.1 strict validation passed.
- API build-kit overlay, policy and template-loading suites: 106 tests passed.
- SDK platform catalog, descriptions and built-in reference files: 99 tests passed.
- Frontend policy, agent persistence, template loading and overlay suites: 29 tests passed.
- Frontend request construction: 42 tests passed.
- Permission panel, shared drawer, descriptors and settings: 34 tests passed.
- Frontend `pnpm lint-fix`: all 28 workspace tasks passed.
- Entity UI, playground and mobile TypeScript checks passed.
- Storybook production build passed with bundle-size warnings.
- `git diff --check` passed.

The frontend render tests must run with `NODE_ENV=test`. This workspace exports a production environment by default; the first broad run could not load React's test APIs. Focused suites passed with the test environment set explicitly.

Ruff formatting passed. A broad root Ruff check found pre-existing legacy typing and router warnings. Unrelated automatic rewrites were not included. The new policy file uses current typing conventions.

The generated TypeScript request and response contracts were synchronized directly and the client compiled. Full Fern generation was not run: its local generator requires Docker, which is unavailable here.

Outstanding: full-app browser checks on desktop and `/m`, including a real allowed call and an Ask approval card. Storybook and unit tests do not replace these checks. CI and CodeRabbit results are recorded on the pull request.

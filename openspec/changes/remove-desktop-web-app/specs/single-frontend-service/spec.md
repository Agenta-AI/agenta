## ADDED Requirements

### Requirement: web-mobile is the only frontend service
Every deployment target (docker-compose oss and ee in dev, gh, gh.local and gh.ssl modes; helm; Railway template and previews; cloud) SHALL run `web-mobile` as its only frontend service, routed for every path that the API and services routers do not claim.

#### Scenario: Compose stack starts
- **WHEN** `run.sh --oss --gh` or `run.sh --ee --dev` starts a stack
- **THEN** no `web` container runs and `/` answers through `web-mobile`

#### Scenario: Backend-only stack with nginx
- **WHEN** a stack starts with `web-mobile` scaled to 0 behind nginx
- **THEN** nginx starts, because the catch-all uses a variable upstream

#### Scenario: Helm upgrade with old values
- **WHEN** a user runs `helm upgrade` with a top-level `web` block and `ingress.paths.web` set
- **THEN** the upgrade succeeds, `ingress.paths.web` routes `/` to `web-mobile` with its `pathType`, and no `web` deployment exists

### Requirement: Runtime config without license folders
`web/entrypoint.sh` SHALL write `__env.js` only into `mobile/public`.

#### Scenario: Mobile container starts
- **WHEN** the `agenta-web-mobile` container starts
- **THEN** `/m/__env.js` serves the runtime config and no `/app/oss` or `/app/ee` folder is created

### Requirement: No desktop sources or images
The repository SHALL contain no `web/oss`, `web/ee` or `web/tests` folder, no `@agenta/oss` or `@agenta/ee` workspace, and no workflow that builds `agenta-web` or `internal-ee-agenta-web`.

#### Scenario: Clean install
- **WHEN** a contributor runs `pnpm install --frozen-lockfile` in `web`
- **THEN** it succeeds and installs no desktop workspace

### Requirement: Mentions are guarded
A CI step SHALL fail when a file outside the allowlist names `web/oss`, `web/ee`, `@agenta/oss`, `@agenta/ee`, `agenta-web` (the desktop image), or the `web` service.

#### Scenario: New mention
- **WHEN** a PR adds `web/oss` to a file outside the allowlist
- **THEN** the guard step fails and names the file and line

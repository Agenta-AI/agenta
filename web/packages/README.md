# @agenta/* Packages

Internal workspace packages for the Agenta monorepo.

## Packages

The app that consumes these is `web/mobile`. `web/oss` and `web/ee` are the
abandoned desktop app. Most domains come as a pair: a headless package (state,
API calls, no React UI) and a `-ui` package that renders it.

Foundation:

| Package | Purpose |
|---------|---------|
| `@agenta/shared` | Utilities, types, schemas, hooks, and the host QueryClient API. No dependencies on other packages. |
| `@agenta/ui` | Shared UI kit: shadcn primitives (`./ui`), tables, editors, the rich chat input, drawers, theme. |
| `@agentaai/api-client` | Fern-generated TypeScript client for the Agenta API (compiled to `dist/`). |
| `@agenta/sdk` | Thin wrapper over `@agentaai/api-client`: host config and per-resource clients (`./resources`). |
| `@agenta/entities` | Entity state (molecules, query atoms) and API calls for workflows, sessions, testsets, traces, secrets, and more. |
| `@agenta/entity-ui` | Entity-specific UI: drill-in views, pickers, modals, drawers, the drive. |

Domains:

| Headless | UI | Domain |
|----------|----|--------|
| `@agenta/annotation` | `@agenta/annotation-ui` | Annotation queues and sessions |
| `@agenta/auth` | `@agenta/auth-ui` | Sign-in flows (email, OTP, social, region, Turnstile) |
| — | `@agenta/automation-ui` | Automations (schedules and event subscriptions) |
| `@agenta/chat` | — | Agent chat: model, transport, state, hooks, and chat components |
| — | `@agenta/home-ui` | The Home page, composed once for every host |
| `@agenta/navigation` | `@agenta/navigation-ui` | Nav model and its menu, sidebar, and command-palette renderers |
| `@agenta/observability` | `@agenta/observability-ui` | Traces, analytics, filters, and the trace drawer |
| `@agenta/playground` | `@agenta/playground-ui` | Playground controllers and UI (execution, comparison, agent build) |
| `@agenta/sessions` | `@agenta/sessions-ui` | Session lists: filters, pins, row derivation, and their components |
| `@agenta/settings` | `@agenta/settings-ui` | Settings navigation and API keys, and the settings pages |
| `@agenta/skills` | `@agenta/skills-ui` | Skill registry: schema, API, embed writer, and its gallery and drawers |

`@agenta/ui`, `@agenta/entities`, `@agenta/entity-ui`, `@agenta/shared`,
`@agenta/playground`, `@agenta/playground-ui`, and `@agentaai/api-client` have
their own `README.md`. For placement rules and usage, load the
`agenta-package-practices` skill.

## Shared Configuration

- **`tsconfig.base.json`** - Base TypeScript configuration extended by all packages
- **`eslint.config.mjs`** - Shared ESLint configuration for packages (without Next.js plugins)

## Development

### Linting

Run ESLint for a specific package:

```bash
cd web/packages/agenta-shared
pnpm lint
```

### Type Checking

```bash
cd web/packages/agenta-shared
pnpm types:check
```

## Adding a New Package

1. Create a new folder under `web/packages/`
2. Add a `package.json` with the package name `@agenta/<name>`
3. Create a `tsconfig.json` extending `../tsconfig.base.json`
4. Export from `src/index.ts`, with subpath entries in `package.json` `exports`
5. Add it to this table

# @agenta/* Packages

Internal workspace packages for the Agenta monorepo.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@agenta/shared` | Shared utilities, state atoms, and API helpers | ✅ Active |
| `@agenta/entities` | Entity definitions and data fetching atoms | 🚧 Planned |
| `@agenta/ui` | Shared UI components | 🚧 Planned |

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
pnpm build
```

## Adding a New Package

1. Create a new folder under `web/packages/`
2. Add a `package.json` with the package name `@agenta/<name>`
3. Create a `tsconfig.json` extending `../tsconfig.base.json`
4. Add a `README.md` documenting the package
5. Export from `src/index.ts`

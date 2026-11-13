---
name: update-api-docs
description: Update the API reference documentation by downloading the latest OpenAPI spec from production and regenerating the Docusaurus API docs
---

# Update API Documentation

This skill guides you through a manual update of the API reference documentation from an OpenAPI spec.

## Check first: the update runs on its own

The workflow `.github/workflows/33-update-api-docs.yml` regenerates the API docs without anyone running this skill. It runs:

- every day at 06:00 UTC (cron `0 6 * * *`),
- when a PR from a `release/*` branch is merged into `main`,
- and on a manual run from the Actions tab (`workflow_dispatch`).

The workflow checks out `main`, downloads `https://cloud.agenta.ai/api/openapi.json`, regenerates the docs, and opens a PR from the branch `automated/update-api-docs` with the title `[docs] Update API reference docs`.

So use this skill only for a manual run, for example to preview docs from a spec that is not in production yet (a local API or a file). If the user only wants the production spec in the docs, tell them about the workflow first.

## Overview

The API documentation is generated from an OpenAPI spec using `docusaurus-plugin-openapi-docs`. A manual run does three things:
1. It gets the `openapi.json` spec from production, a local API, or a file.
2. It replaces the local spec file.
3. It regenerates the API documentation pages.

## File Locations

| Purpose | Path |
|---------|------|
| OpenAPI spec (source) | `docs/docs/reference/openapi.json` |
| Generated API docs | `docs/docs/reference/api/*.api.mdx` |
| Generated sidebar | `docs/docs/reference/api/sidebar.ts` |
| Docusaurus config | `docs/docusaurus.config.ts` |
| Update script | `docs/scripts/update-api-docs.sh` |

All paths are relative to the repo root. The plugin config in `docusaurus.config.ts` uses
paths relative to `docs/` (`docs/reference/openapi.json` there means
`docs/docs/reference/openapi.json` here).

The API reference lives only in the current (v2.0) docs under `docs/docs/`. Never regenerate
or edit the frozen v1.0 docs under `docs/versioned_docs/version-1.0/`.

## Steps

### 1. Install dependencies

The docs package uses pnpm (`"packageManager"` in `docs/package.json`, and `docs/pnpm-lock.yaml`). On a fresh clone, or if `docusaurus` is not found, install the dependencies:

```bash
(cd docs && pnpm install --frozen-lockfile)
```

### 2. Run the update script

The wrapper script at `docs/scripts/update-api-docs.sh` downloads the OpenAPI
spec, replaces the local file, and regenerates the docs in one step.

```bash

# Default: fetch from production (https://cloud.agenta.ai/api/openapi.json)
(cd docs && pnpm update-api-docs)

# The same production URL, named explicitly
(cd docs && pnpm update-api-docs:live)

# From a locally running API (http://localhost/api/openapi.json)
(cd docs && pnpm update-api-docs:local)

# From a local file
(cd docs && pnpm update-api-docs:file /path/to/openapi.json)
```

The script writes the spec to `docs/docs/reference/openapi.json`, then runs the
`clean-api-docs` and `gen-api-docs` scripts with the argument `agenta`. The `agenta`
argument is the OpenAPI config ID in `docusaurus.config.ts`.

This generates:
- Individual `.api.mdx` files for each endpoint
- `.tag.mdx` files for API categories
- `sidebar.ts` for navigation

### 3. Verify the changes

Start the dev server to preview:

```bash
(cd docs && pnpm start)
```

Then visit `http://localhost:5000/docs/reference/api` to check that the API docs render correctly.

## Commit Guidelines

Commit only if the user asks. Use GitButler (`but`), as the root `AGENTS.md` says.

1. Commit message:
   ```
   docs(api): update OpenAPI spec from production
   ```

2. Include all changed files:
   - `docs/docs/reference/openapi.json`
   - `docs/docs/reference/api/*.api.mdx`
   - `docs/docs/reference/api/*.tag.mdx`
   - `docs/docs/reference/api/sidebar.ts`

## Troubleshooting

### "missing required argument 'id'" error

The clean and generate commands require the config ID. Use:
```bash
(cd docs && pnpm run clean-api-docs agenta && pnpm run gen-api-docs agenta)
```

### "docusaurus: not found" error

Run `pnpm install --frozen-lockfile` in the `docs/` directory first (step 1).

### Deprecation warning about onBrokenMarkdownLinks

This is a known warning and you can ignore it. It will be addressed in a future Docusaurus v4 migration.

## Related Configuration

The OpenAPI plugin is configured in `docs/docusaurus.config.ts`. Search the file for `docusaurus-plugin-openapi-docs` to find the `agenta` config with its `specPath`, `outputDir`, `downloadUrl` and `sidebarOptions`. Read the config there. Don't copy it into this skill, because a copy goes out of date.

---
name: update-api-docs
description: Update the API reference documentation by downloading the latest OpenAPI spec from production and regenerating the Docusaurus API docs
---

# Update API Documentation

This skill guides you through updating the API reference documentation from the production OpenAPI specification.

## Overview

The API documentation is generated from an OpenAPI spec using `docusaurus-plugin-openapi-docs`. The workflow involves:
1. Downloading the latest `openapi.json` from production
2. Replacing the local spec file
3. Regenerating the API documentation pages

## File Locations

| Purpose | Path |
|---------|------|
| OpenAPI spec (source) | `docs/docs/reference/openapi.json` |
| Generated API docs | `docs/docs/reference/api/*.api.mdx` |
| Generated sidebar | `docs/docs/reference/api/sidebar.ts` |
| Docusaurus config | `docs/docusaurus.config.ts` |

## Steps

### 1. Download the OpenAPI spec from production

```bash
curl -s "https://cloud.agenta.ai/api/openapi.json" -o docs/docs/reference/openapi.json
```

**Important:** The file should be saved in **minified format** (single line, no pretty-printing) to match the existing format in the repository. The curl command above preserves the original format from the server.

### 2. Install dependencies (if needed)

If this is a fresh clone or dependencies haven't been installed:

```bash
cd docs
npm install
```

### 3. Clean existing generated API docs

```bash
cd docs
npm run clean-api-docs -- agenta
```

The `agenta` argument refers to the OpenAPI config ID defined in `docusaurus.config.ts`.

### 4. Regenerate API docs

```bash
cd docs
npm run gen-api-docs -- agenta
```

This will generate:
- Individual `.api.mdx` files for each endpoint
- `.tag.mdx` files for API categories
- `sidebar.ts` for navigation

### 5. Verify the changes

Optionally, start the dev server to preview:

```bash
cd docs
npm run start
```

Then visit `http://localhost:5000/docs/reference/api` to verify the API docs render correctly.

## Commit Guidelines

When committing these changes:

1. **First commit** - API docs update:
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
npm run clean-api-docs -- agenta
npm run gen-api-docs -- agenta
```

### "docusaurus: not found" error

Run `npm install` in the `docs/` directory first.

### Deprecation warning about onBrokenMarkdownLinks

This is a known warning and can be safely ignored. It will be addressed in a future Docusaurus v4 migration.

## Related Configuration

The OpenAPI plugin is configured in `docs/docusaurus.config.ts`:

```typescript
[
  "docusaurus-plugin-openapi-docs",
  {
    id: "openapi",
    docsPluginId: "classic",
    config: {
      agenta: {
        specPath: "docs/reference/openapi.json",
        outputDir: "docs/reference/api",
        downloadUrl: "https://raw.githubusercontent.com/Agenta-AI/agenta/refs/heads/main/docs/docs/reference/openapi.json",
        sidebarOptions: {
          groupPathsBy: "tag",
          categoryLinkSource: "tag",
        },
      },
    },
  },
],
```

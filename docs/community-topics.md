# Community Topics

This file is the repository-level index for community-facing deployment and hosting topics.

Use it together with:

- `README.md` for the public entry point
- `CONTRIBUTING.md` for contributor expectations
- `CODEOWNERS` for review routing
- `.github/.labels.yml` for the issue and PR taxonomy

## Taxonomy

Community topics are described with these label dimensions:

- Provider: `provider/*`
- Platform: `platform/*`
- Runtime: `runtime/*`
- OLAP: `olap/*`
- Maintenance: `maintenance/*`
- Support: `support/*`

`maintenance/*` describes who is expected to do the work.

`support/*` describes the level of promise the repository makes to users.

## Current Topic Matrix

| Topic | Provider | Platform | Runtime | OLAP | Maintenance | Support | Owners | Paths | Docs | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local OSS with Docker Compose | `provider/local` | `platform/local` | `runtime/docker-compose` | `olap/local` | `maintenance/internal` | `support/official` | `CODEOWNERS` | `hosting/docker-compose/oss/` | `README.md`, `docs/docs/self-host/01-quick-start.mdx` | Default OSS self-host path with local storage services |
| Railway OSS | `provider/railway` | `platform/vps` | `runtime/docker-compose` | `olap/local` | `maintenance/internal` | `support/experimental` | `CODEOWNERS` | `hosting/railway/oss/`, `.github/workflows/06-railway-preview-build.yml`, `.github/workflows/07-railway-preview-deploy.yml`, `.github/workflows/08-railway-preview-cleanup.yml` | `docs/docs/self-host/guides/04-deploy-on-railway.mdx`, `hosting/railway/oss/README.md` | Managed deployment path using the local storage classification for now |

## Not In Scope For This Matrix

These paths exist in the repository but are not treated here as current first-class community topics:

- `hosting/old/aws/`
- `hosting/old/gcp/`

If a new path becomes a first-class topic, update this file, the labels, and `CODEOWNERS` in the same change.

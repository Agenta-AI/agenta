## Why

Users need to export an agent, share it privately or submit it to the marketplace, and load a shared package without waiting for a release. The app and website need one source of template metadata.

## What Changes

- Add Save as template near Publish/Share. It sends one visible chat request to an export skill and preserves an unsent composer draft. Exact placement and wording remain a UI decision.
- Create a plugin directory, build a zip, and validate the exact zip delivered to the recipient. Write contextual setup; retain useful memory and clarify company-specific content. Never include secrets.
- Load authorized uploaded or session-file zips through a shared resolver/parser path. Do not add directory-only validation.
- Load a public GitHub package from a repository URL, full commit SHA and explicit package directory. Branches, tags, private repositories and arbitrary zip URLs are outside the initial source contract.
- Add POST query, GET detail and read-only validation routes using repository conventions. Preserve the existing load endpoint's permissions, creation and retry guarantees.
- Version catalog and author formats separately from package content and package format. Migrate the bundled catalog, API and frontend together without a legacy catalog reader or custom catalog-root setting.
- Use one Python reader for API responses and generated website data. Remove the hand-maintained frontend catalog once all consumers use the new source.
- Preserve the in-app gallery. Build website template/author pages using the marketplace UI designs Mahmoud will supply. Give each template a "Use it for free" button that creates an agent from its package through the existing signed-in or signup/authentication flow, preserving the original selection.
- Validate every bundled package and the catalog/author graph in continuous integration (CI). Add guided pull-request submission after the manual contribution path works.

## Capabilities

### New Capabilities

- `template-export`: chat-driven export, contextual setup and repairable zip validation.
- `template-upload-loading`: authorized uploaded and session-file zips through the existing loader.
- `template-github-loading`: commit-pinned public package-directory loading.
- `template-catalog-api`: query/detail endpoints and one versioned metadata source.
- `app-template-gallery`: preservation of the current gallery and selection behavior.
- `marketplace-submission`: manual and guided contributions with full catalog validation.
- `website-marketplace`: template and author pages from generated shared data.

### Modified Capabilities

- None in this standalone change. Existing internal source behavior remains supported.

## Impact

Implementation will touch template source resolution, parser error reporting, metadata, API routes, built-in skills, the app gallery and the website. This pull request adds documents only. It does not install skills, alter a deployment, change repository branch protection, or implement these features.

Catalogs remain bundled with app releases. The website may build sooner, so it can list a key that an older instance does not contain. The destination must explain that mismatch rather than substitute another template.

Out of scope: mandatory install preview, a separate privacy-audit system, catalog zip-download routes, automatic schedule activation, runtime catalog refresh, private GitHub sources, subagent templates, and a self-hosted destination picker. The latter remains a separate feasibility study.

## Context

The existing single-agent loader parses bundled plugin directories, resolves connections, compiles configuration and starts a workflow/session. Its source DTO only accepts an internal catalog key. The app's presentation data is maintained in a TypeScript array. See [evidence](evidence.md) for the checked code and baseline.

This design extends those boundaries. It does not introduce a package registry, a second loader, or a second package format.

## Goals / Non-Goals

Deliver chat-driven export, zip and public GitHub loading, one shared catalog source, website pages and guided contributions. Preserve the current in-app gallery and existing installed agents.

Do not implement a custom catalog root, background catalog refresh, mandatory install preview, separate privacy scanner, private repository access, or directory-only validation. Website-to-self-hosted destination selection remains research. Marketplace website styling and interactions come from Mahmoud's separately supplied UI designs.

## Decisions

### Package and transport

Keep readable packages at `api/oss/src/resources/agent_templates/packages/<key>/<version>/`. A portable plugin directory remains the content format. A zip is its export transport. Keep existing `plugin.json.version`, extension schema identifiers and the package digest algorithm. Media used to market a template lives outside its installable package.

Published package versions remain immutable. Editing setup, instructions, skills or seed files requires a new package version. Editing listing copy or a screenshot does not.

### One validation path

The export skill writes files, creates a zip, validates that zip, then delivers it. On failure it repairs the source files, rebuilds and revalidates. This checks the exact deliverable and removes the validation-only directory API.

Load and validate share source resolution, extraction and the existing parser. CI calls the same parser on repository directories through a local function, not through a remote filesystem API. Validation returns structured file/field/code/message/next-step issues. It creates no workflow, session, registry skill or schedule. Temporary extraction files are cleaned up.

### Authorized file sources

Uploaded zips and chat-created zips should reach the same bounded archive resolver. First inspect existing attachment and drive services. Reuse one authorized immutable file reference if both can supply it. Otherwise keep two thin source adapters feeding the same resolver. Do not create a new staging service or make users download and re-upload a chat file solely to reduce implementation code.

Reject traversal, absolute paths, backslashes, symlinks, duplicate normalized archive paths and non-regular entries. Enforce file count, path depth, compressed transfer limits and actual decompressed byte limits while reading, not only ZIP header declarations. Preserve project/session authorization at the file boundary.

### Commit-pinned GitHub source

Require a public repository URL, full commit SHA and explicit package directory. A reviewer or submission skill resolves the pull request's head before calling the loader. The backend does not accept branches or tags and does not scan for packages.

Fetch only the selected directory at that commit with one bounded strategy. Reuse suitable URL parsing and limits from skill fetching, but not its registry import service or a whole-repository archive fallback. GitHub tree/content entries must be checked for unsupported symlinks/submodules and path escapes. Bound listing work and downloads as well as resulting package size. A small template in the Agenta monorepo must not require downloading the whole monorepo.

### Retry behavior

Keep the project-scoped Idempotency-Key contract and existing creation ownership. A retry must not create another workflow or session. Compare the request identity and retain the resolved package version/digest with provenance. The request includes an immutable GitHub commit or an immutable authorized upload reference. Mutable session paths require a content pin when consumed by load.

A completed successful request can replay without refetching GitHub or rereading an expired upload. An interrupted request must resume using its stored pin or fail clearly without substituting new bytes or duplicating durable effects. Extend the current loader's retry logic; do not invent a parallel retry store. Exact storage changes require reading the current loader and session-start code.

### One catalog reader

One Python reader owns catalog/author schema checks, display fallbacks and package-derived connection/tool summaries. API query/detail and the website data generator both call it. TypeScript renders the normalized data; it does not implement a second metadata normalizer.

Migrate all frontend consumers before deleting the handwritten array. Do not leave connection or tool summaries in that array as a runtime fallback. A frozen test fixture can prove parity without remaining a production data source.

### Coordinated catalog migration

The bundled catalog, API and frontend ship together. Replace the unwrapped catalog with the versioned envelope and update the resolver in the same release. Reject the obsolete envelope with an actionable schema error; do not keep a dual reader. Do not add an operator catalog-root setting. Tests can inject fixture paths as they do today.

This is a catalog representation change, not a package-format migration. Keep extension schema v1, published package bytes and existing load-request semantics. Externally shared packages still need supported-schema validation. If implementation uncovers a documented independently deployed catalog consumer, stop and report that concrete contract before broadening compatibility scope.

The website ships independently but consumes the generated data from its own build. An older app's bundled catalog may lack a website key. Show that mismatch. It does not require the old app to parse the new website's catalog format.

### Chat export and setup

Save as template submits one visible user message through normal chat. It does not directly copy configuration. Preserve unsent composer text and prevent duplicate submission. The create-template skill handles that request and equivalent typed requests.

Establish whether the package is general or team-specific. Retain useful memory and requested company conventions. Ask about ambiguous private/company-specific content. Exclude credentials, secret values and project account bindings. Describe connections as recipient requirements.

Write SETUP.md from the actual package: purpose, prerequisites, accounts to connect, missing recipient inputs, retained company choices, suggested inactive automations and one first-use check. Do not activate copied schedules. Exported templates must stay within the existing single-agent parser's supported behavior.

### Marketplace delivery

Use a generated JSON build input for template and author pages. Preserve stable keys and derive author membership from catalog references. The published site includes merged entries; preview builds may contain proposed entries without imposing requirements on the published site.

CI validates all bundled packages and the entire catalog/author graph. Use Git history only to detect changes to already-published package versions. Preserve safe execution on untrusted fork PRs: parse files as data; never execute contributed package scripts or expose credentials. Optimize package selection only after measuring a material cost.

The website data pipeline and pages depend on the catalog reader, not on export or GitHub loading. Build and prove the manual contribution path before adding submit-template guidance. The guided flow obtains approval before opening a PR and includes the exact source triple for review.

## Risks / Trade-offs

- Zip repairs repeat packaging work, but acceptance matches the delivered bytes.
- Commit-only loading makes callers resolve a branch themselves, but avoids mutable source selection in the backend.
- A full catalog migration needs all gallery fields represented before switching. It avoids permanent dual ownership.
- Full CI validation costs more as the catalog grows. Measure before adding selective traversal.
- Authorization, archive safety and duplicate-request protection remain required. They are not optional simplifications.
- Model evaluations are still needed: parser success cannot prove setup usefulness.

## Delivery

Follow [tasks](tasks.md) and the three plans. Keep implementation checkboxes unchecked in this documentation PR. Record test commands and results per implementation change. UI designs gate marketplace visual implementation, not backend or generated-data work.

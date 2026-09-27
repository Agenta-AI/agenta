## 1. Catalog and metadata

- [x] 1.1 Audit all current gallery consumers and freeze a display parity fixture
- [x] 1.2 Add catalog/author schema v1 and one Python reader; migrate the bundled catalog and resolver together without a legacy reader or custom-root setting
- [x] 1.3 Derive connection/tool summaries from packages and preserve published package versions
- [x] 1.4 Add POST query and GET detail using repository API conventions
- [x] 1.5 Migrate every in-app consumer, prove parity, and remove the handwritten runtime catalog
- [x] 1.6 Generate website JSON from the same reader and prove API/build parity

Evidence for 1.1-1.5: `api/oss/tests/pytest/unit/agent_templates/test_catalog.py` (frozen gallery parity, whole-graph validation, old-envelope rejection, package digests unchanged), `test_router.py` (query/detail/permissions/404s) and `web/packages/agenta-entities/tests/unit/agentTemplates.test.ts` + `agentTemplateCatalog.test.ts` (API entry to card parity, pending/error/missing states). The handwritten `AGENT_TEMPLATES` array is removed. Gallery comparison (2026-09-26, local sandbox, 1440x900): the gallery, the Support filter, the Bug report router detail page and the PR reviewer create surface render the same text on the base branch and on this branch, and the screenshots match pixel for pixel apart from the Next.js dev indicator. Browser QA also covered the unlisted and unknown keys, and the error and retry states.

## 2. Create and load

- [x] 2.1 Inspect attachment/drive authorization and use one file-reference path where supported, otherwise two thin adapters with one archive resolver
- [x] 2.2 Implement bounded extraction and source DTO updates; audit source.key assumptions
- [x] 2.3 Expose read-only zip validation through the existing parser; return structured repair issues and content pins
- [x] 2.4 Extend load with authorized zip inputs and preserve connection setup, first-message and no-duplicate behavior
- [x] 2.5 Make completed retries independent of source refetch; test interrupted and conflicting requests
- [ ] 2.6 Add recipient-aware export skill: write files, zip, validate, repair/rebuild, and deliver the validated zip
- [ ] 2.7 Add Save as template through normal chat; preserve draft text and prevent duplicate sends
- [ ] 2.8 Run simple, integration and general/team-specific export/load cases with smaller and reference models

Evidence for 2.1–2.3 and 2.5 (create-and-load PR): attachments are immutable ready rows with a content digest, while chat-made zips live in the mutable session drive, so two thin stagers (`UploadArchiveStager`, `SessionFileArchiveStager`) feed one `StagedTemplateSourceResolver` and one `PackageTreeWriter` (`api/oss/src/core/agent_templates/archive.py`, `sources.py`). Tests: `cd api && uv run pytest oss/tests/pytest/unit/agent_templates -q` (`test_archive.py`, `test_validation.py`, `test_loader.py`, `test_router.py`). 2.4 was also exercised against a running API, Postgres, Redis, SeaweedFS, services and runner: upload and session-file loads returned 201, same-key retries returned 200 with the same ids after the file changed, a changed message returned 409, and a stale pin returned 422 (see the PR description).

## 3. GitHub loading

- [x] 3.1 Accept public repository + full commit + directory only; reject branches, tags, abbreviated commits and ref fields
- [x] 3.2 Fetch the selected directory with bounded traversal/downloads and no whole-repository fallback
- [x] 3.3 Record source provenance and test fork heads, missing paths, private sources, invalid paths and a small package in the real monorepo
- [x] 3.4 Test replay after remote unavailability and exact-pin recovery after interruption

Evidence for 3.1, 3.2 and 3.4 (GitHub import PR): `GitHubTemplateSource` (`api/oss/src/core/agent_templates/dtos.py`) accepts `https://github.com/<owner>/<repo>`, a full 40-hex commit and a relative package directory, and rejects branches, tags, abbreviated SHAs and `ref`/`branch`/`tag` fields with instructions to supply the resolved commit. `GitHubPackageStager` (`api/oss/src/core/agent_templates/github.py`) feeds the shared `PackageTreeWriter`: one commit read, one tree listing per path segment, one recursive listing of the package directory, then one commit-pinned raw download per file, each checked against its blob SHA. Limits are enforced from the listing before any download and again on bytes written; symlinks, submodules and truncated listings are rejected; no archive is downloaded. Completed replays do not contact GitHub; interrupted loads refetch the same commit and must match the stored pin. Tests: `cd api && uv run pytest oss/tests/pytest/unit/agent_templates -q` (`test_github_source.py`, `test_github_fetcher.py`, `test_github_loading.py`). Evidence for 3.3: unit tests cover provenance, fork repositories, missing paths, private sources and invalid paths. Live QA on 2026-09-26 against a host-run API (Postgres 17, Redis, SeaweedFS) loaded `api/oss/src/resources/agent_templates/packages/code-qa/1.0.0` from `https://github.com/Agenta-AI/agenta` at `2b0ed5de1429fb35aa91da1f6880008acf9ac33a`: validate returned version `1.0.0` and digest `sha256:c92395c4bbf94dacb40b0f4d132c5d9060ac535e40d8fa2f90cfcdbdabe8e131` (equal to the bundled package), load created one agent whose stored origin records repo, commit, path, version and digest, and a retry with the same key created no second agent. The fork PR head of #7161 (`6a81050e00c5cef93f91819138b2b7fca10edd94`) loaded through the parent repository URL; the sandbox egress policy blocked the fork's own URL. The session start returned 503 because no runner was available in the sandbox.

## 4. Marketplace

- [x] 4.1 Validate all packages and catalog/author references in CI, with a Git comparison for published-version immutability
- [ ] 4.2 Document and rehearse the manual contribution path; configure the required check only with maintainer authorization
- [ ] 4.3 Receive Mahmoud's marketplace website UI designs and resolve any data-contract conflicts before visual implementation
- [ ] 4.4 Build template index/detail/author pages from generated data; connect each Use it for free button to actual package creation through the existing signed-in or signup/authentication flow, retaining the template selection and unavailable-version behavior
- [ ] 4.5 Add guided submission after the manual path and exact-head testing work
- [ ] 4.6 Verify merge-to-website-build and merge-to-next-bundled-release behavior without manual registration

## 5. Acceptance evidence

- [ ] 5.1 Prove gallery field/order/deep-link parity and absence of runtime legacy fallbacks
- [ ] 5.2 Test unsafe archives, cross-project references and validation with no durable side effects
- [ ] 5.3 Test catalog format rejection separately from preserved package schema support
- [ ] 5.4 Record export repair attempts and setup usefulness; turn failures into fixtures and rerun
- [ ] 5.5 Verify website data parity, author membership, media fallbacks and page states against supplied UI designs; test Use it for free for signed-in users, signup/sign-in redirects, project setup, pending catalog lookup, duplicate callbacks and unavailable keys
- [ ] 5.6 Record actual test commands/results and limitations; never mark a task complete from document validation alone

## 6. Deferred research

- [ ] 6.1 Verify website-to-self-hosted handoff, including authentication, base paths and catalog-version mismatch, before proposing destination-picker implementation

Website data work depends only on the catalog reader. Marketplace visual work additionally depends on supplied UI designs. Export and GitHub loading are not prerequisites for the website; guided submission needs the manual contribution and exact-head test paths.

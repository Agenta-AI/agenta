# Catalog and metadata implementation plan

**Goal:** Use one metadata source in the API, app and website build while preserving the current gallery.

**Architecture:** A Python reader validates the bundled catalog and authors, reads package definitions for derived summaries, and returns normalized records. API routes and a website JSON generator call it. Replace the handwritten frontend data after all consumers migrate.

**Spec:** [Design](../design.md), [metadata](../metadata.md), [API](../api-design.md), [catalog requirements](../specs/template-catalog-api/spec.md), [gallery requirements](../specs/app-template-gallery/spec.md).

**Status:** Approved delivery direction; implementation not started. New symbol/file names below are proposed. Use the existing equivalent if it already exists when implementation begins.

## Constraints

- Migrate bundled catalog, resolver, API and frontend in one release. No legacy catalog reader or custom-root setting.
- Keep published package bytes, version mappings, extension schema v1 and package digest behavior unchanged.
- Preserve all gallery display fields and ordering, including examples, initials and color. Preserve deep links and every existing entry surface.
- One Python normalization. No TypeScript port and no runtime fallback to the old template array.
- Keep path confinement and schema errors. This simplification removes dual ownership, not validation.

## File responsibilities

Existing paths are relative to the repository root:

- `api/oss/src/core/agent_templates/sources.py`: switch internal resolution to the new reader.
- `api/oss/src/resources/agent_templates/catalog.json`: versioned envelope and presentation metadata.
- `api/entrypoints/routers.py`: inject catalog behavior alongside the existing loader.
- `api/oss/src/apis/fastapi/agent_templates/{models,router}.py`: typed query/detail contracts.
- `api/oss/tests/pytest/unit/agent_templates/`: extend catalog/source/router tests.
- `web/packages/agenta-entities/src/workflow/agentTemplates.ts`: migrate handwritten data, retain useful pure helpers.
- `web/packages/agenta-entities/src/workflow/api/agentTemplates.ts`: extend the existing API client, not a second client.
- `web/oss/src/components/pages/agent-home/hooks/useTemplateSelect.ts`: preserve key selection with fetched data.
- `web/packages/agenta-entities/tests/unit/agentTemplate*.test.ts`: current frontend regression tests.

Proposed additions: `core/agent_templates/catalog.py` for the reader, a focused model module if required, `resources/agent_templates/authors/`, and a small data-generation script beside the resources. Do not create a service wrapper that only forwards calls.

## Task 1: Audit and migrate the data

- [ ] Read all uses of `AgentStarterTemplate` and catalog helpers. Record presentation fields separately from executable fields.
- [ ] Freeze a test-only fixture of current cards, order, examples and connection/tool summaries. Do not turn it into another production source.
- [ ] Write failing tests for schema v1, missing author/package references, old-envelope rejection and current package format preservation.
- [ ] Add the envelope and authors, backfill current display values, and implement `load_catalog(root: Path)` using the current parser for package-derived data.
- [ ] Switch the internal source resolver in the same change. Run the new tests and existing source/catalog/parser tests. Compare package trees to the base: no package bytes may change.
- [ ] Review and commit this testable migration with implementation authorization.

## Task 2: Serve the complete normalized contract

- [ ] Write failing router tests for query filters, stable ordering, detail/version selection, unknown keys and project permissions.
- [ ] Add `TemplatesQueryRequest`, `TemplatesResponse` and `TemplateResponse`, or the existing naming equivalent, with complete gallery fields and resolved author information.
- [ ] Implement POST `/query` and GET `/{key}` through the reader. Register fixed actions before the dynamic key route.
- [ ] Keep pagination out. Return `{count, templates}` and `{template}`. Use standard exception mapping.
- [ ] Run focused API tests and commit. Do not switch frontend consumers to an incomplete response.

## Task 3: Move every app consumer

- [ ] Write failing frontend tests for card parity, loading/empty/error/retry states, ordering and `?template=<key>` behavior.
- [ ] Extend the existing API client and use the repository's state/query conventions. Inspect `web/AGENTS.md` before choosing fetch/cache behavior.
- [ ] Migrate gallery, template strip, onboarding, first-run/mobile and any consumers found by the audit. Preserve behavior, not a synchronous helper signature that no longer fits asynchronous reads.
- [ ] Return a clear unavailable-version state for a missing key; never choose a different template silently.
- [ ] Remove the handwritten runtime array and partial fallback paths only when every consumer uses the new source.
- [ ] Run package tests, compare gallery screenshots, and commit. Frozen test fixtures may remain.

## Task 4: Generate website input

- [ ] Write a parity test that API records and generated website JSON agree for the same catalog/version selection.
- [ ] Add one deterministic generation command calling the Python reader. It reads only bundled files and requires no running API, database or credentials.
- [ ] Make the website build consume that output. Keep the generation command and build dependency explicit; do not hand-edit generated data.
- [ ] Run parity tests and document the command in the implementation change. Website UI design is not required for this task.

## Verification

After repository dependency setup, run from `api/`:

```sh
uv run pytest oss/tests/pytest/unit/agent_templates -q
```

From `web/`:

```sh
pnpm --filter @agenta/entities test:unit
```

These commands are verification targets, not results from this documentation PR. Add focused tests for all modified consumers and run the formatting/lint commands required by their nested instructions. Review screenshot parity and the absence of any remaining handwritten runtime catalog.

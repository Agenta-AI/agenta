# Create and load implementation plan

**Goal:** Export a recipient-aware, validated zip and load zips or exact public GitHub package commits through the current single-agent loader.

**Architecture:** Thin source adapters produce a bounded resolved package. Validate and load share the existing parser; only load creates durable product objects. The export skill packages before validation. A chat action submits a normal visible request.

**Spec:** [Design](../design.md), [API](../api-design.md), [export](../specs/template-export/spec.md), [zip loading](../specs/template-upload-loading/spec.md), [GitHub loading](../specs/template-github-loading/spec.md).

**Status:** Approved delivery direction; implementation not started. New file and symbol names are proposed. Do not create duplicate services where current code already supplies the boundary.

## Constraints

- No directory-only validation source. Validate the zip that will be delivered.
- Keep internal sources and existing permissions, first-message, connection setup and project-scoped retry guarantees.
- Public GitHub sources require repository + full commit SHA + explicit directory. No branch/tag resolution, scanning or whole-repository fallback.
- Preserve the current package limits: 256 files, 4 MiB total, 1 MiB/file, 12 path segments. Bound compressed transfers and streamed decompressed bytes too.
- Exclude credentials and project connection bindings. Keep useful memory and explicitly requested company context. Do not activate automations.
- Smaller-model repair and setup-usefulness tests remain acceptance requirements.

## File responsibilities

- `api/oss/src/core/agent_templates/{dtos,interfaces,sources,parser,loader,provenance}.py`: source typing, resolution, parser reuse, replay and origin records.
- `api/oss/src/apis/fastapi/agent_templates/{models,router,exceptions}.py`: validation/load contracts and errors.
- `api/entrypoints/routers.py`: existing loader/service wiring.
- `api/oss/src/core/sessions/attachments/service.py` and `api/oss/src/core/mounts/service.py`: inspect existing authorized byte/drive access before adding adapters.
- `api/oss/src/core/skills/fetcher.py`: reuse URL/transport knowledge only where policy matches.
- `api/oss/tests/pytest/unit/agent_templates/`: regression and adversarial tests.
- `sdks/python/agenta/sdk/agents/platform/op_catalog.py`: existing platform operation declarations; inspect how to expose validate_template.
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`: inspect bundled skill packaging. Ship create-template through the product's built-in skill mechanism, not by configuring only the implementing agent.
- `web/packages/agenta-entities/src/workflow/api/agentTemplates.ts`: existing load client.

Proposed focused modules: `core/agent_templates/archive.py` for bounded extraction and `validation.py` for parser-to-issue mapping, only if those responsibilities do not fit current modules. Locate the actual Publish/Share component and chat submission hook before naming or changing UI files.

## Task 1: Establish authorized zip inputs

- [ ] Trace attachment lookup and drive access with project/session checks. Record whether chat files already have reusable immutable attachment references.
- [ ] Choose one reference shape if both workflows already support it; otherwise retain upload/session-file DTOs feeding one archive resolver. Do not add a staging service or user download/re-upload step.
- [ ] Write failing tests for internal-source compatibility, authorized zip lookup, foreign-project denial, missing files and host-path refusal.
- [ ] Add the source union and update typed assumptions, including `source.key` logging and provenance. Run existing internal-loader tests before adding other behavior.
- [ ] Review and commit the independently tested input boundary with implementation authorization.

## Task 2: Extract and validate the deliverable

- [ ] Write failing tests for valid zips, malformed archives, traversal, duplicate normalized paths, absolute/backslash paths, symlinks, special entries, count/depth limits and decompression beyond actual byte bounds.
- [ ] Implement one extractor and run all new cases to green. Never trust only ZIP-declared sizes; enforce actual bytes consumed.
- [ ] Write failing validate-route tests: valid version/digest, actionable missing-file issue, unauthorized source errors, and no durable workflow/session/skill/automation writes.
- [ ] Implement read-only validation with the source union and current parser. Return supported schema information and the version/digest pin. There is no session-directory variant.
- [ ] Expose `validate_template` using the product's existing platform tool declaration path. Add tool contract tests and run the focused suites.

## Task 3: Load and retry without duplication

- [ ] Extend load to zip references with the same parser/compiler/binding path. Test agent/session creation, seed files and initial message.
- [ ] Require a validated content pin for mutable drive paths; reject changed bytes. Confirm attachment IDs are immutable or apply the same check.
- [ ] Read `template_request_fingerprint`, stored-origin replay, workflow creation and session-start code before changing persistence. Test identical requests, changed source pins, changed messages, changed connection choices and project scoping.
- [ ] Return completed results without rereading the original source. Test replay when an upload is unavailable. Distinguish completed replay from recovery of an interrupted request.
- [ ] Inject interruption before/after durable creation and verify the existing ownership mechanism prevents a second workflow/session and rejects replacement content.
- [ ] Run loader/router/provenance tests and commit. A digest comparison alone does not prove safe replay.

## Task 4: Export skill and Save as template

- [ ] Add a product built-in skill that establishes audience, reads configuration, retains/generalizes company context as requested, omits credentials, writes the plugin tree and contextual SETUP.md, creates a zip, validates, repairs/rebuilds and delivers the accepted zip.
- [ ] Keep connections as recipient requirements and schedules inactive. Stay within the parser's supported single-agent package shape.
- [ ] Test basic, integration/skills and company-specific agents, including general versus team-specific exports. Load each accepted zip and compare intended transferable configuration.
- [ ] Write UI tests that the action submits exactly one visible chat message, preserves an unsent draft, and prevents double-click duplication. Settle exact placement with Mahmoud; do not add a direct exporter behind the button.
- [ ] Implement through existing chat submission. Add upload/session-file selection to the existing creation flow without a mandatory preview. Test selection, invalid-source errors and recovery.
- [ ] Run one smaller tool-capable model and one reference model on the fixtures. Record repair attempts, final validity and setup usefulness. Fix failures, add regression fixtures and rerun; basic/integration cases must pass the smaller-model gate.

## Task 5: Commit-pinned GitHub import

This step can be reviewed separately from zip export. It does not gate website work.

- [ ] Write DTO tests rejecting branches, tags, abbreviated SHAs and `ref`, while accepting a public repo, full commit and explicit package path.
- [ ] Implement one bounded directory fetcher. Reuse existing URL parsing where suitable. Enforce file/path/byte limits and reject symlink/submodule entries, unsafe paths and oversized/truncated listings. Do not download a whole-repository archive as fallback.
- [ ] Write tests proving every request pins the same supplied commit, missing/private sources create nothing, and a small directory can load from a large repository.
- [ ] Extend source selection and provenance; display actionable errors without changing the bundled catalog.
- [ ] Test completed replay with GitHub unavailable and interrupted recovery with a stored pin. Do not refetch a different revision.
- [ ] Rehearse a fork's exact PR head and a real small package in the Agenta monorepo. Record repo, commit, path, version and digest. Run all focused tests and commit.

## Verification

After dependency setup, from `api/`:

```sh
uv run pytest oss/tests/pytest/unit/agent_templates -q
```

From `web/`:

```sh
pnpm --filter @agenta/entities test:unit
```

Run the relevant SDK platform/built-in skill tests after exposing validation and export, using `sdks/python/run-tests.py` and its supported options. Record the exact command used. Include real export/load and smaller-model evidence, not only mocks. None of these runtime tests were executed by the documentation PR.

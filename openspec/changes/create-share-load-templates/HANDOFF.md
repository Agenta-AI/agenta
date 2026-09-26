# Implementation handoff

## Your task

Implement template creation, sharing and loading using this approved delivery direction. This branch contains documents only. Do not treat any unchecked task as implemented, and do not widen the scope to a general package registry or a new template format.

Read [README](README.md), [design](design.md), [API contracts](api-design.md), [metadata](metadata.md), then the [task checklist](tasks.md) and the three plans. Behavioral specifications under `specs/` are the acceptance criteria. Resolve contradictions before coding rather than choosing silently.

Mahmoud will also give you marketplace website UI designs. Wait for those before choosing page layout, visual style or new interactions. You can start catalog, source and website data work immediately. If a supplied design needs a new field or behavior, identify the difference and ask before extending the approved contract. Preserve the existing in-app templates experience; a marketplace redesign is not approval to redesign that app page.

## First steps

1. Check out this documentation branch or its merged successor. Refresh your code baseline. The source inspection here used `c5c4ff1bc35f50735e5e0a49b7fb651a60610f2b`.
2. Read root `AGENTS.md`, then the nested API, web, website and SDK instructions for areas you touch. Discover relevant repository skills instead of assuming agent-specific tooling is installed.
3. Re-read current template loader, parser, source DTOs, frontend API client and gallery tests. Existing code may have advanced since this document.
4. Trace current attachment/drive byte access. Decide whether existing immutable authorized references cover both upload and chat-created zips. Otherwise use two thin adapters into one resolver. Record the chosen contract before exposing it.
5. Start the catalog migration with a parity fixture and failing tests. Do not add a legacy catalog reader or custom-root configuration.
6. Keep `tasks.md` current as implementation lands. Each completion needs tests/evidence, not merely a commit or a document update.

## Workstreams and order

| Workstream | Starts after | Deliverable |
| --- | --- | --- |
| Catalog and metadata | Current code/consumer audit | One reader, migrated bundled metadata, complete query/detail responses and gallery parity |
| Create and load | Authorized file-access audit | Shared zip validation/load, recipient-aware export skill and chat action |
| GitHub import | Shared source and load boundaries | Public repo + full commit + directory, exact provenance and retry tests |
| Website data and CI | Catalog reader | Generated JSON, all-package validation and manual contribution guide |
| Website pages | Website data plus Mahmoud's UI designs | Template index/detail/author pages matching those designs |
| Guided submission | Proven manual contribution and exact-head testing | Approval-aware skill that submits a reviewable package PR |

Do not make website delivery wait for export or GitHub import. Keep implementations reviewable in these units; no requirement to complete the full project in one PR. Obtain any required authorization for external writes, deployment, repository settings or merges. This planning PR does not grant those permissions.

## Settled choices

- **Catalog migration:** frontend, API and bundled catalog ship together. Update them together; no old-envelope reader or operator override. Keep constructor injection for tests.
- **Package support:** do not change extension schema v1, published package contents or the digest algorithm as part of metadata migration. External packages still receive supported-format checks.
- **Validation:** zip first, validate the zip, repair/rebuild if necessary. No remote directory-validation API. CI uses the same local parser on repository directories.
- **GitHub:** full 40-hex commit SHA only; no branches, tags, abbreviated SHAs, implicit latest revision or whole-repository archive fallback.
- **Metadata:** one Python reader owns fallbacks and derived summaries. The API and website generator use it. Remove handwritten frontend data after full parity; do not leave partial runtime fallbacks.
- **CI:** validate every bundled package and the whole catalog/author graph. Only published-version immutability needs Git comparison. No package script execution or credentials in fork validation.
- **Publication:** merged entries become website build input and ship with the next app catalog release. No runtime refresh, no requirement for unmerged-author pages on the published site.
- **Export:** normal chat request near Publish/Share; preserve composer draft; clarify recipient/context; retain useful memory; exclude secrets; write contextual setup; leave automations inactive.
- **Tests:** archive safety, authorization, retry correctness, gallery parity, smaller-model repair and setup usefulness are mandatory, not removed scope.

## Existing code map

All paths are repository-relative and were checked at the recorded baseline:

| Responsibility | Starting point |
| --- | --- |
| Template API | `api/oss/src/apis/fastapi/agent_templates/router.py` and `models.py` |
| Source types / resolver | `api/oss/src/core/agent_templates/dtos.py`, `interfaces.py`, `sources.py` |
| Parser / compiler / loader | `api/oss/src/core/agent_templates/parser.py`, `compiler.py`, `loader.py` |
| Origin metadata | `api/oss/src/core/agent_templates/provenance.py` |
| Service construction | `api/entrypoints/routers.py` |
| Existing package tests | `api/oss/tests/pytest/unit/agent_templates/` |
| Attachment bytes | `api/oss/src/core/sessions/attachments/service.py` |
| Drive and session mounts | `api/oss/src/core/mounts/service.py` and `api/oss/src/core/sessions/mounts/service.py` |
| Skills GitHub fetcher | `api/oss/src/core/skills/fetcher.py` |
| Product built-in skills | `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` |
| Platform tools | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` |
| Gallery data / helpers | `web/packages/agenta-entities/src/workflow/agentTemplates.ts` |
| Existing template client | `web/packages/agenta-entities/src/workflow/api/agentTemplates.ts` |
| Key selection | `web/oss/src/components/pages/agent-home/hooks/useTemplateSelect.ts` |
| Website component | `web/website/src/components/TemplateExplorer.tsx` |

Do not confuse product skill implementation with configuring your own agent. Ship create-template and submit-template through the repository's built-in skill machinery. Installing a local personal skill does not deliver the product feature.

## Resolve during implementation

These are bounded engineering questions, not reasons to reopen all product scope:

- Do attachments and drive files already share an immutable authorized reference? Choose the smallest existing boundary that supports both user workflows.
- How can completed load requests replay before source resolution, while incomplete ones recover from stored pins without duplicate effects? Read the current fingerprint and session-start implementation before adding state.
- Where should the bounded GitHub directory fetch live, and which existing helpers fit without importing skill-registry policy? Choose one transport, test limits, and retain explicit package paths.
- Which current UI components own Publish/Share and source selection? Use their existing submission/state conventions. Settle the exact export action position with Mahmoud.
- Which marketplace fields/routes do the supplied UI designs need? Compare with metadata before visual implementation. Do not invent placeholder product decisions and mark them approved.

## Verification and evidence

OpenSpec 1.13.1, from the repository root:

```sh
openspec validate create-share-load-templates --strict --no-interactive
```

After normal dependency setup, from `api/`:

```sh
uv run pytest oss/tests/pytest/unit/agent_templates -q
```

From `web/`:

```sh
pnpm --filter @agenta/entities test:unit
pnpm --filter website test
pnpm --filter website build
```

Also run the affected SDK platform/built-in skill tests and the nested instructions' formatting/lint checks. Record the exact commands used and environment prerequisites. The documentation PR validates documents only; these runtime checks still need to happen.

For acceptance, attach:

- An export/download/upload/load round trip showing the intended transferable configuration.
- Smaller/reference model runs with repair attempts and setup-usefulness results.
- Exact-head GitHub loading with repo, commit, path, version and digest.
- Completed replay with the source unavailable, conflict cases and interrupted-creation recovery.
- Invalid archive, cross-project authorization and no-durable-write validation tests.
- Before/after gallery screenshots and website screenshots compared to the supplied designs.
- Full CI validation failures for an invalid package, missing author, unsupported format and overwritten published package version.

Keep production release and merge evidence separate from local tests. Never mark a future release verified from a local build.

## Out of scope

No new package format, generic registry, subagent templates, private GitHub access, automatic schedule activation, catalog zip-download endpoint, background catalog updates, mandatory install preview or separate privacy audit. Self-hosted destination selection remains research and requires a later decision.

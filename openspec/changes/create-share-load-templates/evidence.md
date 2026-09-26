# Evidence and implementation baseline

## Repository inspection

Checked against Agenta main commit `c5c4ff1bc35f50735e5e0a49b7fb651a60610f2b` on 2026-09-26. Earlier planning used `b7c5d33de1d3b99246c652cc93b1410b07b0f9c0`; implementation must use the current checkout, not assume either snapshot is still the head.

| Observation | Repository evidence |
| --- | --- |
| Production wiring points directly at the bundled catalog file | `api/entrypoints/routers.py`, construction of `InternalTemplateSourceResolver` |
| The current catalog reader accepts an unwrapped map and resolves versioned directories | `api/oss/src/core/agent_templates/sources.py`, `_read_catalog` and `resolve` |
| The source DTO currently names internal templates | `api/oss/src/core/agent_templates/dtos.py` |
| Package parsing and immutable version/digest pins already exist | `core/agent_templates/parser.py`, `sources.py` and `dtos.py` under `api/oss/src/` |
| Loader retries already have fingerprints and stored provenance; resolution still occurs in the preparation path | `api/oss/src/core/agent_templates/loader.py` |
| The existing frontend already has a template API client and unit tests | `web/packages/agenta-entities/src/workflow/api/agentTemplates.ts` and `tests/unit/agentTemplate*.test.ts` in that package |
| Gallery presentation has a handwritten source | `web/packages/agenta-entities/src/workflow/agentTemplates.ts` |
| Website template presentation already links to the app with `?template=<key>` | `web/website/src/components/TemplateExplorer.tsx` |
| Website selection is captured alongside authentication URL state and retained with claim/lifetime safeguards | `web/oss/src/state/url/auth.ts` and `template.ts`; tests in `template.test.ts` |
| The pending website consumer currently creates with name/seed only; the creation hook already accepts a template for package loading | `web/oss/src/components/pages/agent-home/hooks/useConsumePendingTemplate.ts` and `useCreateAgent.ts` |
| Runtime built-in skills are packaged in SDK code | `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` |
| Template tests are under pytest/unit, not the path named by the earlier draft | `api/oss/tests/pytest/unit/agent_templates/` |

A targeted search of template wiring, `api/oss/src/utils/env.py`, template design documents and OpenSpec documents found no operator custom catalog-root setting or documented legacy-catalog deployment contract. Constructor injection of `catalog_path` is not such a contract. This supports the coordinated bundled migration; it is not a claim that every downstream fork has been inspected.

## Confirmed decisions

Mahmoud approved simplification items 1 through 5 and the three-part delivery plan on 2026-09-26:

- Validate exported zips, not a separate remote directory source.
- Require exact public GitHub commits rather than mutable branches/tags.
- Use one Python catalog reader and eliminate partial frontend data fallbacks.
- Migrate the bundled API/frontend/catalog together; omit speculative compatibility and custom-root configuration.
- Validate all packages in CI before considering selective optimization.
- Publish only merged author/template entries; previews can show proposed entries.
- Let website data work proceed without export/GitHub loading. Add guided submission after manual contribution works.
- Marketplace website UI designs will be supplied to the implementing agent separately.
- Each website template must have a "Use it for free" button. Reuse the existing authentication flow: create from the package for signed-in users, or retain the template through signup/sign-in and create afterward. This is a connection to existing behavior, not a new authentication subsystem. Source inspection confirms the current consumer-to-package-loading gap; the end-to-end flow has not been browser-tested in this documentation change.

The pre-existing constraints remain: chat-triggered export, release-bundled catalog, no mandatory install preview or separate privacy audit, case-by-case useful memory, contextual setup, small-model repair tests, no catalog zip downloads, and preservation of the in-app template page.

## Prior-art references

These informed the earlier exploration. They are context, not compatibility contracts or proof of currently deployed behavior:

- [Agent Plugins specification](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md): portable plugin directory and manifest conventions.
- [Codex plugins](https://developers.openai.com/codex/plugins/build): related plugin distribution model. Recheck the current documentation before copying format assumptions.
- [n8n workflow templates](https://docs.n8n.io/workflows/templates/): related discovery/distribution behavior. The exact website-to-self-hosted handoff was not browser-verified in this work.

Agenta's checked-in package schemas and parser are the implementation authority for supported fields. No external template transport or self-hosted handoff is claimed compatible based on these references.

## Verification boundary

This is a documentation-only proposal and handoff. OpenSpec validation and link checks establish document structure, not runtime correctness. No new API, UI, source adapter, skill, model evaluation or deployment has been implemented or tested here. Implementation acceptance evidence belongs in the follow-up code changes.

## Implementation evidence: marketplace data and CI

Recorded on 2026-09-26 on branch `claude/project-thread-jfk9ly`, stacked on the catalog reader branch. Local sandbox results; not production or release evidence.

**Contract chosen.** `web/website/src/data/templates.json` is generated by `api/oss/src/core/agent_templates/marketplace.py` from `AgentTemplateCatalog` and committed. Each template is the same `AgentTemplateEntry` dump the API returns (`exclude_none`); authors carry `template_keys` derived from template references, and only authors with a listed template are written. CI and an API unit test fail when the committed file is stale. The website `prebuild` runs `scripts/check-template-data.mjs`, which fails the build with the regenerate command when references are broken. The website build therefore needs no Python.

| Task | Command (from) | Result |
| --- | --- | --- |
| 1.6, 4.1 | `uv run pytest oss/tests/pytest/unit/agent_templates -q` (`api/`) | 139 passed; `test_marketplace.py` covers valid tree, missing author (entry + author id in the message), missing, unmapped and non-standard package paths, unsupported extension schema, modified, added, untracked and deleted files in a published version against a real git base ref, ignored files and CRLF normalization not counting as changes, unknown base ref, API/website parity for every key, author membership, unlisted templates, determinism and staleness |
| 4.1 | `uv run python -m oss.src.core.agent_templates.marketplace validate --base-ref origin/main` (`api/`) | `Template catalog, authors and packages are valid.`; full validation of 29 records took about 7 s wall time, most of it imports, so no selective validation was added |
| 4.1 | same, after appending a line to `packages/pr-reviewer/1.0.0/.../AGENTS.md` | exit 1: `template_published_version_changed ... template="pr-reviewer@1.0.0"` |
| 4.2 (local only) | followed `api/oss/src/resources/agent_templates/CONTRIBUTING.md` with a new author `jane-doe` and template `invoice-chaser` | `website` regenerated the data with `jane-doe:invoice-chaser`; `validate` passed. Changes reverted. Fork rehearsal and required-check setup still need maintainer authorization |
| 4.4 (behavior only) | `pnpm exec vitest run src/components/pages/agent-home/hooks/ src/state/url/` (`web/oss`) | 32 passed; the website consumer calls `createAgent({name, template})` when no account is missing, opens the create surface's setup step (`?new=1&template=<key>`) when one is, waits for connections to load, creates once on repeated consumption, and shows an unavailable message and creates nothing for an unknown key |
| 4.4 | `pnpm exec vitest run tests/unit/agentSetup.test.ts` (`web/packages/agenta-entities`) | 21 passed; `setupStepNeeded` is the one gate the in-app setup step and the website consumer share |
| 1.6, 4.4 | `pnpm test` and `pnpm build` (`web/website`) | 63 passed (64 after the empty and non-array data checks were added); build passed; a corrupted author id in the data stops `prebuild` with the regenerate command. The landing CTA reads "Use it for free" and links `https://cloud.agenta.ai/?template=<key>`; every featured key exists in the generated data |

CI runs the check on pull requests and pushes to `main` that touch the catalog, the reader, the API or SDK dependencies, or the website data, and compares against `HEAD^1`. It is not a required check.

Not done in this change: website index/detail/author pages and their visual design (owned by the marketplace website pages change), browser verification of signup and sign-in redirects, and guided submission.

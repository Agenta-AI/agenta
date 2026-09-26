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
| Website template presentation has an existing component | `web/website/src/components/TemplateExplorer.tsx` |
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

The pre-existing constraints remain: chat-triggered export, release-bundled catalog, no mandatory install preview or separate privacy audit, case-by-case useful memory, contextual setup, small-model repair tests, no catalog zip downloads, and preservation of the in-app template page.

## Prior-art references

These informed the earlier exploration. They are context, not compatibility contracts or proof of currently deployed behavior:

- [Agent Plugins specification](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md): portable plugin directory and manifest conventions.
- [Codex plugins](https://developers.openai.com/codex/plugins/build): related plugin distribution model. Recheck the current documentation before copying format assumptions.
- [n8n workflow templates](https://docs.n8n.io/workflows/templates/): related discovery/distribution behavior. The exact website-to-self-hosted handoff was not browser-verified in this work.

Agenta's checked-in package schemas and parser are the implementation authority for supported fields. No external template transport or self-hosted handoff is claimed compatible based on these references.

## Verification boundary

This is a documentation-only proposal and handoff. OpenSpec validation and link checks establish document structure, not runtime correctness. No new API, UI, source adapter, skill, model evaluation or deployment has been implemented or tested here. Implementation acceptance evidence belongs in the follow-up code changes.

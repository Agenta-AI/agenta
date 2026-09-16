# PR #6604 backend interface review

## Founder direction captured

- Skills remain workflow-backed resources.
- A skill API should follow the repository's workflow-backed domain conventions.
- The frontend should not split one skill lifecycle across skill and workflow APIs.
- GitHub provenance should live in a protected namespace inside `meta`, rather than new source tables, for this implementation.
- Discovery must allow future marketplaces, an Agenta catalog, direct repositories, and personal catalogs.
- V1 only needs GitHub, but contracts and services must not encode GitHub as the whole domain.

## Observations

### The lifecycle is split across two APIs

`SkillsRouter` adds:

```text
POST /skills/query
POST /skills/usage
POST /skills/sources/scan
GET  /skills/sources
POST /skills/sources
POST /skills/sources/{source_id}/refresh
```

The frontend still uses generic workflows to create skills, fetch and commit revisions, archive and restore skills, and attach them to agents.

Evaluators provide a complete domain API over workflows. Prompts have no prompt backend router and use workflow APIs directly. Skills follow neither precedent. The partial facade prevents one backend boundary from enforcing skill invariants.

### `usage` combines two reverse-reference scales

The registry listing scans all agent heads once and calculates a count for every listed skill. Separately, `POST /skills/usage` accepts one skill and scans all agent heads again to return the matching agents and whether each reference follows latest or pins a version.

The repository already uses `/usage` for billing. These values describe incoming references, rather than runtime usage. `references` alone would also be ambiguous because it commonly means references made by the skill. `referenced-by` states the direction.

### `sources` combines three concepts

The implementation uses “source” for a persisted repository record, a remote provider, and the immutable origin of one imported version.

- `POST /sources/scan` downloads a public GitHub tarball and parses candidates without writing.
- `POST /sources` downloads it again, creates skill workflows, and creates provenance rows.
- `GET /sources` lists persisted repositories.
- `POST /sources/{id}/refresh` may inspect or commit, depending on `sync_enabled` and `apply`.

The public models contain `repo_url` and `ref`; the implementation accepts only GitHub. There is no provider discriminator or provider adapter at the API boundary.

### Backend layering differs from repository conventions

`SkillImportService` imports the concrete PostgreSQL `SkillSourcesDAO`. The database package has no DAO interface or mappings module. DTO conversion is embedded in `dao.py`.

## Preliminary recommendation

### Use one skill lifecycle interface

Make `SkillsRouter` a consistent facade over workflow persistence and mirror the evaluator/workflow vocabulary for exposed operations:

```text
POST /skills/
GET  /skills/{skill_id}
PUT  /skills/{skill_id}
POST /skills/{skill_id}/archive
POST /skills/{skill_id}/unarchive
POST /skills/query

POST /skills/revisions/retrieve
GET  /skills/revisions/{skill_revision_id}
POST /skills/revisions/query
POST /skills/revisions/commit
POST /skills/revisions/log
```

Keep variants and deployment hidden until the product supports them. All frontend skill lifecycle calls should use this facade. It can atomically check the base revision, synchronize artifact headers and revision content, preserve protected metadata, and validate skill data.

### Model counts and detailed incoming references separately

Use:

```text
GET /skills/{skill_id}/referenced-by
```

If filters or cursor pagination become necessary, use:

```text
POST /skills/{skill_id}/referenced-by/query
```

Return `agents`, with `reference_mode` and `pinned_version`, instead of a generic `usage` array. The registry projection may expose `referenced_by_count` for every skill, but calculating it should be optional when the caller does not render counts.

## Existing Agenta catalogs

Agenta currently uses “catalog” for three separate mechanisms:

1. The workflow catalog is a code-defined collection of schemas, templates, and presets used to create workflows and evaluators. It is a blueprint catalog, rather than a remote marketplace.
2. The static workflow catalog contains complete, immutable, read-only workflows under reserved `__ag__*` slugs. Built-in skills already use this mechanism.
3. Tool and trigger catalogs browse provider-backed integrations. They use a shared catalog service and adapter registry internally, then expose domain-specific `/tools/catalog/*` and `/triggers/catalog/*` routes. This is the closest repository precedent for multiple external providers.

The agent-template gallery is currently a frontend static registry. Its own source comment says the backend can host templates later. It is product presentation data today, rather than a backend catalog contract.

The recommended artifact catalog should reuse the tool/trigger architectural pattern: shared provider registry and normalized core models, with domain-specific Skills and future Prompts facades. It should not reuse the workflow template catalog models because remote artifacts have provider identity, versions, trust, and fetch behavior that creation blueprints do not.

### Separate catalog discovery, import, and update

Use “catalog” for a system that discovers artifacts, “provider” for its adapter, and “origin” for saved provenance.

```python
class CatalogProvider(Protocol):
    provider_id: str

    async def search(self, query: CatalogQuery) -> Page[CatalogItem]: ...
    async def inspect(self, identifier: str) -> CatalogItem: ...
    async def fetch(self, identifier: str, version: str | None) -> ArtifactBundle: ...
```

`CatalogItem` should carry `kind` (`skill` or `prompt`), provider, provider-specific identifier, name, description, version, trust, URL, and extension data. GitHub is the first adapter.

Candidate Skills routes, consistent with the existing domain-scoped catalog convention:

```text
GET  /skills/catalog/providers/
POST /skills/catalog/items/query
POST /skills/catalog/items/retrieve
POST /skills/import
POST /skills/{skill_id}/updates/check
POST /skills/{skill_id}/updates/apply
```

`query` discovers items across selected providers. `retrieve` previews one item. `import` creates project skills. Update check never writes. Update apply always writes or reports a conflict.

The shared core models may support `kind=skill|prompt`, while `/skills/catalog/*` filters to skills. A later `/prompts/catalog/*` facade can use the same service and adapters. This mirrors how tools and triggers share a provider catalog internally while keeping clear public domain APIs.

### Keep the frontend contract normalized

The frontend should receive one provider-neutral shape and should never parse GitHub URLs or branch on marketplace-specific response types:

```text
SkillCatalogProvider
SkillCatalogItem
SkillCatalogItemDetails
SkillOrigin
Skill
SkillRevision
SkillReference
```

The interaction becomes:

```text
browse/search catalog -> retrieve preview -> import selected item
                                            -> receive created Skill

query project skills -> open Skill -> fetch referenced-by or revisions
                                  -> check update -> apply update
```

Provider-specific fields belong in a typed `locator` or extension object. The same frontend calls continue working when another provider is registered. Public clients can expose the same small surface as `skills.catalog.query`, `skills.catalog.retrieve`, `skills.import`, `skills.referencedBy`, and `skills.updates.check/apply`.

### Store provenance in `meta._ag`

Remove `skill_sources` and `skill_source_links` from this PR. Store current origin on the workflow artifact and exact resolved origin on each imported revision:

```json
{
  "meta": {
    "_ag": {
      "origin": {
        "kind": "catalog",
        "provider": "github",
        "identifier": "owner/repository/skills/support-summary",
        "locator": {
          "repository": "owner/repository",
          "ref": "main",
          "path": "skills/support-summary"
        },
        "resolved_version": "abc123",
        "content_hash": "sha256:82d7...",
        "url": "https://github.com/owner/repository/tree/abc123/skills/support-summary"
      }
    }
  }
}
```

Rules:

- The backend owns `meta._ag`; generic client writes cannot replace or remove it.
- Artifact metadata records the current origin used to look for updates.
- Revision metadata is immutable and records the exact imported version and hash.
- A local edit creates a revision without a matching imported origin, so detachment can be derived.
- “Missing upstream” can remain an update-check result in V1.
- Remove `sync_enabled` until scheduled synchronization exists.

No formal reserved metadata namespace currently exists. `__ag__` is reserved for static workflow slugs. Adopting `meta._ag` requires a documented ownership and merge policy.

### Add a table only for an independent resource

A catalog connection table becomes useful when it owns credentials, permissions, schedules, webhooks, attempt history, or organization-wide configuration. At that point it should model a general catalog connection, rather than a skill-specific GitHub source.

## Hermes comparison

Hermes uses a common `SkillSource` interface with `search`, `inspect`, and `fetch`. GitHub, the Hermes index, skills.sh, ClawHub, LobeHub, direct URLs, well-known URLs, and other sources implement separate adapters. Unified discovery selects and merges adapters. Installation and update checking live in another module. Provenance is recorded beside installed skills in a lock file.

The useful boundary is:

```text
provider adapters -> unified discovery -> fetch bundle -> validate -> import -> record provenance
```

Agenta can use that boundary while saving provenance in workflow and revision metadata.

## Required PR changes

1. Remove the source/link migration, entities, and DAO.
2. Define and protect `meta._ag` in workflow writes.
3. Add catalog provider, catalog item, artifact bundle, and origin models.
4. Implement GitHub as the first provider adapter.
5. Split catalog query/retrieve, import, update check, and update apply into explicit operations.
6. Rename skill `usage` to `referenced-by`, identify the skill in the route, and keep aggregate counts distinct from detailed references.
7. Make the Skills router own every lifecycle operation used by the frontend.
8. Make skill commit atomically validate the base revision, update the artifact header, commit content, and preserve provenance.
9. Update the frontend to call only Skills and Catalog interfaces for these flows.
10. Test route parity, protected metadata, provider substitution, read-only update checks, update apply, local edits, and conflicts.

## Deferred requirements

- More marketplaces and catalog providers.
- An Agenta catalog for skills and prompts.
- Personal and organization catalogs.
- Private repository credentials.
- Scheduled synchronization, webhooks, and update history.
- Catalog permissions and administration.

V1 must define extension points for these capabilities. It does not need to implement them.

## Evidence

- [Agenta PR #6604](https://github.com/Agenta-AI/agenta/pull/6604)
- [Skills router](https://github.com/Agenta-AI/agenta/blob/59750be7aaca8459fd7564e534c6677ef90fe7e2/api/oss/src/apis/fastapi/skills/router.py)
- [Skills frontend API](https://github.com/Agenta-AI/agenta/blob/59750be7aaca8459fd7564e534c6677ef90fe7e2/web/packages/agenta-skills/src/api/index.ts)
- [Source migration](https://github.com/Agenta-AI/agenta/blob/59750be7aaca8459fd7564e534c6677ef90fe7e2/api/oss/databases/postgres/migrations/core_oss/versions/oss000000027_add_skill_sources.py)
- [Hermes provider interface](https://github.com/NousResearch/hermes-agent/blob/d86627a7f3e50ee37f9b099a5b405aff204d4253/tools/skills_hub_models.py)
- [Hermes provider router](https://github.com/NousResearch/hermes-agent/blob/d86627a7f3e50ee37f9b099a5b405aff204d4253/tools/skills_hub_search.py)
- [Hermes install/update service](https://github.com/NousResearch/hermes-agent/blob/d86627a7f3e50ee37f9b099a5b405aff204d4253/tools/skills_hub_install.py)
- [Hermes provenance lock](https://github.com/NousResearch/hermes-agent/blob/d86627a7f3e50ee37f9b099a5b405aff204d4253/tools/skills_hub.py)

## Consolidated plain-language review

### What the PR gets right

The PR uses workflows as the stored form of a skill. That is the right foundation. A skill already has the identity, revisions, archive state, references, and access rules supplied by the workflow system. The PR also adds useful product behavior: a skill registry view, reverse-reference information, repository discovery, importing, and checking for upstream changes.

### Limitations we found

The main limitation is that the implementation does not establish one clear skill boundary. Reads and repository actions use `/skills`, while normal skill creation, editing, revision history, archiving, and restoration use `/workflows`. A frontend or public SDK must understand both domains and reproduce skill rules itself. The backend cannot reliably enforce skill validation, protected metadata, concurrency, or artifact-name synchronization when writes bypass `SkillsService`.

The `usage` endpoint also combines two ideas. The registry computes an aggregate reference count for every skill. The detail endpoint accepts one skill and returns the agents that reference it. Neither operation measures execution usage. `referenced-by` describes the detailed relationship more accurately, while `referenced_by_count` describes the aggregate.

The source API combines discovery, importing, provenance, and updating. `POST /skills/sources` sounds like it creates a source, but it downloads a GitHub repository and creates skill workflows. `refresh` can either inspect or write depending on flags. These names force callers to know implementation details and make it difficult to state which requests are read-only.

The apparently general source layer is GitHub-specific at every important boundary. Requests contain `repo_url` and `ref`. The service validates GitHub URLs, downloads GitHub tarballs, derives source slugs from GitHub repositories, and saves GitHub-shaped rows. A second marketplace would require changes across the API, service, persistence, response models, and frontend.

The new source migration is premature for the behavior in this release. The tables do not yet represent an independently managed resource. There are no credentials, schedules, webhooks, permissions, or synchronization history. Their present purpose is to attach origin and update information to workflows. Workflow artifact and revision metadata can represent that information directly with fewer consistency risks.

There are also concrete correctness risks in the current implementation:

- The frontend can confuse a skill display name with its workflow slug when creating references.
- Skill commits do not consistently require an expected base revision, so concurrent edits can overwrite one another.
- Editing skill content can leave the workflow artifact name and description stale.
- A failed refresh commit can still be reported as updated and advance stored synchronization state.
- A multi-skill import can create workflows before provenance links are safely recorded.
- The same repository at different refs is not represented safely by the source identity.
- Archive extraction needs explicit member, per-file, and total uncompressed-size limits.
- The service depends directly on a PostgreSQL DAO rather than a core interface.

### How we evaluated the design

We used four tests.

1. **Repository consistency.** A first-class workflow-backed domain should follow the evaluator facade pattern. A provider-backed catalog should follow the tool and trigger catalog pattern.
2. **Clear operation meaning.** A caller should know from the route whether an operation only reads, creates a project resource, or commits a revision.
3. **Provider extensibility.** Adding a marketplace should require a provider adapter and registration, rather than changes throughout the application.
4. **One source of truth.** Skill content, artifact headers, revisions, and imported provenance should be updated through one backend boundary.

### Required backend extension points

The backend needs two separate abstractions.

The first is a complete `SkillsService` facade over workflow persistence. It owns skill validation and exposes the skill lifecycle while delegating generic storage to `WorkflowsService`.

The second is an artifact catalog service with provider adapters. The catalog service normalizes discovery results. A provider adapter knows how to search, inspect, and fetch from one provider. GitHub is the only provider required in this PR.

```text
Skills API
├── skill lifecycle -> SkillsService -> WorkflowsService
├── referenced-by -> workflow reference inspection
├── catalog browse -> ArtifactCatalogService -> provider adapter
├── import -> provider fetch -> validation -> SkillsService.create
└── update -> saved origin -> provider fetch -> SkillsService.commit
```

The normalized provider contract should use `provider`, `identifier`, `version`, and an optional typed locator. It should not use `repo_url` as the universal identity.

### Simple proposal

Keep skills as workflows. Make `/skills` the complete public facade used by the frontend. Rename `usage` to a directional reverse-reference route. Split remote operations into catalog discovery, import, update check, and update apply. Put GitHub behind the first catalog provider adapter. Remove the source tables and store origin information in protected `meta._ag` fields on the workflow artifact and revisions.

This gives V1 a small implementation and gives future marketplaces a stable extension point. A database table should be introduced later only if a catalog connection becomes its own managed resource with credentials, schedules, webhooks, permissions, or history.

## Copy-ready implementation prompt

You are updating Agenta PR #6604, currently reviewed at commit `59750be7aaca8459fd7564e534c6677ef90fe7e2` against `release/v0.115.2`. Refactor the backend and its frontend client so skills have one consistent workflow-backed API, external discovery uses provider-neutral catalog contracts, and GitHub provenance is stored in protected workflow metadata. Complete the implementation, tests, generated client updates, and validation in this PR.

### Goal

Deliver a narrow first version that supports:

1. Listing, retrieving, creating, editing, versioning, archiving, and restoring project skills through `/skills`.
2. Listing the agents that reference one skill and showing whether each reference follows the latest revision or pins a revision.
3. Discovering and previewing skills from a public GitHub repository without writing project data.
4. Importing selected GitHub skills as ordinary workflow-backed skills.
5. Checking an imported skill for an upstream change without writing.
6. Applying an upstream change as a new skill revision with optimistic concurrency.
7. Preserving enough provider-neutral origin metadata to add other marketplaces later.

Do not implement other marketplaces, private repository credentials, scheduled synchronization, webhooks, or a catalog administration system in this PR.

### Architectural constraints

- A skill remains an ordinary workflow identified by `agenta:builtin:skill:v0` and the derived `is_skill` flag.
- Reuse `WorkflowsService` and workflow DTOs where their semantics match. Do not create another persistence model for skill content or revisions.
- Expose a complete Skills facade for every skill lifecycle operation used by the frontend. Do not make the frontend call generic workflow routes for skill writes.
- Keep workflow variants and deployment out of the Skills API for now. Skills use the default variant and are not runnable.
- Follow the API dependency direction documented in `api/AGENTS.md`: router to service to interface to implementation.
- Core services must not import concrete PostgreSQL DAOs or provider clients.
- Keep provider-specific parsing, network calls, and locators inside provider modules.
- Preserve existing permission checks and exception interception conventions.

### Step 1: remove premature persistence

Remove the new `skill_sources` and `skill_source_links` migration and all DB entities, mixins, DAOs, mappings, dependency wiring, and response joins that exist only for those tables.

Do not replace them with another table in this PR.

If the migration revision is referenced by later migration files on the PR branch, repair the migration chain so it matches the target branch correctly. This migration has not shipped, so remove it rather than adding a compensating migration.

### Step 2: define protected platform metadata

Introduce and document `meta._ag` as a backend-owned namespace. Generic client writes may update ordinary metadata but must not create, replace, or remove `_ag`. Backend services must merge and preserve it.

Store the stable origin and latest successful import checkpoint on the skill workflow artifact. Use a provider-neutral shape similar to:

```json
{
  "meta": {
    "_ag": {
      "origin": {
        "kind": "catalog",
        "provider": "github",
        "identifier": "openai/skills/skill-creator",
        "locator": {
          "repository": "openai/skills",
          "ref": "main",
          "path": "skills/skill-creator"
        },
        "last_imported": {
          "resolved_version": "<commit-sha>",
          "content_hash": "sha256:<hash>",
          "url": "https://github.com/..."
        }
      }
    }
  }
}
```

Store immutable provenance on each revision created by import or update:

```json
{
  "meta": {
    "_ag": {
      "provenance": {
        "operation": "import",
        "provider": "github",
        "identifier": "openai/skills/skill-creator",
        "resolved_version": "<commit-sha>",
        "content_hash": "sha256:<hash>",
        "url": "https://github.com/..."
      }
    }
  }
}
```

Use `operation: "update"` for an applied upstream update. For a local edit, have the backend record local provenance or omit imported provenance according to one documented rule. Derive whether the current head is detached from the artifact origin by comparing the head revision provenance or content hash with `origin.last_imported`. Do not persist a second mutable `detached` flag.

Treat an upstream item that is currently missing as an update-check result. Do not persist `missing_in_source` in V1. Do not keep `sync_enabled`; there is no scheduler in this scope.

Add tests proving that generic workflow and skill edits cannot overwrite or remove `meta._ag`, while trusted backend import and update code can change the permitted fields.

### Step 3: complete the Skills facade

Mirror the evaluator and workflow vocabulary for the subset skills support:

```text
POST /skills/
GET  /skills/{skill_id}
PUT  /skills/{skill_id}
POST /skills/{skill_id}/archive
POST /skills/{skill_id}/unarchive
POST /skills/query

POST /skills/revisions/retrieve
GET  /skills/revisions/{skill_revision_id}
POST /skills/revisions/query
POST /skills/revisions/commit
POST /skills/revisions/log
```

Delegate storage to workflow services, but enforce these invariants at the skill boundary:

- The URI and derived flags always identify a skill.
- The payload under `data.parameters.skill` passes the canonical SDK skill parser and path validation.
- The artifact name and description stay synchronized with the committed skill name and description.
- A commit requires the expected base revision ID and returns the repository-standard conflict response when the head changed.
- Protected metadata is preserved and merged by the backend.
- Static built-in skills remain read-only.
- Archive and restore behavior matches workflows.

Keep response shapes aligned with existing workflow-backed domain DTOs where practical. Avoid a parallel set of nearly identical models unless a skill-specific constraint requires one.

Update the frontend skill package to use only these Skills routes for creation, retrieval, editing, revision history, commit, archive, and restore. Remove direct workflow API calls from the skill lifecycle module.

### Step 4: replace usage with an incoming-reference interface

The current detail operation accepts one skill and returns every agent head that references it. Expose that relationship as:

```text
GET /skills/{skill_id}/referenced-by
```

If the current repository conventions or expected result size require a request body, use:

```text
POST /skills/{skill_id}/referenced-by/query
```

Do not keep `POST /skills/usage` as the canonical operation. A temporary compatibility alias is acceptable only if required for a staged frontend migration and it must be marked for removal.

Return a clearly named collection such as `agents` or `references`. Each result must include the agent identity and enough information to show:

- `reference_mode: "latest"` for an artifact-level workflow reference.
- `reference_mode: "pinned"` for a revision-level reference.
- `pinned_version` or pinned revision identity when the reference is pinned.

The skills registry may expose `referenced_by_count` for each listed skill. Make count calculation optional if callers do not need it, because the current implementation scans all agent heads. Keep the detailed one-skill query separate from the aggregate projection.

Reject or explicitly handle malformed pinned references that do not identify a revision or version. Prevent duplicate attachment of the same skill to one agent unless the product explicitly supports duplicates.

Do not add a skill-specific reference table for performance. If later needed, build a general workflow-reference index that can serve other embedded workflow types.

### Step 5: introduce a provider-neutral artifact catalog

Create a shared internal catalog boundary for discoverable artifacts. Follow the structure of Agenta's existing tool and trigger catalog services: a provider interface, adapter registry, normalized DTOs, and a service that dispatches to registered adapters.

A reasonable layout is:

```text
api/oss/src/core/artifact_catalog/
├── dtos.py
├── interfaces.py
├── registry.py
├── service.py
└── providers/
    └── github/
        ├── adapter.py
        └── client.py
```

Adapt names to repository conventions if there is a better established location, but preserve the boundaries.

Define a provider interface equivalent to:

```python
class ArtifactCatalogProviderInterface(ABC):
    provider_id: str

    async def search(self, query: CatalogQuery) -> CatalogItemsPage: ...
    async def inspect(self, identifier: str) -> CatalogItemDetails: ...
    async def fetch(
        self,
        identifier: str,
        version: str | None = None,
    ) -> ArtifactBundle: ...
```

Use normalized DTOs with at least:

- `kind`, initially `skill`, with room for `prompt` later.
- `provider`.
- Provider display information and declared capabilities such as `search`, `inspect_url`, and version selection, so the frontend does not guess what an adapter supports.
- Stable provider-scoped `identifier`.
- `name` and `description`.
- Provider version or resolved version when known.
- Public URL when available.
- Trust or ownership information when the backend can support it honestly.
- Optional provider-specific display metadata under `extra`.
- A fetched `ArtifactBundle` containing validated relative files and provider provenance.

Do not expose a universal `repo_url` and `ref` contract. Those values belong in the GitHub adapter locator. A caller may still paste a GitHub URL in V1, but the API should normalize it into `provider: "github"` and a provider identifier before import.

Implement GitHub as the only registered external provider. Keep public-repository behavior from the PR. Preserve discovery of a single skill, a multi-skill tree, and supported marketplace manifests.

### Step 6: make remote operations explicit

Expose catalog discovery through the Skills domain, consistent with the existing Tools and Triggers facades:

```text
GET  /skills/catalog/providers/
POST /skills/catalog/items/query
POST /skills/catalog/items/retrieve
```

Required semantics:

- Provider listing is read-only.
- Provider listing reports stable keys, labels, and capabilities.
- Catalog query accepts a search term, optional provider filters, and standard cursor pagination. Providers without search capability are not called for an unscoped search.
- Catalog retrieve accepts a provider plus its stable item identifier or supported locator. This is the V1 path for pasting a GitHub repository URL and previewing the skills found inside it.
- Catalog query is read-only and returns normalized summaries.
- Catalog retrieve is read-only and returns a preview, validation issues, and selectable candidates.
- Provider failures use stable domain errors. Do not expose raw GitHub or HTTP client exceptions.

Replace ambiguous source creation with:

```text
POST /skills/import
```

The request identifies the provider, provider-scoped item or repository identifier, optional version, and selected candidate paths. Each successfully imported candidate becomes a normal skill through `SkillsService.create`, with artifact origin metadata and revision provenance written as part of the same create operation.

For a multi-skill request, define partial-success behavior explicitly. Prefer per-candidate results so one invalid skill does not hide successful imports. Each candidate must still be atomic: never create a skill without its provenance or report success before creation completes.

Replace ambiguous refresh behavior with:

```text
POST /skills/{skill_id}/updates/check
POST /skills/{skill_id}/updates/apply
```

`updates/check` must never write. It reads the artifact origin, chooses the recorded provider, fetches the recorded identifier, compares resolved version and canonical content hash, and returns one of `up_to_date`, `update_available`, `detached`, `missing`, or `invalid`, with details needed by the UI.

`updates/apply` always attempts a write. It requires the caller's expected base revision ID. It re-fetches or validates the target bundle, commits one new revision, synchronizes the artifact name and description, writes immutable revision provenance, and advances the artifact `last_imported` checkpoint only after the revision commit succeeds. A conflict must leave content and metadata unchanged.

Remove the current behavior where a `refresh` request may or may not write depending on `apply` or `sync_enabled`.

### Step 7: keep the frontend and public SDK simple

The frontend should consume normalized domain types:

```text
Skill
SkillRevision
SkillIncomingReference
SkillCatalogProvider
SkillCatalogItem
SkillCatalogItemDetails
SkillOrigin
SkillUpdateCheck
```

Provide a client surface approximately like:

```typescript
client.skills.query(input)
client.skills.get(skillId)
client.skills.create(input)
client.skills.edit(skillId, input)
client.skills.archive(skillId)
client.skills.unarchive(skillId)
client.skills.revisions.query(input)
client.skills.revisions.retrieve(input)
client.skills.revisions.commit(input)
client.skills.referencedBy(skillId)

client.skills.catalog.providers()
client.skills.catalog.query(input)
client.skills.catalog.retrieve(input)
client.skills.import(input)
client.skills.updates.check(skillId)
client.skills.updates.apply(skillId, input)
```

The frontend must not:

- Parse GitHub URLs beyond collecting user input.
- Construct GitHub tarball URLs.
- Join skills with separate source records.
- Branch on GitHub-specific response types.
- Decide from a flag whether an update request writes.
- Use a display name as a workflow slug.
- Bypass the Skills service for normal skill writes.

Keep the user flow simple:

1. Browse a provider or paste a GitHub URL.
2. Preview detected skills and validation issues.
3. Select candidates and import them.
4. Open the created project skill.
5. See origin and update state from normalized fields.
6. Check for an update without changing the skill.
7. Apply the update explicitly, with conflict feedback if the skill changed meanwhile.

Regenerate the Fern client and update the frontend package after the backend contract is final. Resolve the existing generated-client merge conflicts against the target branch. Do not hand-maintain duplicate transport types when the generated client can provide them. Boundary validation may remain where the repository intentionally uses Zod as a runtime drift check.

### Step 8: preserve existing catalogs without conflating them

Do not merge the new remote artifact catalog with the workflow template catalog. Workflow templates and presets are blueprints for creating workflow configurations. Remote artifact catalog items are discoverable, versioned content with provider identity and a fetch lifecycle.

Reuse the static workflow catalog for Agenta-shipped read-only skills. It can later act as the Agenta provider or feed one, but V1 does not need to redesign it.

Keep the current sales-oriented agent template gallery unchanged. It is currently frontend-authored content and is outside this backend refactor.

Design the normalized catalog item so a future Agenta provider can offer skills and prompts without changing the import lifecycle.

### Step 9: harden fetching and validation

Retain all existing skill path protections and add bounded archive handling before extraction:

- Maximum response body or streamed download size.
- Network timeout and redirect policy.
- Maximum archive member count.
- Maximum compressed archive size.
- Maximum per-file uncompressed size.
- Maximum aggregate uncompressed size.
- Rejection of absolute paths, `..`, backslash escapes, links, device files, and any member outside the temporary root.
- Validation before writing files where practical.

Return typed validation issues per candidate. Never execute imported files during discovery or import.

### Required tests

Add meaningful tests at service and route boundaries. Cover at least:

1. Skills route parity for create, get, edit, query, archive, unarchive, revision retrieve, revision query, commit, and log.
2. Correct skill URI, inferred flags, payload validation, and static-skill read-only behavior.
3. Expected base revision conflict handling and no lost update.
4. Atomic synchronization of artifact name and description with skill content.
5. Preservation and protection of `meta._ag` through skill and generic workflow writes.
6. Import writes artifact origin and immutable revision provenance atomically.
7. A fake second catalog provider can be registered and used without changing catalog or import services.
8. Catalog query and retrieve perform no database writes.
9. Update check performs no writes and reports every documented status.
10. Update apply creates exactly one revision and advances the checkpoint only after success.
11. Failed or conflicting update apply leaves the checkpoint unchanged.
12. A local edit produces the documented detached result.
13. The same GitHub repository at two refs produces distinct provider identities or locators.
14. Multi-skill import returns accurate per-candidate results and never leaves a successful workflow without provenance.
15. Detailed `referenced-by` results distinguish latest and pinned references.
16. Aggregate `referenced_by_count` is correct when requested and can be omitted when not requested.
17. Duplicate skill attachment and malformed pinned references follow the chosen explicit policy.
18. Archive size, member count, path traversal, link, and decompression-limit failures.
19. Frontend skill actions call Skills endpoints rather than generic Workflow endpoints.
20. Frontend discovery and update flows use normalized provider-neutral models.

### Validation commands and evidence

Run the repository-required formatting, linting, type checks, and relevant unit tests for the API, SDK generation, skills package, and skills UI. At minimum:

- Run `ruff format` and `ruff check` in the API scope according to `api/AGENTS.md`.
- Run focused backend tests for workflows, skills, embeds, catalog providers, import, and update behavior.
- Regenerate the API client and prove the generated tree is clean.
- Run frontend type checking and focused unit tests for the skills API and UI.
- Run `git diff --check`.
- Exercise one complete frontend flow against a local backend: preview a public GitHub repository, import one skill, open it, edit it, inspect incoming references, check for an upstream update, and apply an update.

Report the exact commands and results. If an environment prevents a check, state the missing dependency or service and do not claim it passed.

### Acceptance criteria

The work is complete when all of the following are true:

- Every frontend skill lifecycle operation uses `/skills`.
- The Skills API follows the established workflow-backed domain naming for its supported operations.
- `usage` is replaced by a directional incoming-reference contract.
- Aggregate counts and one-skill reference details are separate operations.
- Discovery, preview, import, update check, and update apply have distinct behavior and names.
- GitHub is implemented as a provider adapter behind normalized catalog interfaces.
- Adding a fake provider requires adapter implementation and registration only.
- No new skill source or link table remains in the migration chain.
- Imported origin and revision provenance live in protected `meta._ag` metadata.
- Import and update operations cannot report success or advance metadata after a failed workflow write.
- Skill commits use optimistic concurrency and synchronize artifact headers.
- The frontend and generated public client expose simple provider-neutral skill operations.
- Security bounds and the required tests pass.
- Existing workflow, evaluator, tool catalog, trigger catalog, and static-skill behavior remains compatible.

### Final implementation report

When finished, provide:

1. The final API route table.
2. The final metadata schemas for artifact origin and revision provenance.
3. The provider interface and registered V1 providers.
4. The list of removed migration and source-persistence files.
5. The frontend calls that moved from Workflows to Skills.
6. The tests and validation commands with results.
7. Any deliberate deviation from this prompt and the repository evidence that required it.

## Decision appendix

### Decision 1: keep skills on workflows

**Observation:** The skill URI, inferred `is_skill` flag, workflow identity, revision history, archive state, and embed references already exist in the workflow model.

**Decision:** Keep workflow persistence as the canonical skill model.

**Reasoning:** This preserves one versioning and reference system. A separate skill table would duplicate mature workflow behavior and create synchronization problems.

### Decision 2: expose a complete Skills facade

**Observation:** Evaluators are workflow-backed and expose a complete domain API. Prompts use workflows directly and do not claim a separate backend facade. The PR exposes only some skill operations through `/skills`.

**Decision:** Make `/skills` own every supported skill lifecycle operation used by the frontend.

**Reasoning:** This follows an existing repository pattern and creates one place to enforce skill validation, metadata protection, concurrency, and artifact synchronization. It also gives a public SDK one coherent domain.

### Decision 3: use `referenced-by`

**Observation:** The endpoint accepts one skill and finds agent revisions containing references to it. The registry separately calculates counts across all skills. Agenta already uses `usage` for billing.

**Decision:** Use `referenced-by` for the one-skill relationship and `referenced_by_count` for an optional aggregate field.

**Reasoning:** The name states the direction of the relationship and avoids implying runtime or billing measurements. Separating scales also allows each query to evolve independently.

### Decision 4: use a catalog abstraction

**Observation:** GitHub, an Agenta registry, skills marketplaces, personal catalogs, and direct repositories expose different discovery mechanisms but can all return normalized artifact summaries and bundles.

**Decision:** Put discovery behind a provider-neutral artifact catalog with `search`, `inspect`, and `fetch` capabilities.

**Reasoning:** One normalized boundary keeps provider rules out of SkillsService and the frontend. A new marketplace becomes a new adapter plus registration. Hermes demonstrates this separation, and Agenta's tool and trigger catalogs already use the same adapter-registry pattern.

### Decision 5: expose catalog routes within the Skills domain

**Observation:** Agenta's tools and triggers share an internal catalog service but expose domain-scoped catalog routes. Their frontends do not call a generic infrastructure API directly.

**Decision:** Use `/skills/catalog/*` publicly while keeping the artifact catalog service reusable internally.

**Reasoning:** This matches repository conventions, keeps skill permissions and response types clear, and leaves room for a future `/prompts/catalog/*` facade over the same provider registry.

### Decision 6: separate discovery, import, check, and apply

**Observation:** The PR's `sources` and `refresh` names hide whether a request reads or writes. Refresh behavior changes according to flags.

**Decision:** Use explicit catalog query/retrieve, skill import, update check, and update apply operations.

**Reasoning:** Each operation has one effect. This makes frontend feedback, permissions, retries, audit logs, and public API documentation easier to reason about.

### Decision 7: keep GitHub as an adapter

**Observation:** GitHub is the only required V1 transport, but the product direction includes other marketplaces and an Agenta catalog.

**Decision:** Implement only GitHub now, behind the general provider interface.

**Reasoning:** This avoids speculative marketplace implementation while testing the extension point with a real provider. A fake second provider test proves that the boundary works.

### Decision 8: remove the source migration

**Observation:** The new tables currently store provenance and mutable update flags. They do not own credentials, schedules, webhooks, permissions, or history.

**Decision:** Remove the tables in V1 and store origin and provenance in workflow metadata.

**Reasoning:** The data belongs to the skill lifecycle today. Co-locating it prevents orphan links and cross-table drift. A separate database resource can be added when it has an independent lifecycle.

### Decision 9: reserve `meta._ag`

**Observation:** The repository has a reserved `__ag__` slug prefix for static workflows but no documented protected metadata namespace. Imported provenance must survive ordinary client edits.

**Decision:** Introduce `meta._ag` as backend-owned metadata, with artifact origin and immutable revision provenance.

**Reasoning:** A reserved namespace allows platform features to attach stable internal information without blocking user metadata. Backend merge rules prevent clients from erasing update identity accidentally.

### Decision 10: derive detachment and missing state

**Observation:** `detached` and `missing_in_source` in the proposed link table can become stale. Detachment follows from the current head revision and its last imported checkpoint. Missing state follows from a provider check at a point in time.

**Decision:** Derive detachment and return missing state from update checks in V1.

**Reasoning:** Derived state avoids multiple mutable truths. Persist these values later only if a scheduler or reporting requirement needs historical observations.

### Decision 11: keep existing catalog concepts distinct

**Observation:** Workflow templates are creation blueprints, static workflows are shipped read-only resources, tool catalogs are provider-backed discovery systems, and the sales-oriented agent template gallery is frontend-authored content.

**Decision:** Add a reusable remote artifact catalog boundary without merging these existing concepts.

**Reasoning:** They have different identities and lifecycles. Reusing the provider pattern gives consistency without forcing incompatible data into one model.

### Decision 12: optimize references only through a general index

**Observation:** Current reference counts and details scan agent heads. A skill-specific table could improve speed but would duplicate the general workflow embed relationship.

**Decision:** Keep the simple scan for V1, make aggregate counts optional, and introduce a general workflow-reference index only when measurements justify it.

**Reasoning:** This avoids another premature schema while preserving a path to scale for skills and other embedded workflows.

### Decision 13: require optimistic concurrency and atomic updates

**Observation:** Skill edits and upstream updates can race. Content, artifact headers, and provenance can otherwise disagree after partial failure.

**Decision:** Require an expected base revision and update all related skill state atomically.

**Reasoning:** This uses the workflow revision model as intended and prevents silent lost updates or false synchronization status.

### Decision 14: keep the frontend provider-neutral

**Observation:** The current frontend calls both Skills and Workflows and uses repository-specific source operations.

**Decision:** Give it one Skills client and normalized catalog types.

**Reasoning:** The UI can present browse, preview, import, references, and update flows without knowing storage joins or provider transport. This is also the simplest public interface.

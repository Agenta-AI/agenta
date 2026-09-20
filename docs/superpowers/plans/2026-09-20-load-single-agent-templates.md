# Single-Agent Template Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prompt-only starter templates with a backend-owned loader that resolves one internal Agent Plugin package, creates one ordinary Agenta agent and its declared resources, and returns only after the first message has a durable session execution.

**Architecture:** A FastAPI route authorizes the caller, then calls one core orchestration service. Pure source, parser, binding, compiler, and message components prepare a complete load plan before any write. Existing workflow, skill, mount, connection, MCP gateway, and session services own persistence. Project-scoped idempotency uses deterministic resource identities, protected `meta._ag` fingerprints, a short distributed lock, and a deterministic session execution id. It does not add an installation table or conversational setup state.

**Tech Stack:** Python 3.12, FastAPI, Pydantic 2, JSON Schema, SQLAlchemy/PostgreSQL, Redis locks, MinIO-compatible object storage, React, TypeScript, Jotai, Vitest, pytest, and Playwright.

**Spec:** `openspec/changes/load-single-agent-templates/design.md`

## Global constraints

- Implement against current `main`, not the older code snapshot on PR #6944. Current MCP gateway contracts from v0.119 or later are required.
- Version one accepts `{"kind":"internal","key":"<catalog-key>"}` only.
- Version one accepts exactly one agent. Reject multiple `agents` entries and every `subagents` field before a write.
- Existing agents need no conversion or migration.
- Keep the current cards, setup controls, connection-card placement, Continue/Create semantics, navigation, and free-text creation.
- Use the same base `WorkflowRevisionData` produced by ordinary agent creation. A package cannot select or replace `llm`, `harness`, `runner`, or `sandbox`.
- Store permanent agent instructions in the native agent configuration. Create declared skills through `SkillsService`. Copy only declared workspace entries through `MountsService`.
- Bind only active, valid connections and MCP endpoints that belong to the authenticated project. Never place credential values in package data, metadata, logs, traces, or the first message.
- Do not create a schedule or subscription while loading. Automation declarations remain first-message guidance.
- Do not execute package hooks or copy undeclared files.
- Loading succeeds only after the first message has a fingerprinted `session_inputs` claim and a durable `session_executions` row. It does not wait for the model to finish.
- Do not add an installation resource, setup status, readiness gate, hidden prompt, template-specific tool, or new database table.
- Multi-agent loading remains separately specified and **NOT IMPLEMENTED**.
- Use short, direct user-facing error text. Do not use em dashes.

## Review focus

1. **A package changes while a failed request is retried.** Task 1 pins retries to the version and digest already stored on the deterministic workflow, so a retry cannot silently load newer content.
2. **Two tabs load the same request, or the first response is lost.** Tasks 4, 6, and 7 use one request fingerprint, a fingerprinted session-input claim, deterministic resource ids, locks, and a deterministic execution id. Tests must prove one agent, one copy of each skill, one accepted input, and one first turn.
3. **A selected connection becomes invalid before the write.** Task 3 re-reads project connections in the backend. It omits the stale binding and puts the need in the first message without exposing connection data.
4. **A workspace copy fails after the user edits a copied file.** Task 5 retries only absent destinations. It must not overwrite an existing file or delete an existing directory.
5. **The frontend card catalog and backend source catalog drift.** Task 9 adds a repository parity test that compares every card source key with the backend internal catalog.

---

## Service boundaries

### Files and responsibilities

| Area                         | Files                                                                                                                   | Responsibility                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Source contract              | `api/oss/src/core/agent_templates/dtos.py`, `interfaces.py`, `sources.py`                                               | Resolve a typed internal key to a bounded, pinned package snapshot.                                                                      |
| Package contract             | `api/oss/src/core/agent_templates/models.py`, `parser.py`                                                               | Validate Agent Plugin files, safe paths, one-agent scope, skills, workspace entries, MCP declarations, and automation recipes.           |
| Binding and compilation      | `api/oss/src/core/agent_templates/bindings.py`, `compiler.py`, `message.py`, `provenance.py`                            | Resolve project-owned connections, build native agent configuration, compose the first message, and build trusted provenance. No writes. |
| Orchestration                | `api/oss/src/core/agent_templates/service.py`                                                                           | Run preflight, create resources through owning services, copy files, and start the first turn in dependency order.                       |
| Generic workflow idempotency | `api/oss/src/core/shared/idempotency.py`, `api/oss/src/core/workflows/service.py`, `api/oss/src/core/skills/service.py` | Create or resume deterministic workflows and skill workflows under a short project-scoped lock.                                          |
| Workspace materialization    | `api/oss/src/core/mounts/service.py`                                                                                    | Create declared directories and write declared files only when absent.                                                                   |
| Durable first turn           | `api/oss/src/core/sessions/inputs/`, `api/oss/src/core/sessions/starts/`                                                | Claim one fingerprinted input, start one detached workflow execution, then confirm the durable execution row.                            |
| HTTP transport               | `api/oss/src/apis/fastapi/agent_templates/`                                                                             | Validate transport models, check both permissions, map domain errors, and return ids.                                                    |
| Composition root             | `api/entrypoints/routers.py`                                                                                            | Instantiate concrete adapters and inject existing services into the loader.                                                              |
| Frontend transport           | `web/packages/agenta-entities/src/workflow/api/agentTemplates.ts`, `state/loadTemplate.ts`                              | Send the source, ordinary base revision data, initial message, and connection choices under one idempotency key.                         |
| Host behavior                | Existing web and `/m` creation hooks                                                                                    | Keep the current interface, replace only the template load action, and navigate to the returned session.                                 |

### Core contracts

Create these exact domain contracts in Task 1 and keep later tasks consistent with them:

```python
# api/oss/src/core/agent_templates/dtos.py
from pathlib import Path
from typing import Annotated, List, Literal, Optional, Union
from uuid import UUID
from pydantic import BaseModel, Field
from oss.src.core.workflows.dtos import WorkflowRevisionData


class InternalTemplateSource(BaseModel):
    kind: Literal["internal"] = "internal"
    key: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class TemplateSourcePin(BaseModel):
    version: str
    digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class ResolvedTemplateSource(BaseModel):
    source: InternalTemplateSource
    root: Path
    version: str
    digest: str
    model_config = {"arbitrary_types_allowed": True}


class GatewayTemplateChoice(BaseModel):
    connection_key: str
    kind: Literal["gateway"]
    provider: str
    integration: str


class MCPTemplateChoice(BaseModel):
    connection_key: str
    kind: Literal["mcp"]
    server: str


class SkipTemplateChoice(BaseModel):
    connection_key: str
    kind: Literal["skip"]


TemplateConnectionChoice = Annotated[
    Union[GatewayTemplateChoice, MCPTemplateChoice, SkipTemplateChoice],
    Field(discriminator="kind"),
]


class TemplateLoadCommand(BaseModel):
    source: InternalTemplateSource
    base_revision: WorkflowRevisionData
    initial_message: str
    connection_choices: List[TemplateConnectionChoice] = Field(default_factory=list)
    request_key: str


class TemplateLoadResult(BaseModel):
    workflow_id: UUID
    workflow_slug: str
    variant_id: UUID
    revision_id: UUID
    session_id: str
    execution_id: str
    input_id: UUID
    replayed: bool
```

```python
# api/oss/src/core/agent_templates/interfaces.py
from typing import Optional, Protocol
from .dtos import InternalTemplateSource, ResolvedTemplateSource, TemplateSourcePin


class TemplateSourceResolver(Protocol):
    async def resolve(
        self,
        *,
        source: InternalTemplateSource,
        pin: Optional[TemplateSourcePin] = None,
    ) -> ResolvedTemplateSource: ...
```

```python
# api/oss/src/core/sessions/starts/dtos.py
from uuid import UUID
from pydantic import BaseModel


class SessionStartResult(BaseModel):
    session_id: str
    execution_id: str
    input_id: UUID
    replayed: bool
```

The public request does not accept a filesystem path, repository URL, archive, workflow id, session id, execution id, source version, source digest, resolved connection slug, MCP endpoint slug, or trusted metadata. The server derives those values.

## HTTP contract

Add one operation:

```http
POST /api/agent-templates/load?project_id=<uuid>
Idempotency-Key: <opaque client request id>
Content-Type: application/json
```

```json
{
  "source": { "kind": "internal", "key": "outreach-drafter" },
  "base_revision": {
    "uri": "agenta:workflow:agent:v0",
    "parameters": {
      "agent": {
        "llm": { "model": "claude-sonnet-4-5" },
        "harness": { "kind": "pi_core" },
        "runner": { "kind": "sidecar" },
        "sandbox": { "kind": "local" }
      }
    }
  },
  "initial_message": "Build an outreach drafter that prepares drafts for review.",
  "connection_choices": [
    {
      "connection_key": "mailbox",
      "kind": "gateway",
      "provider": "composio",
      "integration": "gmail"
    }
  ]
}
```

Successful first execution returns HTTP 201. A replay returns HTTP 200 with the same identifiers:

```json
{
  "workflow_id": "6cf998bb-dbe0-5a15-8a1f-866d14884c09",
  "workflow_slug": "outreach-drafter-6cf998bb",
  "variant_id": "3b10c932-839f-4f4f-aef8-6792ccbb965c",
  "revision_id": "9ce2b439-344a-4ec6-96f8-1c480451dadd",
  "session_id": "ca25b4a5-f8e1-55f8-9802-cea9775843f7",
  "execution_id": "7f1bfbbd-ec7c-536f-b1b5-70410d3f5034",
  "input_id": "45816ee7-73bb-47d0-a0ea-5ee6ba68a936",
  "replayed": false
}
```

Return these failures:

| Status | Code                           | Condition                                                                              |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------- |
| 400    | `idempotency_key_required`     | Missing or blank `Idempotency-Key`.                                                    |
| 403    | existing forbidden response    | Caller lacks `EDIT_WORKFLOWS` or `RUN_SESSIONS`. Check this before source resolution.  |
| 404    | `template_source_not_found`    | Internal key or pinned internal version does not exist.                                |
| 409    | `template_load_conflict`       | The same project and request key has a different normalized request fingerprint.       |
| 422    | `template_package_invalid`     | Manifest, path, one-agent, skill, MCP transport, or native agent validation fails.     |
| 503    | `template_handoff_not_durable` | Detached start did not produce a durable execution row. The same key is safe to retry. |

## Data flow

1. The host creates or reads the same local ephemeral agent used by ordinary creation.
2. The host opens the existing setup controls. It maps each connection slot to one declared package option or `skip`.
3. The host sends the source reference, ordinary base revision data, existing initial message, choices, and one idempotency key.
4. The router checks `EDIT_WORKFLOWS` and `RUN_SESSIONS`. It does not read a package or project connection before both checks pass.
5. The loader computes a normalized request fingerprint. It looks for the deterministic workflow id. If a prior request exists, it checks the fingerprint and reads the stored source pin.
6. The source resolver maps the internal key and optional pin to a bounded package root, version, and digest.
7. The parser validates all package files and produces one immutable `ParsedTemplatePackage`.
8. The binding resolver re-reads project connections and MCP endpoints. It returns native config entries for valid matches and plain unresolved descriptions for the first message.
9. The skills service derives deterministic skill ids and slugs without writing. The compiler uses those planned references, combines the package with the supplied ordinary base revision, preserves `llm`, `harness`, `runner`, and `sandbox`, and validates the final SDK `AgentTemplate`.
10. After every preflight passes, the loader creates or resumes the agent workflow with the planned skill embeds and trusted template provenance. This durable root claim pins retries. It then creates or resumes each declared skill workflow before handoff.
11. The mount service creates missing directories and writes missing files. It preserves every existing path.
12. The session input service atomically claims the full invocation payload under a stable key and fingerprint. The session start service derives one session id and execution id from the project and request key, binds the claimed input to that execution, invokes the exact created revision in detached mode, and confirms the execution row.
13. The API returns the resource and session identifiers. The host navigates to that session and does not send a second seed.

## Provenance shape

Use protected platform metadata. Do not reuse the skill import discriminator.

```json
{
  "_ag": {
    "create_request": {
      "namespace": "agent-template-load",
      "key_hash": "sha256:...",
      "request_fingerprint": "sha256:..."
    },
    "template_origin": {
      "kind": "internal",
      "key": "outreach-drafter",
      "version": "1.0.0",
      "digest": "sha256:..."
    }
  }
}
```

Write this metadata through `platform_meta=True` on the agent artifact and initial revision. A normal artifact edit preserves `_ag`. A later normal revision does not inherit initial revision provenance. This matches `core/git/platform_meta.py` and prevents clients from forging source facts.

---

### Task 1: Resolve pinned internal template sources

**Files:**

- Create: `api/oss/src/core/agent_templates/__init__.py`
- Create: `api/oss/src/core/agent_templates/dtos.py`
- Create: `api/oss/src/core/agent_templates/interfaces.py`
- Create: `api/oss/src/core/agent_templates/exceptions.py`
- Create: `api/oss/src/core/agent_templates/sources.py`
- Create: `api/oss/src/resources/agent_templates/catalog.json`
- Create: `api/oss/src/resources/agent_templates/packages/outbound-prospecting/1.0.0/` from `docs/design/agent-workflows/projects/agent-plugin-templates/example/`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_sources.py`

**Interfaces:**

- Consumes: A typed `InternalTemplateSource` and optional `TemplateSourcePin`.
- Produces: `TemplateSourceResolver.resolve(...) -> ResolvedTemplateSource` and `package_digest(root: Path) -> str`.

- [ ] **Step 1: Write failing source-resolution tests**

```python
@pytest.mark.asyncio
async def test_internal_source_resolves_latest_and_can_reopen_pin(tmp_path):
    resolver = InternalTemplateSourceResolver(catalog_path=CATALOG)
    latest = await resolver.resolve(
        source=InternalTemplateSource(key="outbound-prospecting")
    )
    pinned = await resolver.resolve(
        source=latest.source,
        pin=TemplateSourcePin(version=latest.version, digest=latest.digest),
    )
    assert pinned.version == "1.0.0"
    assert pinned.digest == latest.digest
    assert pinned.root == latest.root


@pytest.mark.asyncio
async def test_unknown_key_fails_without_reading_an_arbitrary_path():
    resolver = InternalTemplateSourceResolver(catalog_path=CATALOG)
    with pytest.raises(TemplateSourceNotFound):
        await resolver.resolve(source=InternalTemplateSource(key="../../etc"))


@pytest.mark.asyncio
async def test_changed_bytes_fail_a_stored_pin(tmp_path):
    resolver = fixture_resolver(tmp_path)
    first = await resolver.resolve(source=InternalTemplateSource(key="sample"))
    (first.root / "plugin.json").write_text("{}", encoding="utf-8")
    with pytest.raises(TemplateSourceDigestMismatch):
        await resolver.resolve(
            source=first.source,
            pin=TemplateSourcePin(version=first.version, digest=first.digest),
        )
```

- [ ] **Step 2: Run the tests and confirm the missing contract**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_sources.py -q
```

Expected: collection fails because `oss.src.core.agent_templates` does not exist.

- [ ] **Step 3: Implement typed catalog resolution and canonical digesting**

Use a checked-in catalog with explicit versions:

```json
{
  "outbound-prospecting": {
    "latest": "1.0.0",
    "versions": { "1.0.0": "packages/outbound-prospecting/1.0.0" }
  }
}
```

Implement `package_digest` over sorted relative POSIX paths. Hash `path + NUL + bytes + NUL` for each regular file. Reject symlinks. Apply these fixed limits while walking: 256 files, 4 MiB total bytes, 1 MiB per file, and 12 path segments. Return `sha256:<hex>`.

```python
class InternalTemplateSourceResolver:
    def __init__(self, *, catalog_path: Path) -> None:
        self._catalog_path = catalog_path

    async def resolve(self, *, source, pin=None) -> ResolvedTemplateSource:
        catalog = json.loads(self._catalog_path.read_text(encoding="utf-8"))
        record = catalog.get(source.key)
        if not isinstance(record, dict):
            raise TemplateSourceNotFound(source.key)
        version = pin.version if pin else record["latest"]
        relative = record.get("versions", {}).get(version)
        if not isinstance(relative, str):
            raise TemplateSourceNotFound(f"{source.key}@{version}")
        root = confined_child(self._catalog_path.parent, relative)
        digest = package_digest(root)
        if pin and digest != pin.digest:
            raise TemplateSourceDigestMismatch(source.key, version)
        return ResolvedTemplateSource(
            source=source, root=root, version=version, digest=digest
        )
```

Do not accept an absolute path or a path from the request. Keep old version directories in the catalog so an interrupted request can resume its original snapshot.

- [ ] **Step 4: Run source tests**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_sources.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the source boundary**

```bash
git add api/oss/src/core/agent_templates api/oss/src/resources/agent_templates api/oss/tests/pytest/unit/agent_templates/test_sources.py
git commit -m "feat(api): resolve pinned internal agent templates"
```

---

### Task 2: Parse and validate one Agent Plugin package

**Files:**

- Create: `api/oss/src/core/agent_templates/models.py`
- Create: `api/oss/src/core/agent_templates/parser.py`
- Create: `api/oss/src/resources/agent_templates/schemas/plugin.schema.json`
- Create: `api/oss/src/resources/agent_templates/schemas/mcp.schema.json`
- Copy: `docs/design/agent-workflows/projects/agent-plugin-templates/extension.schema.json` to `api/oss/src/resources/agent_templates/schemas/ai.agenta-agents.schema.json`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_parser.py`
- Test fixtures: `api/oss/tests/pytest/unit/agent_templates/fixtures/`

**Interfaces:**

- Consumes: `ResolvedTemplateSource` from Task 1.
- Produces: `TemplatePackageParser.parse(resolved) -> ParsedTemplatePackage` with `agent`, validated skill payloads, workspace entries, MCP declarations, and automation recipes.

- [ ] **Step 1: Write failing parser tests**

```python
def test_parser_returns_one_agent_and_declared_resources():
    package = parser.parse(resolved_example())
    assert package.agent.key == "outbound"
    assert package.agent.name == "Outbound Prospecting"
    assert package.agent.instructions.startswith("# ")
    assert package.skills[0].name == "prospect-research"
    assert package.workspace.files[0].destination == "target-profile.md"
    assert package.workspace.directories == ["reports"]


@pytest.mark.parametrize(
    "fixture_name,code",
    [
        ("two-agents", "single_agent_required"),
        ("subagents", "subagents_not_supported"),
        ("path-traversal", "unsafe_package_path"),
        ("workspace-agents-md", "reserved_workspace_path"),
        ("stdio-mcp", "unsupported_mcp_transport"),
        ("missing-skill", "missing_skill"),
    ],
)
def test_invalid_package_fails_before_writes(fixture_name, code):
    with pytest.raises(TemplatePackageInvalid) as error:
        parser.parse(resolved_fixture(fixture_name))
    assert error.value.code == code
```

Also test empty optional arrays, absent `SETUP.md`, UTF-8 errors, a symlinked source, duplicate destination paths, and an `entry` that does not name the sole agent.

- [ ] **Step 2: Run the parser tests and confirm failure**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_parser.py -q
```

Expected: collection fails because `TemplatePackageParser` is missing.

- [ ] **Step 3: Add strict package models**

Use Pydantic models with `extra="forbid"` for Agenta extension fields. Keep `plugin.json` and `mcp.json` validation against local copies of the Agent Plugins 1.0 schemas. Do not fetch schemas over the network at runtime.

```python
class ParsedTemplatePackage(BaseModel):
    source: InternalTemplateSource
    version: str
    digest: str
    agent: ParsedTemplateAgent
    skills: list[SkillTemplate] = Field(default_factory=list)
    workspace: ParsedWorkspace = Field(default_factory=ParsedWorkspace)
    mcp_servers: dict[str, ParsedMCPServer] = Field(default_factory=dict)


class ParsedTemplateAgent(BaseModel):
    key: str
    name: str
    description: str
    instructions: str
    setup: str | None = None
    connections: list[TemplateConnectionRequirement] = Field(default_factory=list)
    automations: list[TemplateAutomationRecipe] = Field(default_factory=list)
```

Read skills with the existing SDK `SkillTemplate` parser. Keep file bytes on `ParsedWorkspaceFile`; do not write them in this task.

- [ ] **Step 4: Enforce path and execution safety**

Resolve every package source path under `resolved.root`. Resolve every workspace destination as a relative POSIX path. Reject backslashes, absolute paths, `.` or `..` segments, NUL, symlinks, duplicate destinations, and executable files. Reserve these destination names because the harness or deployment may load them automatically: `AGENTS.md`, `CLAUDE.md`, `.env`, `.agenta/`, `.agents/`, `.claude/`, `.pi/`, and `.github/`.

Accept MCP transport `streamable-http` only. Reject `stdio` and legacy separate `sse`. A URL in `mcp.json` is a declaration to match against an existing endpoint. It is not permission to create or call that URL.

- [ ] **Step 5: Run parser and schema tests**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_parser.py -q
```

Expected: parser tests pass, including the current, future, minimal, and negative schema fixtures copied into the test fixture directory.

- [ ] **Step 6: Commit package parsing**

```bash
git add api/oss/src/core/agent_templates api/oss/src/resources/agent_templates/schemas api/oss/tests/pytest/unit/agent_templates
git commit -m "feat(api): validate single-agent template packages"
```

---

### Task 3: Resolve bindings, compile native configuration, and compose the first message

**Files:**

- Create: `api/oss/src/core/agent_templates/bindings.py`
- Create: `api/oss/src/core/agent_templates/compiler.py`
- Create: `api/oss/src/core/agent_templates/message.py`
- Create: `api/oss/src/core/agent_templates/provenance.py`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_bindings.py`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_compiler.py`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_message.py`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_provenance.py`

**Interfaces:**

- Consumes: `ParsedTemplatePackage`, `WorkflowRevisionData`, planned skill references, request choices, `ConnectionsService`, and `MCPGatewayService`.
- Produces: `TemplateBindingPlan`, `CompiledTemplate`, `compose_first_message(...)`, and protected metadata dictionaries.

- [ ] **Step 1: Write failing binding tests**

```python
@pytest.mark.asyncio
async def test_gateway_choice_binds_only_active_valid_project_connection():
    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=package_with_gateway("mailbox", "composio", "gmail"),
        choices=[gateway_choice("mailbox", "composio", "gmail")],
    )
    assert plan.tools == [
        {
            "type": "gateway_connection",
            "connection": {
                "provider": "composio",
                "integration": "gmail",
                "slug": "gmail-primary",
            },
        }
    ]
    assert plan.unresolved == []


@pytest.mark.asyncio
async def test_connection_invalidated_after_ui_selection_becomes_unresolved():
    connections.query_connections.return_value = [invalid_connection("gmail")]
    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=package_with_gateway("mailbox", "composio", "gmail"),
        choices=[gateway_choice("mailbox", "composio", "gmail")],
    )
    assert plan.tools == []
    assert plan.unresolved[0].connection_key == "mailbox"
    assert "token" not in plan.model_dump_json().lower()


@pytest.mark.asyncio
async def test_mcp_choice_matches_existing_project_endpoint_by_declared_url():
    mcps.query_endpoints.return_value = [custom_endpoint("mail", MAIL_URL)]
    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=package_with_mcp("mailbox", "mail-drafts", MAIL_URL),
        choices=[mcp_choice("mailbox", "mail-drafts")],
    )
    assert plan.mcps == [
        {
            "name": "mail",
            "connection": {"type": "gateway", "namespace": "custom", "slug": "mail"},
        }
    ]
```

Test that a request choice must equal one option declared for that connection key. Reject a foreign option rather than silently substituting it. Add the current GitHub/GitLab alternative case and prove a selected valid GitLab connection stays GitLab even when GitHub is also valid. Test builtin, standard, and custom MCP endpoint mapping. Missing matches become unresolved descriptions.

- [ ] **Step 2: Write failing compiler and message tests**

```python
def test_compiler_preserves_ordinary_execution_settings():
    compiled = compiler.compile(
        package=parsed_package(),
        base_revision=ordinary_base_revision(),
        bindings=binding_plan(),
        installed_skills=[installed_skill("prospect-research")],
    )
    agent = compiled.revision_data.parameters["agent"]
    assert agent["llm"] == ordinary_base_revision().parameters["agent"]["llm"]
    assert agent["harness"] == ordinary_base_revision().parameters["agent"]["harness"]
    assert agent["runner"] == ordinary_base_revision().parameters["agent"]["runner"]
    assert agent["sandbox"] == ordinary_base_revision().parameters["agent"]["sandbox"]
    assert agent["instructions"]["agents_md"] == parsed_package().agent.instructions


def test_message_labels_package_text_and_keeps_recipe_inactive():
    text = compose_first_message(
        initial_message=(
            "Build the outreach drafter.\n\n"
            "I've connected Gmail. Ask me before you write or send anything."
        ),
        package=parsed_package(),
        bindings=unresolved_binding_plan(),
        choices=[skip_choice("mailbox")],
    )
    assert text.startswith(
        "Build the outreach drafter.\n\n"
        "I've connected Gmail. Ask me before you write or send anything."
    )
    assert "Template-supplied setup guidance:" in text
    assert "Remaining connection setup:" in text
    assert "Automation recipe to discuss, not activate:" in text
    assert "0 9 * * 1-5" in text
```

Treat `initial_message` as the complete current host message, including the existing `appendSetupPreamble` output. Preserve it byte-for-byte after trimming its outer whitespace. Do not add a second connected-provider or ask-first paragraph. Append only labeled package setup, explicit skipped/unresolved needs, and inactive recipes. Also assert that an empty `initial_message` still produces a valid message when `SETUP.md` or unresolved work exists. For the minimal package with no setup, recipe, or unresolved connection, assert that the output equals the trimmed initial message and invents no requirement. Reject a load with no message content at all because there would be no handoff. Add a parser/compiler test that a package-level `llm` or generic configuration override is rejected.

- [ ] **Step 3: Implement backend binding resolution**

`TemplateBindingResolver` calls `ConnectionsService.query_connections` and `MCPGatewayService.query_endpoints`. It passes `project_id` on every read. It checks `is_active` and `is_valid` immediately before compilation. It selects by exact provider/integration for gateway connections and exact namespace/provider/integration/URL identity for MCP declarations.

Never pass `Connection.data`, secret ids, headers, OAuth metadata, or endpoint secret handles to the message composer or provenance builder.

- [ ] **Step 4: Implement a pure native compiler**

Define these outputs:

```python
class UnresolvedTemplateBinding(BaseModel):
    connection_key: str
    purpose: str
    selected_option: dict | None = None


class TemplateBindingPlan(BaseModel):
    tools: list[dict] = Field(default_factory=list)
    mcps: list[dict] = Field(default_factory=list)
    unresolved: list[UnresolvedTemplateBinding] = Field(default_factory=list)


class InstalledSkillRef(BaseModel):
    name: str
    workflow_id: UUID
    workflow_slug: str


class CompiledTemplate(BaseModel):
    workflow_name: str
    workflow_description: str
    revision_data: WorkflowRevisionData
    workspace: ParsedWorkspace
    first_message: str
```

Create each skill embed with the current resolver contract:

```python
def skill_embed(skill: InstalledSkillRef) -> dict:
    return {
        "name": skill.name,
        "@ag.embed": {
            "@ag.references": {
                "workflow": {"id": str(skill.workflow_id), "slug": skill.workflow_slug}
            },
            "@ag.selector": {"path": "parameters.skill"},
        },
    }
```

Deep-copy the base revision. Replace only package-owned fields: workflow name/description outside revision data, `parameters.agent.instructions.agents_md`, `parameters.agent.skills`, `parameters.agent.tools`, and `parameters.agent.mcps`. Append to existing skill/tool/MCP lists after deduplicating by stable identity. Preserve all other agent fields. Validate the final `parameters.agent` with `agenta.sdk.agents.AgentTemplate`. Return a package error if native validation fails.

- [ ] **Step 5: Implement provenance helpers**

```python
def template_origin_meta(resolved: ResolvedTemplateSource) -> dict:
    return {
        "_ag": {
            "template_origin": {
                "kind": resolved.source.kind,
                "key": resolved.source.key,
                "version": resolved.version,
                "digest": resolved.digest,
            }
        }
    }
```

Add pure merge and read helpers. Refuse an unexpected stored shape. Tests must prove that the discriminator is `template_origin`, not `skill_origin`.

- [ ] **Step 6: Run pure component tests**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/agent_templates/test_bindings.py \
  oss/tests/pytest/unit/agent_templates/test_compiler.py \
  oss/tests/pytest/unit/agent_templates/test_message.py \
  oss/tests/pytest/unit/agent_templates/test_provenance.py -q
```

Expected: all tests pass with no database or provider network call.

- [ ] **Step 7: Commit compilation**

```bash
git add api/oss/src/core/agent_templates api/oss/tests/pytest/unit/agent_templates
git commit -m "feat(api): compile agent template packages"
```

---

### Task 4: Add general idempotent workflow and skill creation

**Files:**

- Create: `api/oss/src/core/shared/idempotency.py`
- Modify: `api/oss/src/core/workflows/dtos.py`
- Modify: `api/oss/src/core/workflows/service.py:3463-3625`
- Modify: `api/oss/src/core/skills/service.py:381-432`
- Modify: `api/entrypoints/routers.py` where `SimpleWorkflowsService` is constructed
- Test: `api/oss/tests/pytest/unit/workflows/test_idempotent_simple_create.py`
- Test: `api/oss/tests/pytest/unit/skills/test_idempotent_skill_create.py`
- Test: `api/oss/tests/pytest/unit/git/test_platform_meta.py`

**Interfaces:**

- Consumes: Project id, user id, namespace, opaque request key, request fingerprint, `SimpleWorkflowCreate`, optional trusted metadata, and `LockEngine`.
- Produces: `SimpleWorkflowsService.create_idempotent(...) -> SimpleWorkflowCreateResult`, `SkillsService.plan_idempotent_skill_ref(...) -> InstalledSkillRef`, and `SkillsService.create_skill_idempotent(...) -> SkillCreated`.

Add this workflow result DTO:

```python
class SimpleWorkflowCreateResult(BaseModel):
    workflow: SimpleWorkflow
    replayed: bool
```

- [ ] **Step 1: Write failing deterministic identity and replay tests**

```python
def test_resource_identity_is_project_scoped_and_stable():
    first = resource_identity(PROJECT_ID, "agent-template-load", "request-1", "agent")
    again = resource_identity(PROJECT_ID, "agent-template-load", "request-1", "agent")
    other = resource_identity(OTHER_PROJECT_ID, "agent-template-load", "request-1", "agent")
    assert first == again
    assert first != other


@pytest.mark.asyncio
async def test_create_idempotent_replays_same_workflow():
    kwargs = valid_create_args(
        namespace="agent-template-load",
        request_key="request-1",
        request_fingerprint="sha256:" + "1" * 64,
    )
    first = await service.create_idempotent(**kwargs)
    replay = await service.create_idempotent(**kwargs)
    assert replay.workflow.id == first.workflow.id
    assert replay.replayed is True
    assert dao.count_artifacts() == 1
    assert dao.count_content_revisions() == 1


@pytest.mark.asyncio
async def test_same_key_with_changed_fingerprint_conflicts():
    await service.create_idempotent(
        **valid_create_args(
            namespace="agent-template-load",
            request_key="request-1",
            request_fingerprint="sha256:" + "1" * 64,
        )
    )
    with pytest.raises(EntityCreationIdempotencyConflict):
        await service.create_idempotent(
            **valid_create_args(
                namespace="agent-template-load",
                request_key="request-1",
                request_fingerprint="sha256:" + "2" * 64,
            )
        )
```

Add crash-recovery cases after artifact creation, variant creation, blank revision creation, and content revision creation. Add a two-coroutine test where both requests use the same key.

- [ ] **Step 2: Run the workflow and skill tests and confirm failure**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/workflows/test_idempotent_simple_create.py \
  oss/tests/pytest/unit/skills/test_idempotent_skill_create.py -q
```

Expected: tests fail because the idempotent methods are absent.

- [ ] **Step 3: Implement deterministic identities and fingerprints**

```python
_RESOURCE_NAMESPACE = UUID("1a470a9e-e428-4eb0-8f19-a6d52b7689e8")


def resource_identity(project_id: UUID, namespace: str, key: str, component: str) -> UUID:
    return uuid5(_RESOURCE_NAMESPACE, f"{project_id}:{namespace}:{key}:{component}")


def request_fingerprint(payload: BaseModel | dict) -> str:
    value = payload.model_dump(mode="json", exclude_none=True) if isinstance(payload, BaseModel) else payload
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()
```

Store only a SHA-256 hash of the opaque request key in `_ag.create_request`. Do not store the raw browser key.

- [ ] **Step 4: Implement `SimpleWorkflowsService.create_idempotent`**

Use a Redis lock named from project, namespace, and key hash. Derive the workflow id and stable child slugs from `resource_identity`. Under the lock:

1. Fetch the deterministic workflow id.
2. If it exists, read `_ag.create_request` and compare the fingerprint.
3. If it does not exist, create it with trusted platform metadata.
4. Fetch or create the deterministic variant.
5. Fetch or create the deterministic blank revision expected by the current simple-create contract.
6. Fetch or create the deterministic content revision.
7. Return the current complete simple workflow and `replayed=True` when any prior part existed.

Catch uniqueness conflicts and re-read under the same key. Never delete a partial resource during reconciliation. Never replace a later user revision when replaying.

Use this signature:

```python
async def create_idempotent(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    namespace: str,
    request_key: str,
    request_fingerprint: str,
    component: str,
    simple_workflow_create: SimpleWorkflowCreate,
    trusted_meta: dict | None = None,
) -> SimpleWorkflowCreateResult: ...
```

- [ ] **Step 5: Expose deterministic planning and creation through `SkillsService`**

Add a pure `plan_idempotent_skill_ref` method. It derives the workflow id and slug that creation will use, so the template compiler can validate every embed before any skill is created.

```python
def plan_idempotent_skill_ref(
    self,
    *,
    project_id: UUID,
    namespace: str,
    request_key: str,
    skill_name: str,
) -> InstalledSkillRef:
    workflow_id = resource_identity(
        project_id, namespace, request_key, f"skill:{skill_name}"
    )
    return InstalledSkillRef(
        name=skill_name,
        workflow_id=workflow_id,
        workflow_slug=f"{skill_name}-{workflow_id.hex[:8]}",
    )
```

Validate `SkillTemplate` before the first write. Call `SimpleWorkflowsService.create_idempotent` with component `skill:<skill-name>` and the exact planned identity. Return the same embed target. Do not add template imports to the skills domain.

```python
async def create_skill_idempotent(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    namespace: str,
    request_key: str,
    request_fingerprint: str,
    skill: dict,
) -> SkillCreated: ...
```

- [ ] **Step 6: Prove protected metadata behavior**

Extend platform metadata tests to prove:

- trusted create stores `_ag.create_request` and `_ag.template_origin`;
- untrusted artifact edits preserve stored `_ag`;
- untrusted revision commits drop incoming `_ag`;
- a client cannot forge either discriminator.

- [ ] **Step 7: Run tests**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/workflows/test_idempotent_simple_create.py \
  oss/tests/pytest/unit/skills/test_idempotent_skill_create.py \
  oss/tests/pytest/unit/git/test_platform_meta.py -q
```

Expected: all tests pass. No migration is generated.

- [ ] **Step 8: Commit generic resource idempotency**

```bash
git add api/oss/src/core/shared/idempotency.py api/oss/src/core/workflows api/oss/src/core/skills api/entrypoints/routers.py api/oss/tests/pytest/unit
git commit -m "feat(api): add idempotent workflow creation"
```

---

### Task 5: Materialize declared workspace entries without overwriting user work

**Files:**

- Modify: `api/oss/src/core/mounts/service.py`
- Modify: `api/oss/src/core/mounts/dtos.py`
- Test: `api/oss/tests/pytest/unit/mounts/test_materialize_entries.py`

**Interfaces:**

- Consumes: Agent workflow id plus parsed directories and file bytes from Task 2.
- Produces: `MountsService.materialize_entries_if_absent(...) -> MaterializeEntriesResult`.

- [ ] **Step 1: Write failing materialization tests**

```python
@pytest.mark.asyncio
async def test_materialize_creates_directories_before_files():
    result = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=["reports"],
        files=[MountFileSeed(path="target-profile.md", content=b"# Target\n")],
    )
    assert result.created == ["reports/", "target-profile.md"]
    assert await stored_file(store, WORKFLOW_ID, "target-profile.md") == b"# Target\n"


@pytest.mark.asyncio
async def test_retry_preserves_an_edited_existing_file():
    await seed_stored_file(store, WORKFLOW_ID, "target-profile.md", b"user edit")
    result = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=[],
        files=[MountFileSeed(path="target-profile.md", content=b"template")],
    )
    assert result.skipped == ["target-profile.md"]
    assert await stored_file(store, WORKFLOW_ID, "target-profile.md") == b"user edit"
```

Add tests for an existing directory, a destination occupied by the wrong kind, mid-batch failure followed by retry, and foreign-project workflow rejection.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/mounts/test_materialize_entries.py -q
```

Expected: failure because `materialize_entries_if_absent` is absent.

- [ ] **Step 3: Implement a general preserve-existing batch method**

```python
class MountFileSeed(BaseModel):
    path: str
    content: bytes


class MaterializeEntriesResult(BaseModel):
    created: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


async def materialize_entries_if_absent(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    workflow_id: UUID,
    directories: list[str],
    files: list[MountFileSeed],
) -> MaterializeEntriesResult: ...
```

Use `get_or_create_agent_mount` to resolve the project-owned mount. Sort directories by depth, then files by path. Read each destination before writing. If it exists with the same or different content, record `skipped`; never overwrite it. Treat a file-directory type collision as a conflict. Object writes are atomic at one key, so a retry can continue after the last completed key.

The parser owns path validation. The mount service must still confine every destination because it is a general public service boundary.

- [ ] **Step 4: Run mount tests**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/mounts/test_materialize_entries.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit workspace materialization**

```bash
git add api/oss/src/core/mounts api/oss/tests/pytest/unit/mounts/test_materialize_entries.py
git commit -m "feat(api): materialize missing agent workspace files"
```

---

### Task 6: Add a durable, idempotent initial session start

**Files:**

- Create: `api/oss/src/core/sessions/starts/__init__.py`
- Create: `api/oss/src/core/sessions/starts/dtos.py`
- Create: `api/oss/src/core/sessions/starts/types.py`
- Create: `api/oss/src/core/sessions/starts/service.py`
- Modify: `api/oss/src/core/sessions/inputs/dtos.py`
- Modify: `api/oss/src/core/sessions/inputs/service.py`
- Modify: `api/oss/src/core/workflows/service.py:3232-3280`
- Modify: `api/entrypoints/routers.py` where session services, DAOs, and `WorkflowsService` are available
- Test: `api/oss/tests/pytest/unit/sessions/test_pending_inputs_service.py`
- Test: `api/oss/tests/pytest/unit/sessions/test_session_start_service.py`
- Test: `api/oss/tests/pytest/unit/workflows/test_invoke_detached.py`

**Interfaces:**

- Consumes: Project/user ids, exact workflow and revision references, message content, request key, `SessionInputsService`, and `SessionExecutionsDAO`.
- Produces: `SessionInputsService.claim_for_execution(...) -> PendingInput` and `SessionStartsService.start_once(...) -> SessionStartResult` only after the fingerprinted input is promoted and `SessionExecutionsDAO.fetch_execution` returns the deterministic execution row.

- [ ] **Step 1: Write failing input-claim and start-once tests**

```python
@pytest.mark.asyncio
async def test_claim_for_execution_rejects_changed_content():
    first = await inputs.claim_for_execution(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        session_id=SESSION_ID,
        execution_id=EXECUTION_ID,
        content=request_content("Configure the agent."),
        idempotency_key="load-1",
    )
    with pytest.raises(SessionInputIdempotencyConflict):
        await inputs.claim_for_execution(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            session_id=SESSION_ID,
            execution_id=EXECUTION_ID,
            content=request_content("Different setup text."),
            idempotency_key="load-1",
        )
    assert first.state == PendingInputState.promoted


@pytest.mark.asyncio
async def test_start_once_returns_only_after_input_claim_and_execution_are_durable():
    result = await service.start_once(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        revision_id=REVISION_ID,
        message="Configure the agent.",
        request_key="load-1",
    )
    inputs.claim_for_execution.assert_awaited_once()
    executions.fetch_execution.assert_awaited_with(
        project_id=PROJECT_ID,
        session_id=result.session_id,
        execution_id=result.execution_id,
    )
    assert result.input_id == CLAIMED_INPUT_ID
    assert result.replayed is False


@pytest.mark.asyncio
async def test_replay_returns_existing_execution_without_invoking_again():
    executions.fetch_execution.return_value = existing_execution()
    result = await service.start_once(**valid_start_args())
    workflows.invoke_workflow_detached.assert_not_awaited()
    assert result.input_id == CLAIMED_INPUT_ID
    assert result.replayed is True


@pytest.mark.asyncio
async def test_timeout_after_remote_acceptance_rechecks_durable_row():
    workflows.invoke_workflow_detached.side_effect = httpx.ReadTimeout("lost response")
    executions.fetch_execution.side_effect = [None, existing_execution()]
    result = await service.start_once(**valid_start_args())
    assert result.replayed is True
```

Add a two-coroutine same-key test, an explicit first-frame failure test, a no-row-after-handshake test, a same-key/different-execution conflict, and a replay that proves the stored input content drives invocation.

- [ ] **Step 2: Run the input and start tests and confirm failure**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/sessions/test_pending_inputs_service.py \
  oss/tests/pytest/unit/sessions/test_session_start_service.py -q
```

Expected: tests fail because the input claim and starts service are absent.

- [ ] **Step 3: Add a durable input claim for a new execution**

Add this general method to `SessionInputsService`:

```python
async def claim_for_execution(
    self,
    *,
    project_id: UUID,
    user_id: UUID | None,
    session_id: str,
    execution_id: str,
    content: dict,
    idempotency_key: str,
) -> PendingInput: ...
```

Compute the existing `input_fingerprint` with policy `queue`. In one inputs DAO transaction, lock the session, fetch or create the idempotency row, compare the fingerprint, and promote that exact input to the supplied deterministic execution id. A same-key replay returns the same row. Different content raises `SessionInputIdempotencyConflict`. A row already promoted to another execution id also conflicts. This method does not inspect stream busy state and does not expose the input in the pending queue.

- [ ] **Step 4: Allow strict detached starts outside control commands**

Add `strict_start: bool = False` to `WorkflowsService.invoke_workflow_detached`. Pass `strict_first_record=strict_start or bool(control_command_id)` to `_stream_service_started`. Keep all current callers unchanged. Add a test that `strict_start=True` rejects an error frame.

- [ ] **Step 5: Implement `SessionStartsService`**

Derive ids with `resource_identity(project_id, "session-start", request_key, "session")` and component `execution`. Use their UUID strings as `session_id` and `execution_id`. Lock on project plus execution id.

```python
async def start_once(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    workflow_id: UUID,
    revision_id: UUID,
    message: str,
    request_key: str,
) -> SessionStartResult: ...
```

Under the lock:

1. Build the complete `WorkflowServiceRequest` with the deterministic session id, exact workflow and revision references, and one user message.
2. Call `SessionInputsService.claim_for_execution` with its serialized content, the deterministic execution id, and the stable request key.
3. Check `SessionExecutionsDAO.fetch_execution` for the deterministic ids.
4. If found, return it and the claimed input id with `replayed=True`.
5. Rebuild the invocation request from the stored claimed input content, not from newly derived account state.
6. Call `invoke_workflow_detached` with the deterministic execution id and `strict_start=True`.
7. Poll the execution DAO for at most two seconds with bounded 50 ms to 250 ms backoff.
8. Return only when the row exists.
9. On network or handshake error, perform the same bounded read-back before raising `SessionStartNotDurable`.

The input row provides the stable payload fingerprint and original input identity. The deterministic execution id and the existing `(project_id, session_id, execution_id)` primary key provide durable duplicate rejection. The lock prevents simultaneous local dispatch. The execution row lets later retries return without another invocation, including after the first run has finished.

- [ ] **Step 6: Run session and detached-invoke tests**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/sessions/test_pending_inputs_service.py \
  oss/tests/pytest/unit/sessions/test_session_start_service.py \
  oss/tests/pytest/unit/workflows/test_invoke_detached.py -q
```

Expected: all tests pass. Existing detached callers keep their prior behavior.

- [ ] **Step 7: Commit durable start support**

```bash
git add api/oss/src/core/sessions/inputs api/oss/src/core/sessions/starts api/oss/src/core/workflows/service.py api/entrypoints/routers.py api/oss/tests/pytest/unit/sessions/test_pending_inputs_service.py api/oss/tests/pytest/unit/sessions/test_session_start_service.py api/oss/tests/pytest/unit/workflows/test_invoke_detached.py
git commit -m "feat(api): add idempotent durable session starts"
```

---

### Task 7: Orchestrate the complete template load

**Files:**

- Create: `api/oss/src/core/agent_templates/service.py`
- Extend: `api/oss/src/core/agent_templates/exceptions.py`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_service.py`
- Test: `api/oss/tests/pytest/integration/agent_templates/test_load_service.py`

**Interfaces:**

- Consumes: All contracts from Tasks 1 through 6.
- Produces: `AgentTemplateLoader.load(...) -> TemplateLoadResult`.

- [ ] **Step 1: Write failing orchestration-order tests**

```python
@pytest.mark.asyncio
async def test_preflight_finishes_before_first_write():
    parser.parse.side_effect = TemplatePackageInvalid("bad")
    with pytest.raises(TemplatePackageInvalid):
        await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=command())
    skills.create_skill_idempotent.assert_not_awaited()
    workflows.create_idempotent.assert_not_awaited()
    mounts.materialize_entries_if_absent.assert_not_awaited()
    starts.start_once.assert_not_awaited()


@pytest.mark.asyncio
async def test_write_order_places_resources_before_handoff():
    await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=command(),
    )
    assert calls == [
        "resolve-source",
        "parse",
        "resolve-bindings",
        "plan-skills",
        "compile",
        "create-agent",
        "create-skills",
        "copy-workspace",
        "start-session",
    ]
```

Add replay tests for failure after each write boundary. Add the review-focus case where stored provenance pins version 1 after catalog latest moves to version 2. Add a changed body under the same request key conflict test.

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_service.py -q
```

Expected: failure because `AgentTemplateLoader` is absent.

- [ ] **Step 3: Implement request normalization and stored-pin recovery**

Compute the body fingerprint from `source`, `base_revision`, trimmed `initial_message`, and sorted connection choices. Do not include derived ids, latest package version, current account state, or current time.

Before resolving latest source content, derive the target workflow id and fetch it. If its trusted create metadata matches the request fingerprint, read `template_origin` and pass that version and digest as `TemplateSourcePin`. If its fingerprint differs, raise `TemplateLoadConflict` before any write.

- [ ] **Step 4: Implement the orchestration service**

```python
class AgentTemplateLoader:
    async def load(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        command: TemplateLoadCommand,
    ) -> TemplateLoadResult: ...
```

Perform every pure and project-read preflight before any write. Ask `SkillsService.plan_idempotent_skill_ref` for each deterministic embed target, then compile and validate the final agent with those planned references. After compilation passes, create the agent through `SimpleWorkflowsService.create_idempotent` with merged `_ag.create_request` and `_ag.template_origin`. This first durable write pins source recovery. Then create skills in sorted skill-name order through `SkillsService.create_skill_idempotent` and assert that each returned id and slug matches its plan. Materialize the workspace. Start the first session only after every skill and workspace entry succeeds.

Use these component keys:

- `skill:<skill-name>` for each skill workflow;
- `agent` for the agent workflow;
- `first-message:<template-digest>` for the session start.

Never catch an error and start the first turn with partial resources. Return partial resource ids only through structured logs, not the public error body. The retry key is the recovery mechanism.

- [ ] **Step 5: Add real-service integration coverage**

The integration test must use the real workflow, skill, mount, and session persistence adapters with provider calls stubbed. Read back:

- one agent artifact and one content revision;
- protected template provenance;
- one skill workflow and a valid embed in the agent revision;
- `target-profile.md` and `reports/` in the mount;
- one promoted input row with the stable fingerprint and one execution row with deterministic session and execution ids;
- no schedule or subscription row.

Run the same request twice and assert all ids match and row counts stay unchanged.

- [ ] **Step 6: Run loader tests**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/agent_templates/test_service.py \
  oss/tests/pytest/integration/agent_templates/test_load_service.py -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit the loader**

```bash
git add api/oss/src/core/agent_templates api/oss/tests/pytest/unit/agent_templates/test_service.py api/oss/tests/pytest/integration/agent_templates
git commit -m "feat(api): load single-agent template packages"
```

---

### Task 8: Expose and wire the authorized load endpoint

**Files:**

- Create: `api/oss/src/apis/fastapi/agent_templates/__init__.py`
- Create: `api/oss/src/apis/fastapi/agent_templates/models.py`
- Create: `api/oss/src/apis/fastapi/agent_templates/exceptions.py`
- Create: `api/oss/src/apis/fastapi/agent_templates/router.py`
- Modify: `api/entrypoints/routers.py`
- Test: `api/oss/tests/pytest/unit/agent_templates/test_router.py`
- Test: `api/oss/tests/pytest/integration/agent_templates/test_load_route.py`

**Interfaces:**

- Consumes: `AgentTemplateLoader` and current access checks.
- Produces: `POST /agent-templates/load` with the HTTP contract above.

- [ ] **Step 1: Write failing authorization and transport tests**

```python
@pytest.mark.asyncio
async def test_forbidden_request_does_not_resolve_source(client, resolver):
    deny(Permission.EDIT_WORKFLOWS)
    response = await client.post(
        "/api/agent-templates/load?project_id=" + str(PROJECT_ID),
        headers={"Idempotency-Key": "request-1"},
        json=valid_body(),
    )
    assert response.status_code == 403
    resolver.resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_both_edit_and_run_permissions_are_required(client):
    allow(Permission.EDIT_WORKFLOWS)
    deny(Permission.RUN_SESSIONS)
    response = await post_load(client)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_replay_returns_200_and_same_ids(client):
    first = await post_load(client, key="same")
    replay = await post_load(client, key="same")
    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json() | {"replayed": False} == first.json()
```

Add tests for missing header, unsupported source kind, unknown key, malformed package, fingerprint conflict, and non-durable handoff. Add a strict transport-model test that rejects client-supplied `connection_id`, `secret_id`, resolved connection slug, workflow id, session id, execution id, version, digest, or `_ag` metadata before the loader runs.

- [ ] **Step 2: Run router tests and confirm failure**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_router.py -q
```

Expected: failure because the route is absent.

- [ ] **Step 3: Implement transport models and error mapping**

Keep the API model separate from domain DTOs so the server, not the client, inserts `request_key`. Trim the header and cap it at the existing session idempotency limit. Return stable `code`, `message`, `retryable`, and `details` fields through the project exception interceptor.

- [ ] **Step 4: Implement permission-first routing**

```python
async def load_template(self, request: Request, payload: TemplateLoadRequest) -> JSONResponse:
    project_id = UUID(str(request.state.project_id))
    user_id = UUID(str(request.state.user_id))
    for permission in (Permission.EDIT_WORKFLOWS, Permission.RUN_SESSIONS):
        if not await check_action_access(
            user_uid=str(user_id), project_id=str(project_id), permission=permission
        ):
            raise FORBIDDEN_EXCEPTION
    request_key = normalized_idempotency_key(request)
    result = await self._loader.load(
        project_id=project_id,
        user_id=user_id,
        command=payload.to_domain(request_key=request_key),
    )
    return JSONResponse(
        status_code=200 if result.replayed else 201,
        content=result.model_dump(mode="json"),
    )
```

Do not log the body because it contains package setup text and user input. Log project id, hashed request key, source key, outcome, and resource ids.

- [ ] **Step 5: Wire concrete dependencies in the composition root**

Instantiate one internal resolver from the checked-in catalog. Reuse the already constructed `ConnectionsService`, `MCPGatewayService`, `SkillsService`, `SimpleWorkflowsService`, `MountsService`, `WorkflowsService`, `SessionExecutionsDAO`, and `LockEngine`. Include the new router under `/agent-templates`.

No core module may import FastAPI. No parser or compiler may import a DAO.

- [ ] **Step 6: Run route and OpenAPI tests**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/agent_templates/test_router.py \
  oss/tests/pytest/integration/agent_templates/test_load_route.py -q
```

Expected: all tests pass and the operation appears once in OpenAPI.

- [ ] **Step 7: Commit the API**

```bash
git add api/oss/src/apis/fastapi/agent_templates api/entrypoints/routers.py api/oss/tests/pytest/unit/agent_templates/test_router.py api/oss/tests/pytest/integration/agent_templates/test_load_route.py
git commit -m "feat(api): expose agent template loading"
```

---

### Task 9: Bundle every current card and add shared frontend loading state

**Files:**

- Add 28 versioned package roots under: `api/oss/src/resources/agent_templates/packages/`
- Modify: `api/oss/src/resources/agent_templates/catalog.json`
- Modify: `web/packages/agenta-entities/src/workflow/agentTemplates.ts`
- Create: `web/packages/agenta-entities/src/workflow/api/agentTemplates.ts`
- Create: `web/packages/agenta-entities/src/workflow/state/createPayload.ts`
- Create: `web/packages/agenta-entities/src/workflow/state/loadTemplate.ts`
- Modify: `web/packages/agenta-entities/src/workflow/state/commit.ts:590-700`
- Modify: `web/packages/agenta-entities/src/workflow/index.ts`
- Test: `web/packages/agenta-entities/tests/unit/agentTemplates.catalogParity.test.ts`
- Test: `web/packages/agenta-entities/tests/unit/loadTemplate.test.ts`
- Test: `web/packages/agenta-entities/tests/unit/createPayload.test.ts`

**Interfaces:**

- Consumes: Existing `AgentStarterTemplate`, ephemeral workflow state, project id, setup selection, and the Task 8 API.
- Produces: `loadAgentTemplateFromEphemeralAtom` and typed `AgentTemplateLoadResult`.

- [ ] **Step 1: Write failing catalog parity tests**

```typescript
it("has one backend internal package for every starter card", async () => {
  const catalog = JSON.parse(
    await fs.readFile(
      path.resolve(
        __dirname,
        "../../../../api/oss/src/resources/agent_templates/catalog.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  expect(AGENT_TEMPLATES.map((item) => item.source.key).sort()).toEqual(
    Object.keys(catalog)
      .filter((key) => key !== "outbound-prospecting")
      .sort(),
  );
});
```

Add a test that each card source is exactly `{kind: "internal", key: card.key}`. Also compare each card connection slot key and its gateway options with that package's connection declarations. Keep `outbound-prospecting` as a documentation and parser fixture, not a visible card.

- [ ] **Step 2: Add the typed source reference to every card**

```typescript
export interface TemplateConnection {
  key: string;
  // existing role, required, primary, and alternatives fields remain unchanged
}

export interface AgentStarterTemplate {
  key: string;
  source: { kind: "internal"; key: string };
  // existing display fields remain unchanged
}
```

Add one stable kebab-case key to every existing connection slot. Do not remove card display data, builder messages, examples, or connection metadata. The backend package becomes the source of created resources. The card remains the source of display copy and the current initial message.

- [ ] **Step 3: Convert all 28 existing cards to versioned internal packages**

Create version `1.0.0` for these exact keys:

```text
pr-reviewer, changelog-writer, issue-triage, ci-failure-triage, code-qa,
dependency-digest, support-triage, support-reply-drafter, bug-report-router,
feedback-clusterer, lead-qualifier, crm-updater, outreach-drafter,
meeting-followup, pipeline-digest, incident-responder, error-triage,
uptime-reporter, oncall-briefer, docs-qa, knowledge-chatbot, onboarding-buddy,
content-repurposer, newsletter-drafter, standup-summarizer, repo-slack-digest,
cross-tool-sync, weekly-report
```

Each package must have `plugin.json`, `ai.agenta/agents.json`, and one `AGENTS.md`. Convert each current card's `name`, `description`, `instructions`, and connection slots without adding capabilities the card does not claim. Gateway options use provider `composio` and the existing integration slugs. The current cards contain display trigger text, not exact provider event keys or schedule fields. Preserve that text as optional `SETUP.md` guidance for the ordinary conversation. Do not invent a structured automation recipe, skill, or workspace file when the card lacks exact source data.

Run the Task 2 parser over every catalog entry in the parity test suite.

- [ ] **Step 4: Extract ordinary ephemeral creation payload assembly**

Move the existing data preparation from `createWorkflowFromEphemeralAtom` into a pure `buildCreatePayloadFromEphemeral(get, revisionId)` helper. Both ordinary creation and template loading must call it. Test deep equality for `uri`, parameters, schemas, and flags.

This is the parity seam. The loader receives the exact base revision ordinary creation would have committed. Test one user/project fixture with a saved model preference and one fixture whose model credential is unavailable. In both cases, ordinary creation and template loading must produce the same base payload or the same existing rejection. The package must never supply a fallback model.

- [ ] **Step 5: Add typed API transport**

```typescript
export interface AgentTemplateLoadRequest {
  source: { kind: "internal"; key: string };
  base_revision: WorkflowData;
  initial_message: string;
  connection_choices: TemplateConnectionChoice[];
}

export async function loadAgentTemplate(
  projectId: string,
  requestKey: string,
  payload: AgentTemplateLoadRequest,
): Promise<AgentTemplateLoadResult> {
  const response = await axios.post(
    `${getAgentaApiUrl()}/agent-templates/load`,
    payload,
    {
      params: { project_id: projectId },
      headers: { "Idempotency-Key": requestKey },
    },
  );
  return agentTemplateLoadResultSchema.parse(response.data);
}
```

Use Zod for response validation. Preserve HTTP status on errors so host hooks can show the existing error surface.

- [ ] **Step 6: Add the shared Jotai load atom**

`loadAgentTemplateFromEphemeralAtom` reads the ephemeral entity, calls `buildCreatePayloadFromEphemeral`, and maps current setup selections by each card slot's stable `key`. For each slot it sends the exact connected primary/alternative gateway option or `skip`; it never selects a different connected provider. It then calls the API. It discards the local draft only after a successful response. It invalidates workflow lists and primes the returned revision if a read-back is available. It does not stash or auto-send a seed.

The caller creates one `crypto.randomUUID()` per button action and reuses it for all automatic HTTP retries. The existing module-scoped create latch still blocks rapid duplicate actions, but backend idempotency is the correctness mechanism.

- [ ] **Step 7: Run entity package tests**

Run:

```bash
cd web
pnpm exec vitest run \
  packages/agenta-entities/tests/unit/agentTemplates.catalogParity.test.ts \
  packages/agenta-entities/tests/unit/loadTemplate.test.ts \
  packages/agenta-entities/tests/unit/createPayload.test.ts
```

Expected: all tests pass, all 28 card keys resolve, and ordinary/template base payloads match.

- [ ] **Step 8: Commit packages and shared frontend state**

```bash
git add api/oss/src/resources/agent_templates web/packages/agenta-entities
git commit -m "feat(templates): bundle starter agents"
```

---

### Task 10: Switch both hosts without changing the interface

**Files:**

- Modify: `web/packages/agenta-home-ui/src/useCreateAgent.ts`
- Create: `web/packages/agenta-home-ui/src/useLoadAgentTemplate.ts`
- Modify: `web/oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.ts`
- Modify: `web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts`
- Modify: `/m` path `web/mobile/src/features/agents/useNewAgentAction.ts`
- Modify only where needed to preserve in-session setup: `/m` pending task and handoff files under `web/mobile/src/features/home/` and `web/mobile/src/features/agents/`
- Test: `web/packages/agenta-home-ui/src/useLoadAgentTemplate.test.tsx`
- Test: `web/oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.test.tsx`
- Test: `web/mobile/src/features/agents/useNewAgentAction.test.tsx`

**Interfaces:**

- Consumes: `loadAgentTemplateFromEphemeralAtom` from Task 9.
- Produces: Existing host callbacks and loading states, plus navigation to the returned durable session.

- [ ] **Step 1: Write failing host behavior tests**

For the older web host, assert the same template card and setup drawer render. On Create, assert one loader request and this navigation:

```typescript
expect(router.push).toHaveBeenCalledWith(
  `${baseAppURL}/${workflowId}/playground?revisions=${revisionId}&session_id=${sessionId}`,
);
expect(addFirstRunSeed).not.toHaveBeenCalled();
```

For `/m`, assert the template click still opens the current in-session connection card. On Continue, assert the loader receives the local ephemeral base data and selected choices, then navigation adopts the returned server session. Assert `stashPendingTaskAtom` does not store a second seed after success.

Add free-text and blank-agent regression tests. They must still call the ordinary `useCreateAgent` path and never call `/agent-templates/load`.

- [ ] **Step 2: Run host tests and confirm failure**

Run:

```bash
cd web
pnpm exec vitest run \
  packages/agenta-home-ui/src/useLoadAgentTemplate.test.tsx \
  oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.test.tsx \
  mobile/src/features/agents/useNewAgentAction.test.tsx
```

Expected: tests fail because template paths still use ordinary prompt-only creation.

- [ ] **Step 3: Add a shared template loader hook**

The hook mints or reuses an ephemeral agent exactly as ordinary creation does, creates one request key, calls the load atom, and returns all ids. Keep the existing module-scoped re-entry latch. Report errors through each host's existing callback.

```typescript
export interface LoadedAgentTemplate {
  appId: string;
  revisionId: string;
  sessionId: string;
  executionId: string;
}
```

Do not combine this hook with ordinary `useCreateAgent`. The blank and free-text path must remain unchanged.

- [ ] **Step 4: Replace the older web host's template action**

`useCreateAgentFromTemplate` passes `template.source`, `appendSetupPreamble(templateBuilderMessage(template), setup)`, and the current setup selection to the shared loader. This keeps the exact connected-provider and ask-first wording the interface already sends. After success, register the created agent in the current roster cache and navigate to the returned revision and session. Remove only the template path's `addFirstRunSeedAtom` write. Keep that atom for ordinary seeded creation.

- [ ] **Step 5: Replace `/m` template handoff while preserving setup placement**

On template selection, keep the current local ephemeral agent and local session shell so the connection card remains inside the conversation. Do not create the real workflow before the setup card resolves. On Continue/Create, apply the existing `appendSetupPreamble` function, then call the shared loader with that text, the ephemeral id, and the setup selection. Replace the local agent/session identity with the returned workflow/revision/session ids, then hydrate the server transcript.

If navigation fails after a successful load, show the existing “Agent created, but couldn't open it” message. Do not retry with a new request key. The user can find the created agent under Agents.

- [ ] **Step 6: Run frontend unit tests**

Run:

```bash
cd web
pnpm exec vitest run \
  packages/agenta-entities/tests/unit/agentTemplates.catalogParity.test.ts \
  packages/agenta-entities/tests/unit/loadTemplate.test.ts \
  packages/agenta-home-ui/src/useLoadAgentTemplate.test.tsx \
  oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.test.tsx \
  mobile/src/features/agents/useNewAgentAction.test.tsx
```

Expected: all tests pass. Template paths call the loader once. Blank and free-text paths keep ordinary behavior.

- [ ] **Step 7: Commit host integration**

```bash
git add web/packages/agenta-home-ui web/oss/src/components/pages/agent-home web/mobile/src/features/agents web/mobile/src/features/home
git commit -m "feat(web): load templates through backend service"
```

---

### Task 11: Verify the complete behavior and document evidence

**Files:**

- Create: `web/oss/tests/playwright/acceptance/agent-templates/load-single-agent-template.spec.ts`
- Create: `web/oss/tests/playwright/acceptance/agent-templates/load-single-agent-template.ts`
- Modify: `docs/design/agent-workflows/projects/agent-plugin-templates/validation.md`
- Modify: `docs/design/agent-workflows/projects/agent-plugin-templates/status.md`
- Modify: `openspec/changes/load-single-agent-templates/tasks.md`

**Interfaces:**

- Consumes: The completed route and both hosts.
- Produces: Commit-specific automated and browser evidence. It does not change the product contract.

- [ ] **Step 1: Add browser acceptance scenarios**

Cover these cases with stable data-testid selectors:

1. Open one template in the older host, complete the existing setup, and create.
2. Verify the URL contains the returned revision and session.
3. Verify one user first message appears and the setup card is not replaced by a new screen.
4. Reload and verify the same session has one first message.
5. Repeat on `/m` at desktop width.
6. Repeat on `/m` at phone width.
7. Create a blank agent and verify ordinary creation still works.
8. Submit two same-key API requests concurrently and verify one agent, one promoted input, and one execution.

Use API read-back to assert saved instructions, skill embeds, mount entries, provenance, and absence of triggers. Do not infer success from a toast.

- [ ] **Step 2: Run focused backend suites**

Run:

```bash
cd api
uv run pytest \
  oss/tests/pytest/unit/agent_templates \
  oss/tests/pytest/integration/agent_templates \
  oss/tests/pytest/unit/workflows/test_idempotent_simple_create.py \
  oss/tests/pytest/unit/skills/test_idempotent_skill_create.py \
  oss/tests/pytest/unit/mounts/test_materialize_entries.py \
  oss/tests/pytest/unit/sessions/test_pending_inputs_service.py \
  oss/tests/pytest/unit/sessions/test_session_start_service.py \
  oss/tests/pytest/unit/workflows/test_invoke_detached.py -q
```

Expected: all tests pass.

- [ ] **Step 3: Run focused frontend suites and type checks**

Run:

```bash
cd web
pnpm exec vitest run \
  packages/agenta-entities/tests/unit/agentTemplates.catalogParity.test.ts \
  packages/agenta-entities/tests/unit/loadTemplate.test.ts \
  packages/agenta-home-ui/src/useLoadAgentTemplate.test.tsx \
  oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.test.tsx \
  mobile/src/features/agents/useNewAgentAction.test.tsx
pnpm type-check:native
```

Expected: tests and type checks pass.

- [ ] **Step 4: Run package and OpenSpec validation**

Run:

```bash
cd api
uv run pytest oss/tests/pytest/unit/agent_templates/test_parser.py -q
cd ..
npx --yes @fission-ai/openspec@1.13.1 validate load-single-agent-templates --strict
npx --yes @fission-ai/openspec@1.13.1 validate support-template-subagents --strict
git diff --check
```

Expected: both proposals validate, all package examples pass, and whitespace checks pass.

- [ ] **Step 5: Run browser acceptance**

Run the repository's documented Playwright setup for:

```bash
cd web
pnpm exec playwright test oss/tests/playwright/acceptance/agent-templates/load-single-agent-template.spec.ts
```

Expected: all desktop, phone, reload, concurrent, and blank-agent scenarios pass.

- [ ] **Step 6: Run one ordinary build-kit smoke conversation**

Load `outreach-drafter` without a valid mailbox connection. Verify the saved agent omits the invalid connection. Verify the first message names the unresolved need. Verify the agent can use the existing `request_connection` tool and can propose an automation with existing trigger tools. Do not approve or create the automation as part of loading.

Record the implementation commit SHA, commands, result, redacted resource ids, and browser evidence in `validation.md`. Mark any case not run as `NOT RUN`. Mark every multi-agent scenario as `NOT IMPLEMENTED`.

- [ ] **Step 7: Update task and status documents**

Check an OpenSpec task only when its linked tests and read-back evidence pass. Keep failed or unrun tasks unchecked. Update `status.md` from specification-only to the exact implementation state. Do not claim runtime support from schema checks alone.

- [ ] **Step 8: Commit acceptance evidence**

```bash
git add web/oss/tests/playwright/acceptance/agent-templates docs/design/agent-workflows/projects/agent-plugin-templates/validation.md docs/design/agent-workflows/projects/agent-plugin-templates/status.md openspec/changes/load-single-agent-templates/tasks.md
git commit -m "test: verify single-agent template loading"
```

---

## Final review checklist

- [ ] Every internal card key resolves to a pinned package.
- [ ] Unauthorized requests do not resolve packages or project bindings.
- [ ] All package and native config validation finishes before the first write.
- [ ] Exactly one agent is accepted. `subagents` is rejected.
- [ ] Ordinary `llm`, `harness`, `runner`, and `sandbox` values survive unchanged.
- [ ] Skills are real skill workflows and the agent contains valid embeds.
- [ ] Workspace retries preserve existing files and directories.
- [ ] Connection and MCP bindings come only from active, valid rows in the target project.
- [ ] Provenance uses protected `_ag.template_origin` and cannot be forged.
- [ ] Same-key same-body retries return the same resource and session ids.
- [ ] Same-key changed-body retries return HTTP 409.
- [ ] The endpoint returns success only after a fingerprinted input claim and durable execution row exist.
- [ ] The browser never submits a second seed after successful loading.
- [ ] The loader creates no schedule or subscription.
- [ ] Blank and free-text agent creation remain on the existing path.
- [ ] Existing agents require no migration.
- [ ] Multi-agent support is reported as **NOT IMPLEMENTED**.

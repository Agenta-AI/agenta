# Plugins POC Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task by task. Read this whole file first. Read `proposal.md`, `design.md` and the four `specs/*/spec.md` files in this folder before Task 1.

**Goal:** Ship a working proof of concept of Agenta "plugins": a JavaScript program with named operations and one HTML page, stored as a workflow, used from a "Plugins" page in the web UI and by agents as an MCP server, whose code calls MCP servers through the gateway as the principal.

**Architecture:** A plugin is a workflow revision with URI `agenta:custom:plugin:v0` (flag `is_plugin`). The services handler `plugin_v0` (mounted at `/plugin/v0`) runs one operation in the Daytona code runner with an async JavaScript template that offers `ctx.mcp(name).call(tool, args)`. The API gateway serves each plugin as a built-in MCP provider at `/gateways/mcps/builtin/plugin/{slug}` and dispatches `tools/call` through the existing workflow tool path (`ToolsRouter.call_tool`, call ref `workflow.variant.{slug}.{version}`). Agents link plugins by an ordinary `mcps` entry. The web UI (`web/mobile`, the active app) lists plugins in the same list frame as agents and renders the plugin page inside the existing drive frame wrapper with a one-method bridge.

**Tech stack:** Python 3.11 (FastAPI API, Agenta SDK, services), pytest, TypeScript and React (`web/mobile`: Next.js Pages Router, shadcn kit from `@agenta/ui/ui`, Jotai, TanStack Query), Daytona sandboxes with Node 18 or later.

---

## Context you need

### Repository and branch

- Repo: `Agenta-AI/agenta`. Base branch: the latest `release/v*` branch (at writing, `release/v0.127.3`). Check with `git ls-remote --heads origin 'release/v*'` and use the highest version. Open the pull request against that branch, ready for review, not draft.
- Create branch `feat/plugins-poc` from the base.
- Before committing Python changes, run `ruff format` then `ruff check --fix` in the touched folder (`api`, `sdks/python`, `services`). For web changes, run `pnpm lint-fix` in `web`. Read `web/mobile/AGENTS.md` before any web work: no antd, no imports from `@/oss/*`, one component per file, thin route shells, designed loading, empty and error states. **Do not edit `web/oss`; it is abandoned.**
- Tests per area: `cd sdks/python && py-run-tests`, `cd api && py-run-tests`, `cd services && py-run-tests`, where `py-run-tests` is `uv sync --locked && uv run --no-sync python run-tests.py`. To run one file: `cd api && uv run --no-sync pytest oss/tests/pytest/unit/gateways/test_builtin_plugin_mcp_adapter.py -q`.

### Where to run the stack

- Use a throwaway stack on the shared dev box `the development host` (`ssh mahmoud@<development-host>`), in a new folder under `<isolated-workspace>/` (the dev user cannot write to `/data` itself), with its own Docker Compose project name and its own port. Follow the repo's `AGENTS.md` "Local dev loop" section.
- **Never touch the `<protected-production-project>` Compose project or anything under `<protected-production-checkout>`.** That is a personal production instance.
- The stack needs the Daytona runner: set `AGENTA_SERVICES_CODE_SANDBOX_RUNNER=daytona` and the Daytona variables the runner validates (`DAYTONA_API_KEY`, optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, and the snapshot setting the runner reads in `_resolve_snapshot_id`). Copy values from an existing dev `.env` on the box (`~/code/agenta/.env*`) without printing secrets.
- A project connection named `linear` (custom MCP endpoint, slug `linear`) must exist on the stack for the demo. Create it in the UI under the MCP connections settings.

### Code you will touch (read these first)

| Area | File | What is there |
| --- | --- | --- |
| URI roles and flags | `sdks/python/agenta/sdk/engines/running/utils.py` (`_AGENTA_ROLE_TABLE` at line 607, `infer_flags_from_data` at 702, handler maps around lines 79, 270, 348) | Every managed `(kind, key)` must be in the table; flags are derived from the key. |
| SDK flag models | `sdks/python/agenta/sdk/models/workflows.py` (lines 82 and 113) | `WorkflowFlags`, `WorkflowQueryFlags`. |
| Pattern to copy | `sdks/python/oss/tests/pytest/unit/test_skill_flags.py` | How the recent `is_skill` flag was added and tested. Grep `is_skill` to see every place a flag appears. |
| Code handler | `sdks/python/agenta/sdk/engines/running/handlers.py` (`code_v0` at 2812) | How a script handler reads `script` and `runtime` and calls `run_code_safely`. |
| Templates | `sdks/python/agenta/sdk/engines/running/templates.py` | Evaluator templates, keyed by version and runtime. Python `str.format`, so literal braces are doubled. |
| Daytona runner | `sdks/python/agenta/sdk/engines/running/runners/daytona.py` (`run` at 431, params at 474, result parse after 509) | With version `"3"`, the template gets `params = {inputs, outputs, trace}` and must print `{"result": ...}` as the last JSON line. |
| Services mount | `services/oss/src/managed.py` (line 45), `services/entrypoints/main.py` (line 209) | One `_create_managed_service` per handler, mounted at `/{key}/v0`. |
| API flags | `api/oss/src/core/workflows/dtos.py` (lines 145 and 182) | Revision flags and query flags. Flag filters use JSONB containment, so no migration is needed. |
| Gateway relay | `api/oss/src/core/gateways/mcps/service.py` (`_BUILTIN_ADAPTER_KEYS` at 99, `relay` at 739, Agenta branch at 830, `_resolve_target` at 977) | Built-in providers that dial no upstream. |
| Template for the adapter | `api/oss/src/core/gateways/mcps/providers/agenta/adapter.py` and its test `api/oss/tests/pytest/unit/gateways/test_builtin_agenta_mcp_adapter.py` | Copy its JSON-RPC handling. |
| Child-run path | `api/oss/src/apis/fastapi/tools/router.py` (`call_tool` at 1421, workflow refs at 1446, grammar near 1872, child envelope at 1944) | A call ref `workflow.variant.{slug}` invokes that workflow as a child run with the same principal. |
| Gateway constants | `api/oss/src/core/gateways/mcps/dtos.py` (line 34) | `AGENTA_PROVIDER`, `MOCK_PROVIDER`, `MANAGED_PROVIDER`. |
| SDK MCP config | `sdks/python/agenta/sdk/agents/mcp/models.py` (66, 82), `resolver.py` (30) and test `sdks/python/oss/tests/pytest/unit/agents/mcp/test_resolver.py` (around 319) | Built-in connections allow a provider only, and route to `/builtin/{provider}/{provider}`. |
| Web navigation | `web/mobile/src/features/nav/useMobileNavItems.tsx` (Agents item at about line 222) | Navigation items of the active app. |
| Web agents list | `web/mobile/src/features/agents/AgentListScreen.tsx`, `AgentListTable.tsx`, `AgentRowCells.tsx`; route shell `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/agents/index.tsx` | The list frame to mirror (`ListTable` from `@agenta/ui/list-table`, `ScreenScaffold`, `PageTitle`, `AppShell`). Skills (`web/mobile/src/features/skills/`) is a simpler example of a flag-based workflow list. |
| Web flags | `web/packages/agenta-entities/src/workflow/core/schema.ts` (100, 148, 366), `api/api.ts` (1345) | Flag schema and the revision query. |
| Frame wrapper | `web/packages/agenta-entities/src/drive/htmlApp/frame.ts` (`buildRunFrame` at 126), `protocol.ts` (`Hello` at 166, `SANDBOX_FLAGS` at 308, `RUN_CSP` at 325), `stub.ts` | Navigation guard and one-time port hand-off; the file stub shows how a plugin-side stub receives the port. |
| Browser invoke | `web/packages/agenta-entities/src/workflow/state/runnableSetup.ts` (`invocationUrlAtomFamily` at 246) | Builds `{serviceUrl}/invoke` from a workflow's URI. |

### Settled decisions (do not reopen)

- JavaScript only. Daytona only. The plugin code uses the credential the Daytona runner already passes (`AGENTA_CREDENTIALS`). A gateway-only token is a follow-up.
- The plugin has no permissions of its own and the page has no approval prompts. "Ask" exists only in the agent's MCP policy.
- Plugins are created by a seed script. The agent link is an `mcps` entry. There is no creation UI and no configuration UI.

---

### Task 0: Spike: can sandbox code reach the gateway as the principal?

**Files:** none committed. Keep notes in the PR description.

**Step 1:** Bring up the throwaway stack with Daytona on and a `linear` connection.

**Step 2:** Create a temporary code evaluator (`agenta:custom:code:v0`, runtime `javascript`, version `"3"`) whose body is:

```javascript
function evaluate(inputs, outputs, trace) { return { node: process.version }; }
```

Run it once and check that the result shows Node 18 or later.

**Step 3:** Write a small script (`uv run` with a `# /// script` header, `httpx` dependency) that posts `initialize`, then `tools/list`, to `{API_URL}/gateways/mcps/custom/linear` with header `X-AG-Credentials: <value>`, where the value is a credential obtained the same way the Daytona runner gets it (`GET /access/permissions/check?action=run_service&resource_type=service&without_grants=true` with an API key, read `credentials` from the JSON). Record: status codes, whether `mcp-session-id` comes back, and the response content type.

**Step 4:** If the call is refused, stop and report the exact status and body. Otherwise continue.

---

### Task 1: SDK: `agenta:custom:plugin:v0` and `is_plugin`

**Files:**
- Modify: `sdks/python/agenta/sdk/engines/running/utils.py`
- Modify: `sdks/python/agenta/sdk/models/workflows.py`
- Test: `sdks/python/oss/tests/pytest/unit/test_plugin_flags.py` (new)

**Step 1: Write the failing test**

```python
from agenta.sdk.engines.running.utils import (
    AGENTA_CUSTOM_PLUGIN_URI,
    infer_flags_from_data,
)
from agenta.sdk.models.workflows import WorkflowFlags, WorkflowQueryFlags, WorkflowRevisionData


def test_flag_models_expose_is_plugin():
    assert WorkflowFlags().is_plugin is False
    assert WorkflowQueryFlags().is_plugin is None


def test_plugin_uri_derives_is_plugin_and_roles():
    flags = infer_flags_from_data(
        flags=None,
        data=WorkflowRevisionData(uri=AGENTA_CUSTOM_PLUGIN_URI, runtime="javascript", script="const operations = {};"),
    )
    assert flags.is_plugin is True
    assert flags.is_application is True
    assert flags.is_evaluator is False
    assert flags.is_agent is False


def test_other_uris_are_not_plugins():
    flags = infer_flags_from_data(flags=None, data=WorkflowRevisionData(uri="agenta:custom:code:v0", script="x"))
    assert flags.is_plugin is False
```

**Step 2:** Run `cd sdks/python && uv run --no-sync pytest oss/tests/pytest/unit/test_plugin_flags.py -q`. Expected: FAIL (import error).

**Step 3: Implement**

- Add `AGENTA_CUSTOM_PLUGIN_URI = "agenta:custom:plugin:v0"` next to the other URI constants in `utils.py` (grep `AGENTA_BUILTIN_SKILL_URI`).
- Add `("custom", "plugin"): (True, False, False),` to `_AGENTA_ROLE_TABLE`.
- In `infer_flags_from_data`, add `is_plugin = key == "plugin"` beside `is_agent` and pass `is_plugin=is_plugin` to `WorkflowFlags(...)`.
- In `models/workflows.py`, add `is_plugin: bool = False` to `WorkflowFlags` and `is_plugin: Optional[bool] = None` to `WorkflowQueryFlags`, beside `is_agent`.

**Step 4:** Run the test. Expected: PASS. Then run the existing flag tests: `uv run --no-sync pytest oss/tests/pytest/unit/test_skill_flags.py -q`.

**Step 5:** `git commit -m "feat(sdk): add agenta:custom:plugin:v0 workflow kind and is_plugin flag"`

---

### Task 2: API: store and query `is_plugin`

**Files:**
- Modify: `api/oss/src/core/workflows/dtos.py` (add `is_plugin` to `WorkflowRevisionFlags` and `WorkflowRevisionQueryFlags`, beside `is_agent`)
- Grep `is_skill` under `api/oss/src` and add `is_plugin` wherever a flag list is enumerated (for example `static_catalog.py`). Do not add a migration.
- Test: `api/oss/tests/pytest/unit/workflows/test_plugin_flags.py` (new)

**Step 1: Test**

```python
from oss.src.core.workflows.dtos import WorkflowRevisionFlags, WorkflowRevisionQueryFlags


def test_revision_flags_carry_is_plugin():
    assert WorkflowRevisionFlags().is_plugin is False
    assert WorkflowRevisionQueryFlags(is_plugin=True).model_dump(exclude_none=True) == {"is_plugin": True}
```

**Step 2:** Run it: FAIL. **Step 3:** Add the fields. **Step 4:** PASS. **Step 5:** Commit `feat(api): add is_plugin revision flag`.

---

### Task 3: SDK: the plugin template and `plugin_v0` handler

**Files:**
- Modify: `sdks/python/agenta/sdk/engines/running/templates.py` (add `PLUGIN_TEMPLATES`)
- Modify: `sdks/python/agenta/sdk/engines/running/handlers.py` (add `plugin_v0`)
- Modify: `sdks/python/agenta/sdk/engines/running/utils.py` (register `plugin_v0`, an interface, and a catalog entry under `custom`, mirroring `code`)
- Test: `sdks/python/oss/tests/pytest/unit/test_plugin_handler.py` (new)

**Step 1: Tests**

```python
import pytest
from agenta.sdk.engines.running.handlers import plugin_v0
from agenta.sdk.engines.running.templates import PLUGIN_TEMPLATES

REVISION = {
    "data": {
        "uri": "agenta:custom:plugin:v0",
        "runtime": "javascript",
        "script": "const operations = { ping: async () => ({ok: true}) };",
        "parameters": {"plugin": {"operations": [{"name": "ping"}], "mcps": [], "ui": {"html": ""}}},
    }
}


@pytest.mark.asyncio
async def test_unknown_operation_is_refused_before_any_run():
    with pytest.raises(Exception, match="nope"):
        await plugin_v0(revision=REVISION, inputs={"operation": "nope", "args": {}}, parameters=REVISION["data"]["parameters"])


def test_template_renders_to_valid_javascript(tmp_path):
    rendered = PLUGIN_TEMPLATES["javascript"].format(params_json="{}", user_code="const operations = {};")
    assert "const operations = {};" in rendered
    assert "X-AG-Credentials" in rendered
    # Syntax check with Node when it is installed (it is on CI images and the dev box).
    import shutil, subprocess
    if shutil.which("node"):
        script = tmp_path / "plugin.js"
        script.write_text(rendered)
        subprocess.run(["node", "--check", str(script)], check=True)


@pytest.mark.asyncio
async def test_null_result_is_kept(monkeypatch):
    async def fake_run(**kwargs):
        return {"value": None}

    monkeypatch.setattr("agenta.sdk.engines.running.handlers.run_code_safely", fake_run)
    assert await plugin_v0(revision=REVISION, inputs={"operation": "ping", "args": {}}, parameters=REVISION["data"]["parameters"]) is None
```

Adjust the call to match how `code_v0` receives `revision` and `parameters` (read `code_v0` and `_extract_revision_field`). The goal is: an unknown operation raises an error that names it, with no sandbox call.

**Step 2:** Run: FAIL.

**Step 3: Implement the template** as a raw string (`PLUGIN_TEMPLATES = {"javascript": r"""..."""}`), so `\n` reaches JavaScript unchanged; double every literal brace for `str.format`:

```javascript
const params = JSON.parse({params_json!r});
// `mcps` maps each declared name to its gateway URL, resolved in Python by plugin_v0.
const {{ operation, args, mcps }} = params.inputs;
const credentials = process.env.AGENTA_CREDENTIALS || "";

async function readRpc(res, id) {{
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!type.includes("text/event-stream")) return text ? JSON.parse(text) : null;
  // One event = consecutive `data:` lines, joined with newlines; events end at a blank line.
  const events = text.split(/\r?\n\r?\n/).map((block) =>
    block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n"));
  for (const data of events) {{
    if (!data) continue;
    let msg; try {{ msg = JSON.parse(data); }} catch {{ continue; }}
    if (msg && msg.id === id && (msg.result !== undefined || msg.error !== undefined)) return msg;
  }}
  return null;
}}

function makeClient(name, url) {{
  let session = null, protocol = null, ready = null, nextId = 1;
  async function post(body) {{
    const headers = {{
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "X-AG-Credentials": credentials,
    }};
    if (session) headers["mcp-session-id"] = session;
    if (protocol) headers["mcp-protocol-version"] = protocol;
    const res = await fetch(url, {{ method: "POST", headers, body: JSON.stringify(body) }});
    session = res.headers.get("mcp-session-id") || session;
    if (!res.ok) throw new Error(`MCP ${{name}}: HTTP ${{res.status}} ${{await res.text()}}`);
    if (body.id === undefined) return null; // notification: an empty 202 is fine
    const msg = await readRpc(res, body.id);
    if (!msg) throw new Error(`MCP ${{name}}: no response for request ${{body.id}}`);
    return msg;
  }}
  async function init() {{
    const hello = await post({{ jsonrpc: "2.0", id: nextId++, method: "initialize",
      params: {{ protocolVersion: "2025-06-18", capabilities: {{}}, clientInfo: {{ name: "agenta-plugin", version: "0" }} }} }});
    if (hello.error) throw new Error(`MCP ${{name}}: ${{JSON.stringify(hello.error)}}`);
    protocol = (hello.result && hello.result.protocolVersion) || null;
    await post({{ jsonrpc: "2.0", method: "notifications/initialized" }});
  }}
  return {{
    async call(tool, toolArgs) {{
      ready = ready || init();
      await ready;
      const msg = await post({{ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: {{ name: tool, arguments: toolArgs || {{}} }} }});
      if (msg.error) throw new Error(`MCP ${{name}}.${{tool}}: ${{JSON.stringify(msg.error)}}`);
      if (msg.result && msg.result.isError) throw new Error(`MCP ${{name}}.${{tool}} failed: ${{JSON.stringify(msg.result.content)}}`);
      return msg.result;
    }},
  }};
}}

const clients = {{}};
const ctx = {{
  mcp(name) {{
    const url = (mcps || {{}})[name];
    if (!url) throw new Error(`MCP server "${{name}}" is not declared in this plugin`);
    clients[name] = clients[name] || makeClient(name, url);
    return clients[name];
  }},
}};

{user_code}

(async () => {{
  if (typeof operations !== "object" || typeof operations[operation] !== "function") {{
    throw new Error(`Operation "${{operation}}" is not defined in the plugin code`);
  }}
  const value = await operations[operation](args || {{}}, ctx);
  // Wrapped so null and integers survive the runner's version "3" normalization.
  console.log(JSON.stringify({{ result: {{ value: value === undefined ? null : value }} }}));
}})().catch((err) => {{ console.error(String(err && err.stack || err)); process.exit(1); }});
```

**Implement the handler** in `handlers.py`, modeled on `code_v0`:

```python
@instrument(ignore_inputs=["parameters"])
async def plugin_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    **kwargs: Any,
) -> Any:
    from agenta.sdk.contexts.running import RunningContext

    ctx = RunningContext.get()
    plugin = (parameters or {}).get("plugin") or {}
    operation = (inputs or {}).get("operation")
    names = {op.get("name") for op in plugin.get("operations") or []}
    if operation not in names:
        raise InvalidInputsV0Error(expected=sorted(n for n in names if n), got=operation)

    code = _extract_revision_field(revision, "script") or _extract_revision_field(ctx.revision, "script")
    if not code:
        raise MissingConfigurationParameterV0Error(path="script")

    mcps = {
        entry["name"]: _gateway_mcp_route(
            connection=MCPGatewayConnection.model_validate(entry["connection"]),
            name=entry["name"],
            gateway_base_url=api_url,
        )
        for entry in plugin.get("mcps") or []
    }

    wrapped = await run_code_safely(
        app_params={},
        inputs={"operation": operation, "args": (inputs or {}).get("args") or {}, "mcps": mcps},
        output=None,
        correct_answer=None,
        code=str(code),
        runtime="javascript",
        templates=PLUGIN_TEMPLATES,
        version="3",
        trace=None,
    )
    return wrapped.get("value") if isinstance(wrapped, dict) else wrapped
```

`api_url` is `ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url`, the value the Daytona runner passes as `AGENTA_API_URL` (`_create_sandbox`). Import `MCPGatewayConnection` from `agenta.sdk.agents.mcp` and `_gateway_mcp_route` from `agenta.sdk.agents.mcp.resolver`. Use the error classes `code_v0` already imports, with the operation name in the message. The local and restricted runners already refuse JavaScript (`runners/local.py:45`); do not add another runner check. Register `plugin=dict(v0=plugin_v0)` (and the interface and catalog entries) under `custom` in `utils.py`, mirroring `code`. Give the interface an inputs schema `{"type": "object", "properties": {"operation": {"type": "string"}, "args": {"type": "object"}}, "required": ["operation"]}`.

**Step 4:** Run the tests: PASS. **Step 5:** Commit `feat(sdk): add plugin_v0 handler and JavaScript plugin template`.

---

### Task 4: Services: mount `/plugin/v0`

**Files:**
- Modify: `services/oss/src/managed.py`: import `plugin_v0`; add `custom_plugin_app = _create_managed_service(plugin_v0, uri="agenta:custom:plugin:v0")`.
- Modify: `services/entrypoints/main.py`: import `custom_plugin_app`; `app.mount("/plugin/v0", custom_plugin_app)` next to `/code/v0`.

**Step 1:** Add to the canonical services acceptance map (`services/oss/tests/pytest/acceptance/test_canonical_services.py`, around line 102) the entry `"/plugin/v0/invoke": "agenta:custom:plugin:v0"` if that test enumerates mounts. **Step 2:** Run `cd services && uv run --no-sync pytest oss/tests/pytest/unit -q`. **Step 3:** Commit `feat(services): mount the plugin handler`.

---

### Task 5: SDK: let agents link a plugin as a built-in MCP server

**Files:**
- Modify: `sdks/python/agenta/sdk/agents/mcp/models.py` (`_validate_route_identity`)
- Modify: `sdks/python/agenta/sdk/agents/mcp/resolver.py` (`_gateway_mcp_route`)
- Test: `sdks/python/oss/tests/pytest/unit/agents/mcp/test_resolver.py` (extend the table near line 319)

**Step 1: Tests**

```python
def test_builtin_plugin_connection_takes_a_slug():
    c = MCPGatewayConnection(namespace="builtin", provider="plugin", slug="linear-triage")
    assert c.slug == "linear-triage"


def test_slug_still_refused_for_other_builtin_providers():
    with pytest.raises(ValidationError):
        MCPGatewayConnection(namespace="builtin", provider="mock", slug="x")


def test_builtin_plugin_route():
    from agenta.sdk.agents.mcp.resolver import _gateway_mcp_route
    url = _gateway_mcp_route(
        connection=MCPGatewayConnection(namespace="builtin", provider="plugin", slug="linear-triage"),
        name="linear-triage",
        gateway_base_url="https://api.example",
    )
    assert url == "https://api.example/gateways/mcps/builtin/plugin/linear-triage"
```

**Step 2:** FAIL. **Step 3:** In the validator, allow `builtin` with `provider == "plugin"` and a slug, and require the slug for `plugin`. In `_gateway_mcp_route`, return `f"{base}/builtin/plugin/{connection.slug}"` for that case. Keep a constant `PLUGIN_PROVIDER = "plugin"` in the SDK module. **Step 4:** PASS, plus the whole resolver test file. **Step 5:** Commit `feat(sdk): route agent MCP entries to plugin gateway endpoints`.

---

### Task 6: API: the `plugin` built-in MCP provider

**Files:**
- Modify: `api/oss/src/core/gateways/mcps/dtos.py`: `PLUGIN_PROVIDER = "plugin"`.
- Create: `api/oss/src/core/gateways/mcps/providers/plugin/__init__.py` and `adapter.py` with `PluginMCPAdapter`.
- Modify: `api/oss/src/core/gateways/mcps/service.py`: in `_resolve_target`, a built-in `plugin` target resolves to a synthetic `MCPEndpoint(slug=name, name=name, auth_mode=MCPAuthScheme.NONE, namespace=BUILTIN, provider_key=PLUGIN_PROVIDER, data=MCPEndpointData(route=MCPEndpointRoute()))`; in `relay`, right after the Agenta branch, dispatch `provider == PLUGIN_PROVIDER` to `PluginMCPAdapter` and record its outcome like the Agenta branch does. Unlike that branch, wrap the adapter call in `try`/`except`: on an exception, `await record(GatewayOutcome(status_code=500))` (or the mapped status) and re-raise, so failed calls are recorded too. The service needs a `workflows_service` handle: add an optional constructor argument and pass it where the service is built in `api/entrypoints/routers.py` (grep `agenta_tools_router=`).
- Test: `api/oss/tests/pytest/unit/gateways/test_builtin_plugin_mcp_adapter.py` (new; copy the stub style of `test_builtin_agenta_mcp_adapter.py`).

**Adapter sketch:**

```python
class PluginMCPAdapter:
    """Serve one plugin's operations as MCP tools; calls run the plugin as a child workflow run."""

    def __init__(self, *, workflows_service: Any, tools_router: Any) -> None:
        self.workflows_service = workflows_service
        self.tools_router = tools_router

    async def _operations(self, *, project_id: UUID, slug: str) -> list[dict]:
        # Fetch the latest revision of the workflow with this slug. Use the same
        # retrieve call the tools router uses for `workflow.variant.{slug}` refs.
        # Raise MCPEndpointNotFoundError unless revision.flags.is_plugin.
        # Return revision.data.parameters["plugin"]["operations"].
        ...

    async def relay(self, *, request: Request, project_id: UUID, slug: str, body: bytes) -> MCPRelayResult:
        # Same JSON-RPC handling as AgentaMCPAdapter:
        #   no id -> 202; initialize -> handshake; tools/list -> operations;
        #   Both tools/list and tools/call first call self._operations(...), so a slug that
        #   is not a plugin is refused on either method.
        #   tools/call -> refuse a name not in operations (JSON-RPC error), then
        #       self.tools_router.call_tool(request=request, body=ToolCall.model_validate(
        #       {"data": {"id": str(request_id), "function": {
        #           # Pin the revision the resolver just checked, so list and call agree.
        #           "name": f"workflow.variant.{slug}.{revision.version}",
        #           "arguments": {"operation": name, "args": arguments}}}}))
        #   Return {"content": [{"type": "text", "text": content}]}, plus "isError": true
        #   when response.call.status.code is "STATUS_CODE_ERROR".
        #   No authorization, credential or usage logic here: relay() already did it.
        ...
```

`call_tool` sends refs that start with `workflow.` to `_call_workflow_tool` (`router.py:1446`, prefix constant at `router.py:123`). Read its grammar docstring near `router.py:1872`, and reuse the revision retrieve call it makes for the `variant` axis.

**Step 1: Tests** with stubs: (a) `tools/list` returns the manifest operations; (b) a slug whose latest revision is not a plugin raises endpoint not found; (c) `tools/call` passes `workflow.variant.{slug}.{version}` (the checked revision) and `{operation, args}` to the stub router; (d) an error status from the stub router becomes `isError: true`; (e) `tools/call` on a non-plugin slug is refused; (f) a notification gets 202.

**Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, and run `uv run --no-sync pytest oss/tests/pytest/unit/gateways -q`. **Step 5:** Commit `feat(api): serve plugins as built-in MCP gateway endpoints`.

---

### Task 7: Demo plugin, seed script, and backend chain check (before any UI)

**Files:**
- Create: `examples/plugins/linear-triage/index.js`, `ui.html`, `plugin.json`, and `examples/plugins/seed.py`.

`index.js`:

```javascript
const operations = {
  my_open_issues: async (args, ctx) => {
    const res = await ctx.mcp("linear").call("list_issues", { assignee: "me", limit: 50 });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    let issues = [];
    try { issues = JSON.parse(text); } catch { issues = []; }
    const score = (i) => (i.priority ? 5 - i.priority : 0) + (i.dueDate ? 2 : 0);
    return issues.map((i) => ({ id: i.id, title: i.title, score: score(i) })).sort((a, b) => b.score - a.score);
  },
  bulk_label: async ({ ids, label }, ctx) => {
    const done = [];
    for (const id of ids || []) {
      await ctx.mcp("linear").call("update_issue", { id, labels: [label] });
      done.push(id);
    }
    return { labeled: done };
  },
};
```

Check the real Linear MCP tool names and argument shapes with the `tools/list` output from Task 0 and adjust.

`plugin.json` holds the manifest (`operations` with JSON schemas, `mcps: [{name: "linear", connection: {type: "gateway", namespace: "custom", slug: "linear"}}]`). `ui.html` is a small page with a "Load my issues" button that calls `agenta.plugin.call("my_open_issues", {})`, a table, checkboxes, and a "Label as urgent" button that calls `bulk_label`. Give the page body padding (about 12px 16px).

`seed.py` (`uv run`, `# /// script` with `httpx`) reads `AGENTA_API_URL`, `AGENTA_API_KEY`, `PROJECT_ID`, `AGENT_ID`, then:

1. **Creator check.** For each declared server, build its gateway URL (same rule as `_gateway_mcp_route`) and post `initialize`, then `tools/list`, with the creator's credential in `X-AG-Credentials` (get it as in Task 0). Stop with a clear message if any server fails.
2. Create the plugin with `POST /simple/workflows/` (`{"workflow": {"slug": "linear-triage", "name": "Linear triage", "data": {"uri": "agenta:custom:plugin:v0", "runtime": "javascript", "script": <index.js>, "parameters": {"plugin": {...plugin.json, "ui": {"html": <ui.html>}}}}}}`). If the slug exists, edit it with `PUT /simple/workflows/{id}`.
3. Read the agent with `GET /simple/workflows/{AGENT_ID}`. If the entry is missing, append to `data.parameters.agent.mcps` the entry `{"name": "linear-triage", "connection": {"type": "gateway", "namespace": "builtin", "provider": "plugin", "slug": "linear-triage"}}` and save with `PUT /simple/workflows/{AGENT_ID}`.
4. Print the plugin id and the agent revision id.

Check the request shapes in `api/oss/src/apis/fastapi/workflows/models.py` (`SimpleWorkflowCreateRequest`, `SimpleWorkflowEditRequest`).

**Chain check (stop and report if it fails):**

1. Deploy the backend tasks to the throwaway stack and run the seed.
2. Ask the agent "list my open Linear issues with the Linear triage plugin". Expect a call to `my_open_issues` and a scored list.
3. In the gateway usage records or API logs, confirm the Linear relay calls carry the same user as the agent run.
4. Set the agent's policy for `bulk_label` on server `linear-triage` to `ask` (`policy.tool_permissions`). Ask it to label the top issue. Expect a approval pause before the plugin runs.
5. Time three calls of `my_open_issues` from the agent, cold and warm.

Commit `feat(examples): add Linear triage demo plugin and seed script`.

---

### Task 8: Web: flag and Plugins list (`web/mobile`)

**Files:**
- Modify: `web/packages/agenta-entities/src/workflow/core/schema.ts`: add `is_plugin` next to `is_agent` (three places).
- Modify the generated client types that list `is_skill` (grep `web/packages/agenta-api-client/src/generated/api/types/`). Regenerate the client if the repo has a script for it; otherwise add `is_plugin` beside `is_skill` by hand.
- Create: `web/mobile/src/features/plugins/usePlugins.ts`: a TanStack query in two steps, the same pattern as `fetchWorkflowAgentFlags` (`web/packages/agenta-entities/src/workflow/api/api.ts:1345`): (1) `queryWorkflows({projectId, flags: {is_evaluator: false}})` for the artifacts; (2) `POST /workflows/revisions/query?project_id=...` with `{"workflow_refs": [{"id": ...}, ...], "grouping": {"by": "artifact", "get": "latest"}}` and no flags (the API rejects flags combined with grouping); keep rows whose `flags.is_plugin` is true. Map to `{workflowId, revisionId, name (from the artifact), createdById, updatedAt}`. If a small shared helper reads better, generalize `fetchWorkflowAgentFlags` to return the latest revision flags and use it from both places.
- Create: `web/mobile/src/features/plugins/PluginListScreen.tsx`, `PluginListTable.tsx`, `PluginRowCells.tsx`, `states/PluginsEmpty.tsx`, `states/PluginsSkeleton.tsx`. Mirror the Agents list frame (`ScreenScaffold`, `PageTitle`, `ListTable`) with columns Plugin, Created by and Last changed. No filters, and no create, rename or archive. A row opens `${projectURL}/plugins/${workflowId}`.
- Create: `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/plugins/index.tsx` (thin shell, same shape as the agents shell).
- Modify: `web/mobile/src/features/nav/useMobileNavItems.tsx`: add `{key: "plugins", title: "Plugins", icon: createElement(SquaresFourIcon, {size: 16}), link: `${projectURL}/plugins`}` right after the Agents item.

**Step:** Run `pnpm lint-fix` in `web` and the mobile unit tests (`cd web/mobile && pnpm vitest run`). Open the screen on the stack. Commit `feat(web): add Plugins list`.

---

### Task 9: Web: plugin screen with the bridge (`web/mobile`)

**Files:**
- Create: `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/plugins/[plugin_id]/index.tsx` (thin shell).
- Create: `web/mobile/src/features/plugins/PluginScreen.tsx`, `PluginFrame.tsx`, `pluginStub.ts`, `usePluginBridge.ts`, `states/PluginLoadError.tsx`.

**Behavior:**
- Load the latest revision of `plugin_id`, and read `data.parameters.plugin.ui.html` and the revision id.
- `pluginStub.ts` exports a `<script>` string that defines `window.agenta = {plugin: {call(operation, args)}}`. It waits for the `hello` message that carries a `MessagePort` (the same message shape the file stub in `stub.ts` receives). It then sends `{id, operation, args}` on the port and resolves or rejects on `{id, ok, result | error}`.
- `PluginFrame.tsx` renders `<iframe sandbox={SANDBOX_FLAGS} srcDoc={buildRunFrame(html + PLUGIN_STUB)} />` at full size. Reuse `buildRunFrame`, `SANDBOX_FLAGS` and the `hello` handshake from `@agenta/entities` (`drive/htmlApp`). Do not reuse the file host.
- `usePluginBridge.ts`, on frame load: create a `MessageChannel`, post `hello` with `port2` (target origin `"*"`, as the drive host does), and answer each request with a batch invoke. The request is `POST {invocationUrl}?project_id={projectId}`, where `invocationUrl` is the value of `invocationUrlAtomFamily(workflowId)` (it already ends in `/invoke`). Send `Accept: application/json` and the viewer's normal API auth (shared axios client). The body is `{"references": {"workflow_revision": {"id": revisionId}}, "data": {"inputs": {"operation": ..., "args": ...}}}`, with no inline configuration. Reply `{ok: true, result: data.outputs}` or `{ok: false, error: status.message}`.
- On a `FrameNavigated` message, show `PluginLoadError` (the plugin has stopped).

**Step:** On the stack, open the plugin and click "Load my issues". Commit `feat(web): render plugin screens with an operation bridge`.

---

### Task 10: End-to-end check (short)

On the throwaway stack:

1. As an annotator (or owner), open Plugins, open "Linear triage", and click "Load my issues". Expect a scored list. Time five clicks.
2. As a viewer, do the same. Expect a clear "access denied" error from the Linear call.
3. Re-run the agent check from Task 7 once with the UI deployed.

Write the results, timings and anything that broke in the PR description under "POC findings". Keep secrets, IDs and environment names out of the PR text.

---

## Out of scope (do not build)

Build-kit tools, a plugin editor, an agent-link UI, plugin state, a workerd runner, a gateway-only token for plugins, a `gateway_endpoints` claim, approvals on the page, provider-key hiding.

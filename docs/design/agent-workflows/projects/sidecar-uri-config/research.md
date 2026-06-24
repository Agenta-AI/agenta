# Research

Everything below is read from the current tree. File paths and line references were verified
against the working copy on 2026-06-24.

## 1. Where routing is decided today (the one seam)

Routing lives in exactly one function, `select_backend`, in
`services/oss/src/agent/app.py`:

```python
def select_backend(selection: RunSelection) -> Backend:
    """Pick the backend for a run.

    The service always uses the sandbox-agent-backed runner. `AGENTA_AGENT_RUNNER_URL`
    selects HTTP transport in deployed containers. When it is unset, local development
    spawns the TypeScript runner CLI from the runner dir.
    """
    return SandboxAgentBackend(
        sandbox=selection.sandbox,
        url=runner_url(),
        cwd=str(runner_dir()),
    )
```

It is called once, in the handler `_agent`:

```python
harness = make_harness(selection.harness, Environment(select_backend(selection)))
```

So the seam already receives the parsed `RunSelection`. Adding a `uri` to `RunSelection` and
preferring it inside `select_backend` is a localized change — no new plumbing, no new call site.

## 2. The env-var resolution it would fall back to

`services/oss/src/agent/config.py`:

```python
def runner_dir() -> Path:
    """Directory of the TypeScript agent runner (where the CLI command runs)."""
    override = os.getenv("AGENTA_AGENT_RUNNER_DIR")
    return Path(override) if override else _DEFAULT_AGENT_DIR

def runner_url() -> Optional[str]:
    """HTTP URL for the deployed agent runner service, when configured."""
    value = os.getenv("AGENTA_AGENT_RUNNER_URL")
    return value.strip() if value and value.strip() else None
```

`SandboxAgentBackend` (`sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`) then branches
on `url`:

- `url` set → HTTP delivery (`deliver_http` / `deliver_http_stream`) to that URL.
- `url` unset → spawn the runner CLI as a subprocess from `cwd` (`deliver_subprocess*`),
  resolving `src/cli.ts` under `runner_dir()`; missing assets raise
  `AgentRunnerConfigurationError`.

So today's precedence is simply: `AGENTA_AGENT_RUNNER_URL` if set, else the local CLI in
`AGENTA_AGENT_RUNNER_DIR`. The `uri` slots in *above* `runner_url()`:
**`selection.uri` → `runner_url()` → local CLI.**

The existing behavior is pinned by `services/oss/tests/pytest/unit/agent/test_select_backend.py`
(`test_runner_url_selects_http_transport`, `test_no_runner_url_uses_subprocess_transport`,
`test_no_runner_url_requires_runner_assets`). Those tests are the template for the new ones.

## 3. `RunSelection` vs `AgentConfig` — where the field belongs

`sdks/python/agenta/sdk/agents/dtos.py`:

```python
class RunSelection(BaseModel):
    """The run-time choices stored next to the agent config: which harness, which sandbox,
    the permission policy. Read by the caller to pick a backend and harness class;
    deliberately not part of the neutral AgentConfig."""

    harness: str = "pi_core"
    sandbox: str = "local"
    permission_policy: PermissionPolicy = "auto"

    @classmethod
    def from_params(cls, params, *, default_harness="pi_core", default_sandbox="local"):
        agent = params.get("agent")
        source = agent if isinstance(agent, dict) else params
        return cls(
            harness=str(source.get("harness") or default_harness).lower(),
            sandbox=str(source.get("sandbox") or default_sandbox).lower(),
            permission_policy=str(source.get("permission_policy") or "auto").lower(),
        )
```

This is the natural home: `uri` is *where a run goes*, the same category of fact as `sandbox`.
The class docstring even says these choices are "stored next to the agent config" and
"deliberately not part of the neutral `AgentConfig`." A sidecar address is exactly that — a
deployment/routing choice, never *what the agent is*.

`AgentConfig` (same file) is the neutral model (instructions/model/tools/mcp_servers/skills/
harness_options/sandbox_permission). A sidecar address does not belong there.

## 4. The schema the playground renders, and the parse path

`AgentConfigSchema` in `sdks/python/agenta/sdk/utils/types.py` is the strict schema shipped on
`/inspect` as the `agent_config` catalog type. It carries the run-selection trio for editing:

```python
harness: str = Field(...)
sandbox: Literal["local", "daytona"] = Field(...)
permission_policy: Literal["auto", "deny"] = Field(...)
sandbox_permission: Optional[SandboxPermission] = Field(...)
```

The agent-config-schema interface doc confirms the split (line 32):

> Note that `harness`, `sandbox`, and `permission_policy` are the run selection. The handler
> reads them from the same `parameters` object via `RunSelection.from_params(...)`, not just
> from `AgentConfig`.

The default config has a single source, `build_agent_v0_default(...)` in
`sdks/python/agenta/sdk/utils/types.py`, consumed by both the SDK builtin interface and the
service `/inspect`. A new field that needs a default would be added there once. **`uri` should
default to unset (no key emitted)**, so the default config does not change and the env-var path
stays the out-of-the-box behavior.

## 5. The `/run` wire — `uri` is NOT a wire field

`request_to_wire` in `sdks/python/agenta/sdk/agents/utils/wire.py` builds the `/run` body. It
carries `harness`, `sandbox`, messages, config (tools/prompt/permission/harness-files),
`secrets`, `trace`, `session_id`. It does **not** carry a runner URL — the URL is the transport
target, decided *before* the wire is built, when `SandboxAgentBackend` is constructed.

So `uri` is consumed entirely on the service side, in `select_backend`. It never reaches the
runner. The golden wire fixtures
(`sdks/python/oss/tests/pytest/unit/agents/golden/`) stay byte-identical. This is the cleanest
property of the design: a routing override with zero wire-contract cost.

## 6. What crosses to the chosen sidecar (the security input)

This is why the address matters. The `/run` body the service POSTs to whatever URL it picks can
carry (per the sidecar-trust research and `wire.py`):

- **`secrets`** — resolved provider credentials (OpenAI/Anthropic keys, full AWS/GCP/Azure
  credential groups), assembled server-side by the connection resolver.
- **`toolCallback.authorization`** — a bearer token the runner uses to call gateway tools back
  on the platform.
- **`trace.authorization`** — the caller's `Authorization` header value, reused to export OTel
  spans.

The transport sets **no auth and does no TLS** (`deliver_http` does a plain
`client.post(url, json=payload)`). So whatever address `select_backend` resolves, the service
will ship real credentials and reusable bearer tokens to it in plaintext. **If a caller can
choose that address, a caller can choose where the service sends its secrets.** That is the
load-bearing security fact; see [security.md](security.md).

## 7. Related work this sits next to

- **sidecar-deployment-proposal** (`../sidecar-deployment-proposal/`) — owns the *default*
  runner deployment contract: `AGENTA_AGENT_RUNNER_URL` defaulting to
  `http://sandbox-agent:8765`, the Compose/Helm/Railway wiring, the `sandbox-agent` service
  naming. This `uri` is the *per-run override* layered on that default. The two are
  complementary: the proposal sets the fallback; this sets the optional override.
- **sidecar-trust-and-sandbox-enforcement** (`../sidecar-trust-and-sandbox-enforcement/`) —
  documents that `/run` is unauthenticated plaintext on an assumed-trusted network, and that the
  near-term hardening is (1) loopback/in-cluster binding and (2) an optional shared `/run`
  token. A caller-supplied `uri` directly stresses assumption (1): it lets the chosen address
  leave the trusted network. The restriction in [security.md](security.md) is designed to keep
  that assumption intact.

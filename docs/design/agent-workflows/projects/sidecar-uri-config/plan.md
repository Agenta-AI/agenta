# Plan

The change is small and localized: one new optional field on `RunSelection` (and the schema it
is edited through), one preference inside `select_backend`, a server-side restriction on the
value, and tests. No `/run` wire change, no golden-fixture change.

## 1. The field

Add an optional `uri` to `RunSelection` in `sdks/python/agenta/sdk/agents/dtos.py`:

```python
class RunSelection(BaseModel):
    harness: str = "pi_core"
    sandbox: str = "local"
    permission_policy: PermissionPolicy = "auto"
    uri: Optional[str] = None   # sidecar (runner) address; unset → env-var fallback

    @classmethod
    def from_params(cls, params, *, default_harness="pi_core", default_sandbox="local"):
        agent = params.get("agent")
        source = agent if isinstance(agent, dict) else params
        return cls(
            harness=str(source.get("harness") or default_harness).lower(),
            sandbox=str(source.get("sandbox") or default_sandbox).lower(),
            permission_policy=str(source.get("permission_policy") or "auto").lower(),
            uri=_clean_uri(source.get("uri")),
        )
```

`_clean_uri` trims and returns `None` for empty/blank, mirroring `runner_url()`'s
trim-or-`None` behavior so an empty string never counts as "set".

**Why `RunSelection`, not `AgentConfig`:** the address is *where a run goes*, the same category
as `sandbox`. The neutral `AgentConfig` is *what the agent is* and stays address-free. This
matches the existing split (see research §3).

## 2. The schema (playground editor)

Add `uri` to `AgentConfigSchema` in `sdks/python/agenta/sdk/utils/types.py`, next to the
run-selection trio, **optional, default unset**, and likely marked advanced/hidden so the
playground does not surface a routing knob to ordinary users:

```python
uri: Optional[str] = Field(
    default=None,
    description="Optional sidecar (agent runner) address. When set, the run is routed here; "
                "when unset, the server falls back to AGENTA_AGENT_RUNNER_URL / the local runner.",
)
```

`build_agent_v0_default(...)` is **not** changed: `uri` has no default key, so the shipped
default config is byte-identical and the env-var path stays the out-of-the-box behavior. The
agent-config-schema interface doc gets the new row (kept-in-sync requirement).

> Open question O3 (see status): whether the field is exposed in the playground at all, or kept
> API-only / behind an advanced toggle. A routing override is an operator/testing concern, not a
> normal authoring field. The reviewer should decide.

## 3. Routing prefers it

`select_backend` in `services/oss/src/agent/app.py` prefers `selection.uri`, then `runner_url()`,
then the local CLI — and runs the value through the security check (step 4) before trusting it:

```python
def select_backend(selection: RunSelection) -> Backend:
    url = resolve_runner_url(selection.uri)  # allowlist-checked override, else env, else None
    return SandboxAgentBackend(
        sandbox=selection.sandbox,
        url=url,
        cwd=str(runner_dir()),
    )
```

`resolve_runner_url(override)` (new, in `services/oss/src/agent/config.py`):

```python
def resolve_runner_url(override: Optional[str]) -> Optional[str]:
    """Routing precedence: a validated request override, else AGENTA_AGENT_RUNNER_URL,
    else None (local CLI). An override must pass the allowlist check (see security.md);
    a rejected override raises rather than silently falling back."""
    if override:
        return validate_runner_uri(override)   # raises on a disallowed address
    return runner_url()
```

Precedence, explicitly: **`selection.uri` (validated) → `AGENTA_AGENT_RUNNER_URL` → local CLI in
`AGENTA_AGENT_RUNNER_DIR`.** Unset `uri` is exactly today's behavior.

A rejected override **errors** (it does not silently fall back to the env var). Falling back
would let a caller probe the allowlist by difference and would mask a misconfiguration; failing
loud is the not-implemented/unsupported pattern the codebase already uses for capability gates.

## 4. The security restriction (load-bearing — see security.md)

A caller-supplied address is an SSRF / secret-exfiltration risk because the service ships
resolved provider keys and bearer tokens to whatever URL it picks. So the override is gated
**server-side**, default-off:

- New env var `AGENTA_AGENT_RUNNER_URI_ALLOWLIST` (comma-separated origins/hosts), added to
  `api/oss/src/utils/env.py` and read via the shared `env` object (never raw `os.getenv` for app
  config, per repo convention).
- `validate_runner_uri(uri)` accepts the override **only** when its origin is in the allowlist;
  otherwise it raises a typed error (`UnsupportedRunnerUriError` or similar), surfaced as a 4xx.
- **Default: allowlist empty → every override rejected.** Out of the box, only the env-var path
  works. An operator opts in by listing trusted sidecar origins.

The exact allowlist shape (origins vs hosts, scheme/port handling, whether loopback is
implicitly allowed) is detailed in [security.md](security.md). The deeper transport hardening
(auth token, TLS) is the sidecar-trust project's scope, not this one.

## 5. Tests

Extend `services/oss/tests/pytest/unit/agent/test_select_backend.py` (the existing precedence
suite) plus an SDK `RunSelection` parse test:

- `uri` set + allowlisted → backend `_url` is the override (override beats the env var).
- `uri` set + allowlisted + `AGENTA_AGENT_RUNNER_URL` also set → override wins.
- `uri` unset → falls back to `AGENTA_AGENT_RUNNER_URL` (unchanged behavior).
- `uri` unset + env unset → local CLI subprocess (unchanged behavior).
- `uri` set but NOT allowlisted → raises (no silent fallback).
- `uri` set + empty allowlist (default) → raises (default-off).
- `RunSelection.from_params({"uri": "  "})` → `uri is None` (blank treated as unset).
- Golden wire fixture test stays green untouched (proves `uri` is not on the `/run` wire).

## 6. Docs to keep in sync (same PR as the eventual implementation)

Per the `keep-docs-in-sync` skill, the implementing PR must also update:

- `docs/design/agent-workflows/interfaces/public-edge/agent-config-schema.md` — add the `uri`
  row and a note that it is run-selection, parsed by `RunSelection`, and *not* a `/run` wire
  field.
- `docs/design/agent-workflows/interfaces/in-service/agent-service-handler.md` — the
  `select_backend` precedence (`uri` → env → local) and the allowlist gate.
- The interface inventory index + `api/oss/src/utils/env.py` doc for the new env var.
- `../sidecar-deployment-proposal/` — note the per-run override on top of the default contract.
- `../sidecar-trust-and-sandbox-enforcement/` — note the allowlist as the control that keeps the
  trusted-network assumption intact under a caller-supplied address.

## 7. Rollout

One slice; the surface is tiny. Pre-production, so no migration and no compat shim. The only
gate is the security decision (O1/O2 in status): ship the field **with** the allowlist default-off
in the same change, so a caller-supplied address is never trusted before the restriction exists.

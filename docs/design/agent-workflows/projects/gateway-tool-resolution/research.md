# Research: the verified failure chain

Every step below is confirmed in the code at workspace base `b94346f1fc` plus PR #5197.
File and line references are current as of 2026-07-10.

## The path a resolve takes

An agent run resolves its tools once, up front, before the model runs. The chain:

`handler.py` (run entry) -> SDK `resolver.py` -> SDK `gateway.py` (HTTP) ->
`POST /api/tools/resolve` -> backend `router.py` -> backend `service.py` -> Composio catalog.

### 1. The backend produces a precise error

`api/oss/src/core/tools/service.py`, `ToolsService._resolve_composio_tool` (lines 432-481).
For each Composio tool it validates the connection, then calls `get_action`. When the
catalog has no such action:

```python
action = await self.get_action(
    provider_key=provider_key,
    integration_key=ref.integration,
    action_key=ref.action,
)
if not action:
    raise ActionNotFoundError(
        provider_key=provider_key,
        integration_key=ref.integration,
        action_key=ref.action,
    )
```

`ActionNotFoundError` (exceptions.py:43-58) carries the message
`"Action not found: composio/github/COMMIT_MULTIPLE_FILES"`.

`resolve_tools` (service.py:400-430) loops over the references and calls
`_resolve_composio_tool` per tool. It raises on the first failure and returns nothing
partial. This is the backend half of the all-or-nothing behavior.

### 2. The router puts the detail in the HTTP body

`api/oss/src/apis/fastapi/tools/router.py`, `resolve_tools` handler (lines 1026-1066):

```python
except ActionNotFoundError as e:
    raise HTTPException(status_code=404, detail=e.message) from e
```

So the wire response is `404 {"detail": "Action not found: composio/github/COMMIT_MULTIPLE_FILES"}`.
The useful sentence is present at the HTTP boundary. The router also maps connection errors
(`ConnectionNotFoundError` -> 404, `ConnectionInactiveError` / `ConnectionInvalidError` ->
400, `ToolSlugInvalidError` -> 400), each with a real message in `detail`.

### 3. The SDK throws the body away (the swallow point)

`sdks/python/agenta/sdk/agents/platform/gateway.py`,
`AgentaGatewayToolResolver.resolve` (lines 111-118):

```python
if response.status_code >= 400:
    error = GatewayToolResolutionError(
        f"Gateway tool resolution failed (HTTP {response.status_code})",
        status=response.status_code,
        ref_count=len(tools),
    )
    log.warning("agent: %s", error)
    raise error
```

The code never reads `response.json()` or `response.text`. The `{"detail": ...}` body is
discarded. The only surviving information is the status code. This single branch is the
root of problem 1. Everything downstream inherits the bare string.

Note the SDK sends the whole tool set in one batched `POST /tools/resolve` (gateway.py:80-99)
and raises on any non-2xx. This is the SDK half of the all-or-nothing behavior.

`GatewayToolResolutionError` (sdks tools/errors.py:51) extends `ToolResolutionError`, which
already carries optional `status`, `ref_count`, `spec_count`, `provider`, and `reference`
fields. There is no field for a server-provided detail string today.

### 4. The exception fails the whole turn before the model runs

`sdks/python/agenta/sdk/agents/handler.py`, `_agent` (line 275):

```python
resolved_tools = await comp.resolve_tools(agent_template.tools)
```

This runs before `make_harness`, before `agent_event_stream` / `agent_batch`, before any
model call. A `GatewayToolResolutionError` here propagates straight out of the workflow
handler and becomes the run error. That is why the run dies in about six seconds: it is the
resolve round-trip and nothing else. No harness starts, so there is no partial transcript.

### 5. The UI shows the run error string

The run error surfaced to the caller and the UI is the exception's string:
`Gateway tool resolution failed (HTTP 404)`. There is no separate place downstream that
re-enriches it, so the fix for problem 1 has to keep the detail attached from step 3 onward.

## Where all-or-nothing lives, precisely

Two layers both enforce it, so a resilience fix has to touch both:

- Backend `service.py` `resolve_tools` raises on the first bad reference and returns no
  partial result. To resolve survivors, it would need to collect per-reference outcomes
  instead of raising on the first.
- SDK `gateway.py` `resolve` sends one batch and raises on any non-2xx. To keep survivors,
  it would need the endpoint to return a partial result plus per-reference errors, then
  build specs for the ones that resolved and carry a warning for the ones that did not.

## The discover side (issue #5174), for context

`service.py` `discover_capabilities` (lines 487-525) and `_discovery_connection_state`
(lines 564-627) drive the discover path. The docstring at `_discovery_connection_state`
claims `ready` "mirrors what resolve_connection_by_slug accepts at invoke time ... so a
ready here means the tool will actually resolve." That covers the connection, but not the
action's existence in the resolvable catalog. The action-level drift #5174 describes
(search surfaces an action that `get_action` cannot find) is not closed by this check.
That is why #5174 proposes a validate-on-discover backstop: filter discovered actions
through the same `get_action` resolve uses. This workspace does not implement that. See
design.md D3 for why it stays separate and where the two plans touch.

## What a fix must preserve

- The per-request credential handling in `PlatformConnection` (connection.py) stays as is.
  The detail we surface is a catalog or connection message, never a secret, so surfacing it
  is safe. Any new field must not become a channel for provider keys or auth headers.
- The resolve happens once per turn, up front. A resilience change must not move resolution
  into the model loop or change when secrets are resolved.
</content>

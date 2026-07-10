# Context

## The incident

Last night's QA run (E2 local, `pi_core`, Composio gateway tools) hit a committed agent
config that referenced the Composio action `github/COMMIT_MULTIPLE_FILES`. That action no
longer exists in the Composio catalog. The other four GitHub actions on the same config
resolved fine, and the connection was healthy.

Every turn on that config failed in about six seconds. The only thing the user saw was:

```
Gateway tool resolution failed (HTTP 404)
```

No mention of which tool broke, no mention that a specific tool was even the cause. The
run died before the model ran, so nothing happened.

The failing trace is `ac4459f96920599d49a710f2c92ed764`. `POST /api/tools/resolve` returned
`404 {"detail": "Action not found: composio/github/COMMIT_MULTIPLE_FILES"}`. The response
body named the dead action precisely. The user never saw that sentence.

This is QA finding F-019, and it reproduces the two problems that issues #5173 and #5174
describe from a separate self-hosted incident (a Slack agent whose
`DOWNLOAD_SLACK_FILE` tool 404s at resolve time).

## The two problems

**1. The failure is opaque.** The backend produces a precise error and puts it in the HTTP
response body. The SDK reads only the status code and throws the body away. The run error,
and therefore the UI, shows a bare `HTTP 404`. A user cannot tell which tool is at fault or
why. Diagnosing the incident required backend access: reading the saved config out of
Postgres and probing each action slug against Composio by hand.

**2. Resolution is all-or-nothing.** The agent's whole tool set resolves together. One
unresolvable tool fails the entire resolution, so the agent cannot run at all, even though
its other tools are valid. One stale action disables the whole agent.

## Why it matters

Composio catalog drift is routine. An action that was valid when an agent was built can
disappear later. Today that bricks the committed agent with an unactionable error, and the
only recovery is backend surgery. Both problems compound: the run fails completely, and the
one message that would let a user fix it is hidden.

## The relationship to #5174

Issue #5174 is the root cause of how a dead action reaches a committed config in the first
place: Agenta's discover path and its resolve path ask Composio about tools under different
implicit toolkit-version scopes, so discovery can surface a tool that resolve and execute
cannot find. That is a real and separate fix (validate-on-discover, version pinning).

This workspace handles the symptom, which is needed regardless of #5174. Even with discover
and resolve perfectly aligned, a committed agent still rots when Composio removes an action
during the agent's lifetime. Symptom-handling is not optional. See `design.md` decision D3.

## Goals

- The run error names the failing tool and the real reason, end to end, from the API
  response body through the SDK exception to the run error the UI shows.
- One unresolvable tool does not, by itself, take down an agent that has other working
  tools, where the failure is a genuinely-absent action.
- The fixes land at the right layer. Error surfacing and run-time policy live in the SDK
  and the resolve contract, not in core-API special cases for specific tools.

## Non-goals

- Fixing the discover-versus-resolve version drift itself. That stays with #5174.
- A general retry or circuit-breaker for provider outages. This is about a tool that is
  permanently gone, not a flaky provider.
- Building the full config-level tool-health UI. This workspace scopes it and defers it
  (design.md D2, option C).
</content>

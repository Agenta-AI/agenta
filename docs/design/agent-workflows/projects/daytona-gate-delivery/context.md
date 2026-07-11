# Context

## What breaks

A Pi agent on Daytona hangs on its first builtin tool call. Chat-only turns work. A call
to bash, read, edit, write, grep, find, or ls waits until the 300-second run limit kills
the turn. The user sees no approval prompt and no tool result.

The QA matrix recorded the failure as F-018. It reproduced in the playground in sessions
`fd02cd78` and `7ec8186b` and in the captured E3 bash run `f61a67f8...`.

## Why it matters

Daytona can run conversation-only agents but not tool-using Pi agents. It also breaks the
build-kit default agent because that agent begins by reading its skill. When the model
obeys the instruction, the first turn stalls.

## Corrected mechanism

The Pi extension calls `ctx.ui.confirm` for each granted builtin. Pi emits an
`extension_ui_request`. Local runs start the repo-pinned `pi-acp` 0.0.29 adapter, which
converts that event into ACP `session/request_permission`. The Daytona snapshot inherits
`pi-acp` 0.0.23 from `rivetdev/sandbox-agent:0.5.0-rc.2-full`. That older adapter ignores
the extension UI event because the bridge did not land until `pi-acp` 0.0.28.

The request therefore disappears before the HTTP transport. Ordinary `session/update`
events still work because version 0.0.23 supports them. This explains the exact symptom:
the runner sees the tool call but never logs `[HITL] pi-gate`.

The Daytona preview proxy is not the source of the failure. It never receives a permission
request to forward.

## Goals

- Pin the Daytona Pi adapter to the same version the local runner uses.
- Prove allow, deny, and ask behavior on a fresh Daytona sandbox.
- Keep one ACP permission plane for local and Daytona.
- Preserve live approval continuation through `respondPermission`.
- Preserve cold approval through durable decisions and call reissue.
- Detect future snapshot adapter drift during the snapshot build.
- Bound and explain any remaining delivery failure instead of waiting 300 seconds.

## Non-goals

- A new file-based permission protocol unless the adapter parity fix fails its focused
  transport test.
- Moving allow or deny policy into the sandbox before latency measurements justify it.
- Adding Pi MCP delivery or enabling Claude gateway tools on Daytona. Those are separate
  forward-delivery capabilities.
- Changing the public agent configuration or approval policy schema.
- Replacing the Daytona preview proxy.

## Constraints

- The snapshot recipe inherits private ACP adapter installations from its base image.
  Installing only the standalone Pi CLI does not update `pi-acp`.
- `sandbox-agent` prefers its private adapter launcher under
  `/home/sandbox/.local/share/sandbox-agent/agent_processes/`. A global npm install alone
  is not a reliable fix.
- A live permission continuation exists only while the sandbox, adapter process, ACP
  connection, permission id, and prompt promise remain alive.
- Stopping or recreating a sandbox destroys that continuation. The cold path must use a
  durable human decision and a reissued call. A file relay cannot keep a dead process
  alive.

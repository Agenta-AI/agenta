# The OpenCode adapter

OpenCode is the third harness on the local sandbox. It exercises the same ports as Claude
Code but has two differences the implementation must respect.

Read the [architecture](../architecture.md) and [ports and adapters](../ports-and-adapters.md)
pages first.

## Credential

OpenCode uses plain provider keys. The managed credential is `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` — whichever provider the selected model belongs to. No additional
variable is required.

**No OpenCode Zen.** Zen is a third-party hosted gateway. The daemon's Zen layer
(`opencode/*` ids, `OPENCODE_COMPAT_PROXY_URL`) is gated behind an experimental flag
and disabled ("disabled until ACP Phase 7"). The integration does not use it and no Zen
key is ever set.

## Model selection

OpenCode accepts models from both `anthropic` and `openai` as `provider/model`-prefixed
ids (e.g. `anthropic/claude-sonnet-4-5`, `openai/gpt-4o`). The capability table publishes
the Agenta vault model list prefixed by provider for each supported provider.

## Plan mode is off

The daemon skips `session/set_mode` for OpenCode. This is verified in the daemon binary:
`const te = k==="opencode"; if(!te && O.agentMode) … session/set_mode`. The static
capability fallback in `capabilities.ts` reflects this (`planMode: false` for the
`opencode` harness id) so the frontend never offers a mode OpenCode cannot honor. The
probe is authoritative when available.

## Native ACP-over-SSE

OpenCode is not driven through a `-acp` stdio shim. The daemon has dedicated JSON-RPC
methods (`_sandboxagent/opencode/status`, `_sandboxagent/opencode/message`) and an
internal ACP SSE translation task. From the runner's perspective this is transparent:
`createSession({ agent: "opencode" })` is the only call site.

## Tools

OpenCode reports `mcpTools` capability (probed from the daemon; the static fallback also
sets it). Tools are delivered over the internal `agenta-tools` MCP channel when
`mcpTools` is true, same as Claude. A run that carries tools but the capability is absent
fails loud via `assertRequiredCapabilities`.

## Daemon auto-install

The daemon downloads OpenCode from the GitHub release binary zip
(`anomalyco/opencode`, which is the official OpenCode organisation — not a fork) and
installs it on the local path on first use. No template setup is required for the local
sandbox.

## What is deferred

The following are out of scope for this local-first implementation:

- **Architecture gotcha (arm64/x64)**: on remote arm64 sandboxes the daemon's
  `install_opencode` downloads the linux-x64 binary. The workaround (overwrite with the
  correct-arch build after install) is a template-side concern and deferred to the
  remote/Daytona matrix-fill.
- **Node version requirements**: OpenCode's pinned Node version may conflict with the
  remote sandbox image. Deferred to the remote matrix-fill.
- **Daytona/remote opencode**: out of scope for this branch.

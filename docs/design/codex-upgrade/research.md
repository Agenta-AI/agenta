# Codex upgrade for GPT-6.1 Sol: research

Date: 2026-10-01. Branch: `feat/codex-gpt-6.1-sol`, based on `release/v0.121.7`.

## Why the upgrade

The ChatGPT backend refuses GPT-6.1 Sol to the Codex CLI the runner pinned:

```
codex-cli 0.156.1
ERROR: {"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}
```

The model needs a newer Codex CLI. Codex reaches the runner through the Codex ACP adapter
(`@agentclientprotocol/codex-acp`), which bundles its own Codex CLI, so the adapter is the pin
that moves.

## Versions

| Package | Before | After | Notes |
|---|---|---|---|
| `@agentclientprotocol/codex-acp` | 1.13.1 | 2.1.1 | Newest stable on 2026-10-01. 2.0.0 is the major. |
| `@openai/codex` (bundled by the adapter) | 0.156.1 | 0.159.3 | The adapter asks for `^0.159.1`; 0.159.3 is the newest stable. |

Each 2.x release depends on `@openai/codex`:

| codex-acp | bundled Codex range |
|---|---|
| 1.13.1 | `^0.156.1` |
| 2.0.0 | `^0.158.0` |
| 2.0.1, 2.1.0, 2.1.1 | `^0.159.1` |

2.1.1 is the newest release and the only one that carries the fixes for readable service errors
and for attachments in imported session history. 2.0.1 and later all bundle the same Codex line.

### Codex CLI 0.156.1 to 0.159.3

Release notes saved at `~/codex-upgrade-evidence/codex-cli-release-notes.md` on the dev box.
What matters to Agenta:

- 0.157.0 adds GPT-6 Sol and Luna to the bundled catalog. 0.159.2 adds GPT-6.1 Sol and makes it
  the default model.
- 0.158.0 turns on terminal input approval by default for commands that run with elevated
  permissions. The runner's sandbox mode never runs commands elevated, and the live shell tests
  below raised no new prompt.
- 0.158.0 removes the bundled `plugin-creator` skill. The runner's platform guidance names only
  `skill-creator` and `skill-installer`, which are still bundled.
- No change to the `auth.json` layout or to the `config.toml` keys the SDK renders
  (`model`, `model_provider`, `model_providers`, `approval_policy`, MCP servers). The live run
  below used the operator's existing ChatGPT `auth.json` through the same symlink the runner
  makes.

## ACP differences between codex-acp 1.13.1 and 2.1.1

The 2.0.0 breaking change is "AIR tool call contract, exact diff patches" (codex-acp #530). AIR
is the JetBrains client. The adapter now builds every tool call report through one renderer and
gives AIR clients a richer contract. Clients that are not AIR, which includes sandbox-agent,
get "the reports of the adapter before the contract", with the differences below.

The evidence is a frame-by-frame capture of both adapters on the same prompts, driven over
stdio with the same `initialize` payload sandbox-agent sends (no client capabilities). Both
adapters had the runner's approval and usage patches applied. Probe, raw frames and summaries:
`~/codex-upgrade-evidence/probe/` on the dev box (`probe.mjs`, `out-*.jsonl`, `sum-*.txt`).

| Area | 1.13.1 | 2.1.1 | Runner impact |
|---|---|---|---|
| `initialize` | `authMethods` `api-key`, `chat-gpt`; `loadSession: true` | Same | None |
| Session modes | `read-only`, `agent`, `agent-full-access` | Adds `workspace-write`. `read-only` is now truly read-only. `_meta.kind` is sent only to AIR. | None. The runner offers the same three modes and never reads `_meta.kind`. |
| Model option | Values are bare ids | Same. GPT-6.1 Sol is listed first for a ChatGPT login. | None. `setModel("gpt-6.1-sol")` succeeds. |
| Default `reasoning_effort` | `medium` | `low` for GPT-6.1 Sol | None. Codex picks it per model. |
| Shell command output | `rawOutput: {formatted_output, exit_code}` and the same text in `_meta.terminal_output_delta` | Output only in `_meta.terminal_output_delta` chunks. The close carries no `rawOutput` for a terminal command, and only `{exit_code}` for a list or read command. | **Breaks tool results.** The tracer read only `rawOutput`, so every shell result would store and stream empty, and a failed `ls` would read `{"exit_code":2}`. Fixed: the tracer now collects the chunks (see below). |
| MCP tool call | `rawInput: {server, tool, arguments}`, `rawOutput: {result, error}`, `_meta.is_mcp_tool_call` | Same, but the closing update no longer repeats `rawInput` | None. The tracer keeps the input from the start frame. |
| MCP approval | `session/request_permission` with `_meta.is_mcp_tool_approval: true`, options `allow_once`, `allow_session`, `allow_always`, `cancel` | Same ids and kinds. The options lose their `_meta.permission` descriptions. | None. The runner reads the flag and option kinds, not the descriptions. |
| Exec and edit approvals | `toolCall.rawInput.command` on exec, `locations` on edit, `_meta.permission` title | Same, minus `_meta.permission` | None |
| File edit | `content: [{type: "diff", oldText, newText, path}]` plus AIR diff stats in `_meta` | Same diff content, no AIR `_meta` | None |
| Usage | `PromptResponse.usage`, `usage_update {used, size}`, `_meta.quota` | Same | None. Both patch anchors bind once, with the same counts. |
| MCP startup failure | Failed `tool_call` with id `mcp_startup.<server>.<uuid>` and title `mcp__<server>__startup` | Same | None |
| Auth failure | `-32000` with the provider message in `data` when auth was configured | `-32000 "Authentication required"` with no `data` (codex-acp #550) | None. The runner's auth classifier already matches "authentication required". |
| `available_commands_update` | Commands carry `_meta.commandAction` | No `_meta` | None. The runner does not read it. |

## The runner's patches still apply

Both patches in `services/runner/src/engines/sandbox_agent/codex-acp-patch.json` bind exactly
once on 2.1.1:

- The approval patch: the `agent-full-access` preset still hardcodes `approvalPolicy: "never"`.
  Upstream issue codex-acp#310 is still open.
- The usage patch: `handleTokenUsageUpdated`, both `lastTokenUsage = null` resets, and the four
  `buildPromptUsage(sessionState.lastTokenUsage)` calls are unchanged.

The unit test fixture for the approval patch is now the 2.1.1 `AgentMode` section, verbatim.

## Where the pins live

| File | What it pins |
|---|---|
| `services/runner/package.json` (`runtimeAgentPins`) | The recorded versions |
| `services/runner/docker/Dockerfile.dev`, `Dockerfile.gh` | `install-agent codex --agent-process-version`, then an exact version assertion |
| `services/runner/images/sandbox/daytona/build_snapshot.py` | `CODEX_ACP_VERSION`, used for the Daytona snapshot |
| `services/runner/images/sandbox/daytona/test_build_snapshot.py` | The expected pin |
| `services/runner/config/sandbox-recipe.json` | The recipe version, which names the Daytona snapshot |
| `services/runner/images/sandbox/daytona/sandbox-recipe-fingerprint.json` | The fingerprint of the recipe inputs |
| `sdks/python/agenta/sdk/agents/capabilities.py` (`CODEX_MODELS`) | The models the Codex harness offers |
| `sdks/python/agenta/sdk/agents/data/codex_models.curated.json` | The Codex catalog entries |

The API's `SUBSCRIPTION_PROVIDER_MODELS` in `api/oss/src/core/secrets/enums.py` lists the
models the hosted ChatGPT connection drives through Pi. It already carries GPT-6.1 Sol from
#7252, and that connection does not serve the Codex harness, so it needs no change.

## Findings outside the ACP diff

- **The adapter pin floats inside its caret range.** `install-agent codex --agent-process-version X`
  writes `"^X"` into the adapter's `package.json`. 1.13.1 happened to stay put because the next
  release was a major. With 2.1.1, a later 2.x release would install silently. The Daytona recipe
  already asserted the exact version; the runner images now do too.
- **The base branch's runner lockfile was broken.** #7230 (undici 8.10.2) and #7252 (Pi 0.99.1)
  merged in an order that left the lockfile pointing at `undici@8.10.0`, which it no longer
  declares, so `pnpm install --frozen-lockfile`, and therefore the runner image build, failed on
  `release/v0.121.7`. Regenerating the lockfile removes the stale entry and changes nothing else.
- **The sandbox recipe fingerprint was already stale.** #7252 changed `PI_VERSION` without
  regenerating `sandbox-recipe-fingerprint.json` or bumping the recipe version, so the
  fingerprint test failed on the base branch. This change moves the recipe again, so it bumps the
  recipe version to 2 (snapshot `agenta-agent-sandbox-v2`) and regenerates the fingerprint.
- **The HOME-override trap is unchanged and does not bite the tested path.** PR #6924 (still open)
  describes a cold adapter install that hangs when `HOME` is overridden, because the daemon then
  looks for the adapter under the new `HOME`. This branch does not contain #6924's seed code.
  The deployment below keeps the image's `HOME=/home/node`, so the daemon finds the baked 2.1.1
  adapter. A deployment that overrides `HOME` still hits the trap until #6924 lands. Its seed
  copies whatever is baked, so it will seed 2.1.1 without changes.
- **The native `bin/codex` the daemon downloads is not the one that runs.** codex-acp runs its
  bundled Codex unless `CODEX_PATH` is set, and the runner never sets it.

## Live verification (2026-10-01)

A full EE dev stack built from this branch, with the ChatGPT subscription login mounted into the
stack's own runner (`CODEX_HOME`, read-write, image `HOME` kept). The runner image reported
codex-acp 2.1.1, bundled Codex 0.159.3, and both patches applied.

- Release gate cell S2 (Codex, local sandbox, mounted ChatGPT login) on `gpt-6.1-sol`: chat,
  tool, approve, deny, commit, warm, cold1 and cold2 pass. The same cell on `gpt-6-sol` passes
  every journey except cold2, which was not run there. `mount` and `park` skip on this cell by
  design.
- Shell turn through the product endpoint: the tool result carries the command's output on both
  models. With the tracer fix reverted, the same turn returns an empty tool result.
- Traces: the chat span names the model, and the cost matches the catalog prices. On
  `gpt-6.1-sol`, 6,336 input, 30,592 cached and 64 output tokens cost $0.0163712. On
  `gpt-6-sol`, 10,074 input, 34,304 cached and 64 output tokens cost $0.0276488.
- Pi regression on the same stack (cell S1, ChatGPT login through Pi): chat, tool and approve
  pass on the default model, and chat and tool pass on `gpt-6.1-sol`.
- Browser: a new agent defaults to Codex with GPT-6.1 Sol. The model picker lists GPT-6.1 Sol
  first under Codex. A chat turn that runs a shell command completes and shows the command's
  output.

The release gate's `tool` journey only recognized a shell call named `bash`, so it could never
pass on Codex, which names a shell call after its command. The journey now also accepts a call
whose input carries a `command` string.

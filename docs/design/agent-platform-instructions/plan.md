# Plan

## SDK composition

Create `sdks/python/agenta/sdk/agents/platform_instructions.py` with a short Agenta
base, the existing gateway guidance, and one composition function. Join the base and
applicable gateway text with a blank line. Keep the existing gateway wording and its
sorted integration names.

The base tells the agent that it operates through Agenta, should use the documented
tools and skills it receives, and must not invent tool results. It does not introduce
a personality or claim permissions that the runtime has not granted.

All supported SDK adapters populate the same internal optional string:

```text
platformInstructions?: string
```

For example, an agent with no gateway connection receives the common base. An agent
with a GitHub connection receives the same base followed by the existing connected
integrations guidance. Its authored `agentsMd`, `systemPrompt`, and
`appendSystemPrompt` values remain unchanged on the wire.

Replace the SDK's `GatewayGuidance` wrapper and `gateway_guidance_field` helper with
this string. Leave bundled skill content in its current module. The old `pi_agenta`
configuration already resolves to Pi and needs no separate implementation.

## Runner delivery

Use the existing composition point in `buildRunPlan`:

| Harness | Existing delivery used for SDK text |
| --- | --- |
| Pi | Before the authored append-system text |
| Claude | Before author text in the rendered `CLAUDE.md` |
| Codex | Before author text in the rendered `AGENTS.md` |

The runner chooses the channel from the harness instead of receiving a carrier
choice from the SDK. Keep runner-owned environment guidance and its existing
file/native delivery unchanged. Do not add a second composer or adapter protocol.

For Claude and Codex, the rendered file contains SDK text, then author text, then
the existing fenced environment guidance. Pi keeps SDK text before the authored
append text and retains its existing environment guidance delivery. Claude's native
mount appendix also stays unchanged. Environment guidance does not consume or
repeat the SDK field.

## Refresh behavior

Preserve the behavior of today's `gatewayGuidance`: compose generated text when an
environment is built, and keep it fixed while that environment is warm. The next
ordinary environment build picks up new text. Generated text stays outside the
configuration fingerprint and lifecycle facets, just as gateway guidance does today.
Adding an integration must not start rebuilding warm sessions again.

Author instruction changes continue through their existing lifecycle rules. This
cleanup makes no new promise about refreshing instructions in resumed native
conversations. It does not add a digest or persist instruction metadata.

## Rollout

1. Deploy runner support for `platformInstructions` first. Retain the old
   `gatewayGuidance` input for SDKs still using it. Prefer the new field when present,
   so a request carrying both does not duplicate guidance. An explicitly empty new
   field suppresses the old field. For legacy requests, consume `text` once and
   derive delivery from the harness, ignoring the old `carrier` hint.
2. Deploy the SDK that emits only `platformInstructions`.

Keep the temporary compatibility read at the runner boundary; do not maintain two
SDK composition paths. Remove that read once deployed SDKs no longer send the old
field. No API or database deployment is needed.

## Implementation and verification

1. Add runner input and delivery support using the current run-plan code. Check old
   SDK requests still work and each harness receives platform text once.
2. Move SDK text into the new module, populate the field in each adapter, and remove
   the old SDK wrapper. Update the mirrored wire schemas and existing golden fixtures.
3. Run the SDK adapter/wire suites and runner unit/type checks. Reuse existing tests
   to cover author-text preservation, gateway guidance, and unchanged warm-session
   identity. Do not add a test suite that only repeats the composition function.
4. Run focused live QA against the changed SDK and runner for Pi, Claude, and Codex:
   a fresh run, an unchanged continuation, and an authored instruction. Check gateway
   discovery where a configured integration is available. Record unavailable cells
   rather than treating them as passes.

The finished change should leave one SDK home for platform text, one runner
composition point, and fewer SDK types and helpers to maintain.

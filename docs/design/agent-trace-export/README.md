# Runner-owned trace export for agent runs

Agent runs send OpenTelemetry traces to Agenta. Today two different pieces of code build and
send those traces, and one of them runs inside the agent sandbox and therefore needs an Agenta
credential in there. This workspace designs a single path where the runner builds and sends
every span, and no Agenta credential ever enters a sandbox.

## Reading order

| File | Answers |
| --- | --- |
| `README.md` (this file) | What breaks today, what the words mean, what we are and are not trying to fix. |
| `design.md` | The target architecture, the harness-to-runner span record contract, and why each option won. |
| `plan.md` | The ordered pull requests, the tests, the rollout, and the risks. |
| `open-questions.md` | The calls that need the owner. |

## Words used in these files

**Runner.** The `services/runner` Node service. It receives a `/run` request from the Agenta
API, starts a sandbox, drives the harness, and streams events back. It runs on Agenta
infrastructure and is trusted.

**Harness.** The coding agent program that actually talks to a model: Pi, Claude Code, or
Codex. It runs inside the sandbox.

**Sandbox.** The isolated place the harness runs in. Two placements exist. A **local**
sandbox is a child process on the runner host. A **Daytona** sandbox is a remote container the
runner reaches over the Daytona API. Sandbox code is untrusted: a prompt injection can make the
harness read any file or environment variable the sandbox process can reach.

**Pi extension.** A JavaScript bundle the runner installs into Pi's agent directory
(`services/runner/src/extensions/agenta.ts`). Pi loads it and it subscribes to Pi's in-process
lifecycle hooks. It runs inside the sandbox.

**ACP event stream.** The Agent Client Protocol notifications (`session/update`) that the
sandbox-agent daemon sends the runner while a turn runs. Every harness produces them. They
carry message chunks, tool calls, tool results, and usage.

**Relay directory.** A per-conversation scratch directory both the runner and the in-sandbox
process can reach, used as a file channel between them
(`services/runner/src/engines/sandbox_agent/run-plan.ts:644`). The runner reaches it with plain
filesystem calls on a local sandbox and with Daytona filesystem API calls on a Daytona sandbox.
The abstraction over that split is `RelayHost` (`services/runner/src/tools/relay.ts:227-261`).

**Span record.** The new thing this design introduces. A single JSON line the harness writes
describing one finished unit of work (a turn, a model call, a tool call). It carries no trace
id, no span id, no endpoint, and no credential.

**Run credential.** The short-lived `Secret ...` token the Agenta API mints for the caller and
the SDK puts on the `/run` request. The runner uses it to call the Agenta API as the caller. It
expires in 15 minutes (`api/oss/src/middlewares/auth.py`, `_SECRET_EXP`).

## What happens today

Where a span comes from depends on which harness and which sandbox placement a run uses. One
line decides it, `services/runner/src/engines/sandbox_agent/run-turn.ts:293`:

```ts
emitSpans: !plan.isPi || plan.isDaytona,
```

`plan.isPi` is true when the harness is Pi (`run-plan.ts:487`). `plan.isDaytona` is true when
the sandbox placement is Daytona (`run-plan.ts:488`). The resulting split:

| Harness | Placement | Who builds spans | Who sends them | Credential inside the sandbox |
| --- | --- | --- | --- | --- |
| Pi | local | The Pi extension, inside the sandbox | The Pi extension, inside the sandbox | Yes |
| Pi | Daytona | The runner, from the ACP event stream | The runner | No |
| Claude Code | local or Daytona | The runner, from the ACP event stream | The runner | No |
| Codex | local or Daytona | The runner, from the ACP event stream | The runner | No |

The local Pi row is the odd one, and it is also the richest. The extension hooks Pi's
`before_provider_request` and gets a real `chat <model>` span per model call, with the provider
name, the request model, the response model, the response id, the finish reason, and per-call
token and cost numbers (`services/runner/src/tracing/otel.ts:810-843`). It hooks
`turn_start` and `turn_end` and gets real turn boundaries (`otel.ts:795-874`). The runner's
ACP-derived tracer builds the same tree shape from `session/update` notifications
(`otel.ts:1140-1160`), but it only knows what the ACP stream reports, so the model call is
inferred rather than observed.

### Consequence 1: a credential has to live inside the sandbox

Because the extension sends the spans itself, it needs a bearer token for Agenta's OTLP
endpoint. The runner writes one into the sandbox. On `main` it writes it once, at environment
setup, to a mode 0600 file next to the relay directory
(`services/runner/src/environment/runtime-lifecycle.ts:215`,
`services/runner/src/engines/sandbox_agent/pi-assets.ts:552-563`). The path, not the value, is
passed as the environment variable `AGENTA_AGENT_OTLP_AUTH_FILE`
(`pi-assets.ts:491-496`). The extension reads the file once and deletes it
(`services/runner/src/extensions/agenta.ts:66-81`).

The file trick exists because putting the bearer in an environment variable would be worse. The
code says so at `pi-assets.ts:468-473`:

> The OTLP bearer is deliberately NOT placed in `OTEL_EXPORTER_OTLP_HEADERS` (or any other
> plain env var): that env is inherited by the harness process, so a prompt-injected sandbox
> could read/echo the caller's reusable Authorization bearer and impersonate the caller.

A 0600 file is better than an environment variable. It is still a reusable Agenta credential
sitting on a disk the model can be talked into reading.

### Consequence 2: long turns lose their traces

The run credential lives about 15 minutes. A turn can last hours. The extension reads the
bearer once, at startup, and holds it. `services/runner/src/tracing/otel.ts:769-777` pins the
export target when the run's root span starts, and the export happens at the end of the turn.
On a turn longer than the token's life, the token is expired when the export runs and Agenta
rejects the batch.

The same expiry hits the runner's own export path. `createSandboxAgentOtel` captures the
credential as a string at turn start (`otel.ts:1204`) and `registerRunTarget` freezes it for the
whole run (`otel.ts:1138-1148`). So Daytona Pi, Claude, and Codex lose long-turn traces too,
for the same reason, without any sandbox being involved.

### Consequence 3: sandbox-exported spans skip the runner's redaction

The runner seeds a redactor per run from the request's typed secret values and the mount
credentials, and applies it to every span attribute right before export
(`run-turn.ts:283-290`, `otel.ts:172-205`). The in-sandbox extension builds
`createAgentaOtel` with no `redactor` at all (`extensions/agenta.ts:489-498`). So the one path
that exports from inside the sandbox is also the one path whose spans are never checked against
the run's known secret values.

### Consequence 4: two code paths to keep in step

Every span attribute, every tree change, and every content-capture rule has to be written twice,
once in `createAgentaOtel` (`otel.ts:675-925`) and once in `createSandboxAgentOtel`
(`otel.ts:1153-1748`). They already differ.

## What pull request 6135 tried, and why it was rejected

Branch `fix/otlp-per-turn-credential`, 5 commits, 27 files. It attacked consequence 2 by
refreshing the credential rather than by moving the export.

Two mechanisms:

**A per-turn credential refresh into the sandbox.** The runner rewrote the 0600 file at the top
of every turn with that turn's bearer (`refreshOtlpAuthFile`, `pi-assets.ts:565-583`, called
from `run-turn.ts:263-271`). The extension re-read it on Pi's `before_agent_start` hook and
assigned it onto the live export config (`createOtlpAuthRefresher`, `extensions/agenta.ts:84-104`,
registered at `extensions/agenta.ts:500-511`).

**A second, narrower token.** The API grew a token scope,
`TRACE_INGEST_SCOPE = "trace-ingest"` (`api/oss/src/middlewares/auth.py:92`), confined to the
single path `/otlp/v1/traces` by `_SCOPE_ALLOWED_PATHS` (`auth.py:97-99`) and enforced in
`verify_secret_token` (`auth.py:921-940`). `GET /access/permissions/check` minted one on every
call and returned it in a new `telemetry_credentials` response field
(`api/oss/src/apis/fastapi/access/router.py:151-164`, `:27-40`) with a two hour default life
(`AGENTA_OTLP_TOKEN_TTL_SECONDS`, `api/oss/src/utils/env.py:360-365`). The SDK carried it
through `TracingContext.telemetry_credentials` and onto the wire as
`telemetry.exporters.otlp.exportAuthorization` (`sdks/python/agenta/sdk/agents/dtos.py:441`,
`sdks/python/agenta/sdk/agents/wire_models.py:196-198`). The runner chose between the two
tokens with `exportAuthorizationOf` (`runtime-policy.ts:31-38`).

The owner rejected it for three reasons.

1. **A turn can run for 12 hours.** Refreshing at the top of a turn does not help a turn that is
   still running when the token expires. The mechanism fixes the gap between turns, which was
   never the hard case.
2. **The refresh is a workaround, not a fix.** It keeps a credential inside the sandbox and adds
   machinery to keep that credential fresh, on both sides of the boundary, forever.
3. **The split ownership is the actual defect.** Two span builders, two export paths, and one
   sandbox that needs a token exist only because local Pi exports its own spans. Fix that and
   the credential problem disappears instead of getting managed.

Two changes on that branch are worth keeping and are independent of the rest: an `iat` claim on
every Secret token (`auth.py:1044`) and an `except HTTPException: raise` guard that stops a 401
from being turned into a 500 (`auth.py:973-976`). `plan.md` lands those separately.

## Goals

1. The runner creates and exports every span for every agent run. One code path.
2. Pi keeps owning span semantics. The runner does not go back to guessing the model call from
   the ACP stream. Where Pi knows the provider request boundary, the model, the tokens, and the
   tool arguments, that knowledge reaches the trace.
3. No Agenta credential of any kind enters a sandbox, on any placement, at any time.
4. A turn that runs for hours exports its trace with no credential ritual anywhere, and with no
   work inside the sandbox.
5. Local and Daytona use the same design and the same code. Placement changes the transport
   call, not the architecture.
6. The mechanism is reusable. When Claude Code or Codex gain a hook that reports something the
   ACP stream does not carry, the same channel accepts it with no new plumbing.
7. Every exported span passes the runner's redactor.

## Non-goals

1. **Changing the trace schema Agenta ingests.** Span names, `openinference.span.kind` values,
   and `gen_ai.*` attributes stay exactly as they are today. A trace produced after this change
   must look like a trace produced before it, on the local Pi path, plus the parts Daytona Pi
   was missing.
2. **Renaming `telemetry.exporters.otlp.headers.authorization`.** The run credential rides the
   telemetry block on the `/run` wire, which is poor layering (`runtime-policy.ts:10-17`). That
   is a separate contract migration touching four files and two contract tests, and it does not
   help this problem. `open-questions.md` records it.
3. **Changing how the Agenta API ingests spans.** `POST /otlp/v1/traces` is unchanged.
4. **Live streaming of spans during a turn.** Spans still reach Agenta in one batch when the
   turn ends, as they do today on every runner-exported path.
5. **Touching the legacy SDK Daytona runner** (`sdks/python/agenta/sdk/engines/running/runners/daytona.py`),
   which injects `AGENTA_CREDENTIALS` into a sandbox on a different code path. Goal 3 is scoped
   to the runner-driven sandbox path. `open-questions.md` records the overlap.

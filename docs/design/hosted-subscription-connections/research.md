# Code research

## Existing subscription execution

The connection resolver already maps `self_managed` to `runtime_provided` without adding a model
credential to the request. `services/runner/src/engines/sandbox_agent/run-plan.ts` rejects such a
run unless the corresponding harness mount exists. It also rejects subscription use on Daytona.

Codex subscription runs assemble a per-session `CODEX_HOME`, link only `auth.json` to the operator
mount, and let Codex write refreshes back to the real login. Native session files remain in the
durable session working directory. SQLite files stay on local disk because the mounted object store
does not support write-ahead logging.

Claude Code uses the mounted `CLAUDE_CONFIG_DIR` directly. Pi uses its mounted agent directory for
subscription mode. Managed API-key mode creates a run-local Pi directory and does not copy the
operator login when a model connection is present.

Relevant files:

- `sdks/python/agenta/sdk/agents/connections/resolver.py`
- `services/runner/src/engines/sandbox_agent/run-plan.ts`
- `services/runner/src/engines/sandbox_agent/codex-assets.ts`
- `services/runner/src/engines/sandbox_agent/environment-setup.ts`
- `services/runner/src/engines/sandbox_agent/pi-assets.ts`

## Existing health reporting

`services/runner/src/subscription-status.ts` checks only that an expected login exists and has a
usable shape. `services/oss/src/agent/runtime_status.py` calls the private runner endpoint and
returns a reduced public state. The frontend already queries and renders this state. This is a
local file check. It does not prove that the provider accepts the credential.

Relevant files:

- `services/runner/src/subscription-status.ts`
- `services/oss/src/agent/runtime_status.py`
- `web/packages/agenta-entities/src/workflow/api/subscriptionStatus.ts`
- `web/packages/agenta-entities/src/workflow/state/subscriptionStatus.ts`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`

## Current routing limit

`AGENTA_RUNNER_INTERNAL_URL` selects one runner for the entire deployment. The run request selects
a sandbox provider but does not carry a server-owned runner connection. A cloud product therefore
cannot route two customers to separate authentication homes on separate runners.

Relevant files:

- `services/oss/src/agent/config.py`
- `services/oss/src/agent/app.py`
- `sdks/python/agenta/sdk/agents/handler.py`
- `api/oss/src/core/sessions/streams/runner_client.py`

## Existing connection work

The provider-connections plan already proposes stable connection slugs, several accounts per
provider, saved model lists, harness compatibility, and selection across agents, prompt runs, and
evaluators. Hosted subscriptions should extend that connection identity. They should not create a
parallel model picker or a second provider catalog.

Reference: `docs/design/provider-connections-models/`.

## Provider login interfaces reviewed September 7, 2026

### ChatGPT through Codex

Codex has a machine-readable login interface. `codex app-server` accepts JSON-RPC over standard
input and output. A client starts device authorization with `account/login/start` and
`type = "chatgptDeviceCode"`. Codex returns a login ID, verification URL, and one-time user code.
It later emits `account/login/completed` and `account/updated` notifications.

Codex owns the provider exchange, stores the tokens, and refreshes them during use. File-backed
credentials live in `auth.json` under `CODEX_HOME`. The server can force file storage with
`cli_auth_credentials_store = "file"`. The authentication home must remain writable because a
refresh can replace the cached credential.

This gives Agenta a stable control interface. Agenta should run the official Codex binary in a
private authentication worker and relay only the verification URL, one-time code, expiry, and
sanitized completion state to the browser. Agenta does not need to implement OpenAI's private OAuth
exchange or parse terminal text.

Official sources:

- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#auth-endpoints
- https://learn.chatgpt.com/docs/auth
- https://github.com/openai/codex/blob/main/sdk/python/docs/getting-started.md

### SuperGrok through Grok Build

Grok Build supports refreshable device authorization on headless machines through
`grok login --device-auth`. It prints a verification URL and one-time code. Grok stores local user
state under `GROK_HOME`, or `~/.grok` when `GROK_HOME` is unset. The public enterprise guide refers
to the active session credential as `auth.json` and states that cached tokens refresh silently.

After login, `grok agent stdio` exposes Agent Client Protocol over JSON-RPC. This fits the runner's
existing ACP adapter model, but Agenta does not yet list Grok as a harness.

The public Grok documentation does not describe a machine-readable API for starting or observing
the device login itself. It documents only the interactive command and human-readable output.
Before implementation, Agenta should ask SpaceXAI for one of these supported contracts:

1. A structured login command or local RPC that returns the verification URL, user code, attempt
   ID, expiry, polling interval, completion, and error.
2. A registered Agenta OAuth client and the documented RFC 8628 endpoints that Agenta may call.
3. A documented and versioned terminal-output contract for `grok login --device-auth`.

If none exists, the first version can pin one Grok CLI release and parse its terminal output behind
a provider adapter. This must remain an explicit compatibility dependency with an end-to-end login
test before every CLI upgrade.

Official sources:

- https://docs.x.ai/build/enterprise#authentication
- https://docs.x.ai/build/cli/reference
- https://docs.x.ai/build/cli/headless-scripting
- https://x.ai/news/grok-opencode

## Authentication storage conclusion

The browser should never upload `auth.json`. Each connection should own an opaque writable
authentication home on Agenta-controlled encrypted storage. The login worker and the selected
runner mount that same home. The official provider process writes and refreshes the files in place.

The mount is not a normal project secret. A vault secret is usually a value that Agenta injects
into a process. An authentication home is a small provider-owned filesystem whose schema and files
can change across client versions. Agenta should encrypt and back up the directory as an opaque
unit, but it should not parse, rewrite, or expose its token fields.

## Tool isolation findings

Codex app-server accepts a per-turn sandbox policy with restricted readable roots. The app-server
can keep `CODEX_HOME` outside those roots while the turn receives access to the agent workspace.
This is a promising technical boundary, but Agenta must test the exact runner and operating-system
combination because the current local runner does not enforce its own declared filesystem policy.

Grok's built-in `strict` sandbox restricts reads to the current working directory and system paths.
However, the documented profiles keep `~/.grok` writable so Grok can persist sessions. Grok allows
a custom sandbox profile with explicit denied paths. Agenta must verify that denying the
authentication home blocks model-started tools without preventing the parent Grok process from
refreshing its token.

Official sources:

- https://learn.chatgpt.com/docs/app-server#sandbox-read-access-readonlyaccess
- https://docs.x.ai/build/features/sandbox

## Main conclusion

Agenta does not need one persistent sandbox per customer. It needs one durable authentication home
per connected account and a runner that can mount that home for the selected harness. Sessions can
continue using separate durable working directories and separate runtime processes. The mounted
design remains conditional on proving that model-started tools cannot read the authentication
home.

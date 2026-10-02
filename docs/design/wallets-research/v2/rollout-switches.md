# Rollout switches

Status: implemented on `wallets/rollout-switches` (step 1.1 of the wallet release plan).

Two PostHog feature flags turn the LLM gateway and the wallet on one organization at a time.
They are read only when `AGENTA_ROLLOUT_FLAGS_ENABLED=true`. The environment variables
`AGENTA_LLM_GATEWAY_ENABLED` and `AGENTA_WALLETS_ENABLED` stay the master switches. With a
master switch off, its flag is not read and nothing changes.

The code is one module: `api/oss/src/core/rollout/switches.py`. It answers two questions:
`llm_gateway_enabled_for(organization_id)` and `wallet_mode_for(organization_id)`.

## `llm-gateway-rollout`

The payload is a JSON list of organization ids:

```json
["0199a1b2-0000-7000-8000-000000000001", "0199a1b2-0000-7000-8000-000000000002"]
```

With `AGENTA_LLM_GATEWAY_ENABLED=true`, only the listed organizations use the LLM gateway.
The API refuses every other organization with `llm_gateway_disabled` on each LLM gateway
surface: the `/gateways/llms/*` routes (`/resolve` included), the relay and the model
listing. The agent SDK already reads that code as "resolve the model
from the vault", so an organization outside the list keeps the direct path it had before
the gateway. The SDK and the runner need no new setting.

The LLM credential exchange (`POST /gateways/credentials`, plane `llm`) checks only the
master switch. The SDK asks for a credential only after `/resolve` admitted the
organization, and two API processes can briefly hold different payloads. A refusal there
would fail the run instead of falling back to the vault. The relay still checks the list on
every call.

One exception: a built-in model (the `builtin` namespace, paid by the platform) has no vault
key. The SDK refuses it rather than silently switch who pays, so an agent that picked a
built-in model fails for an organization outside the list. Before you remove an
organization, make sure its agents use a model from its own provider keys.

## `wallets-rollout`

The payload is a JSON object that maps an organization id to a mode:

```json
{
  "0199a1b2-0000-7000-8000-000000000001": "shadow",
  "0199a1b2-0000-7000-8000-000000000002": "enforce"
}
```

With `AGENTA_WALLETS_ENABLED=true`:

| Mode | Admission | Measurement and charge |
| --- | --- | --- |
| `off` (also any organization not in the payload) | Not checked. Every call is admitted. | None. |
| `shadow` | Checked, never refused. A refusal that `enforce` would make is logged as `[wallets] shadow: would have refused`. | Every call is measured and charged in the ledger. |
| `enforce` | Today's behaviour: refused at or below the floor. | Every call is measured and charged. |

The mode applies at each admission point: the LLM gateway spend admission
(`WalletSpendAdmission`), the managed-tools executor (`WalletManagedActionBilling.admit`) and
the runner's sandbox admission route (`POST /wallets/sandboxes/admit`). It also applies at
each measurement producer: the gateway usage sink, the sandbox usage route and the
managed-tools record. For an `off` organization, the sandbox usage route answers 200 with
`measurement_id: null`, so the runner does not report the interval again.

In `shadow`, a wallet that is slow (more than 1 second) or cannot answer also admits. The
1-second wait does not include the cancellation of the abandoned check, so a slow database
cleanup cannot push the answer past the 2-second admission bound.

## Shared behaviour

- **Cache.** Each API process keeps each payload for 30 seconds. When it is older, the
  process still answers from it at once and refreshes it in the background, one refresh per
  flag at a time. The refresh reads the shared `posthog:flags` Redis cache (also 30 seconds)
  and asks PostHog only on a miss. A payload edit applies within about a minute. A payload
  older than 5 minutes (a process with no traffic) is not served; the caller waits for the
  refresh as a new process does. Only those callers wait: at most 0.5 seconds, then they
  read "off", and that "off" is kept until the refresh lands. The gateway usage sink and
  the managed-tools record never wait: they read the payload their admission left, however
  old, so a call that streams for longer than 5 minutes is still measured. This keeps the
  lookup out of the 0.5-second measurement hand-off and inside the 2-second admission
  bounds.
- **PostHog unreachable or malformed.** The answer is "off": the gateway is off and the
  wallet is off, and a warning or error is logged. The PostHog client returns "no payload"
  when it cannot reach PostHog, so "unreachable" and "no payload" give the same answer. A
  failed lookup is kept for the same 30 seconds, so an outage costs one request per process
  per flag every 30 seconds. A process that already read a payload keeps it through failed
  refreshes for up to 5 minutes (the stale limit), and only then reads "off".
- **A malformed entry.** An entry that is not an organization id, or a mode that is not
  `off`, `shadow` or `enforce`, is dropped and logged. The other entries still apply.
- **`AGENTA_ROLLOUT_FLAGS_ENABLED`** (default `false`). The flags are read only when it is
  `true`. When it is `false`, the environment switches decide alone: the gateway serves
  every organization and the wallet enforces for every organization, as before this
  change. It is an explicit switch, not "a PostHog key is set", because the example env
  files ship a shared PostHog key. A self-hosted deployment would otherwise read Agenta's own
  payload and lose the gateway for every organization. Set it to `true` only on a deployment
  that publishes the two flags in its own PostHog project.
- **Targeting.** The flags are evaluated for one fixed distinct id. Roll each flag out to
  100% of users in PostHog. The payload, not the targeting, carries the rollout.

## Pairing the two flags

The flags are independent. An organization in `llm-gateway-rollout` whose wallet mode is
`off` uses built-in (platform-funded) models without a charge, the same as
`AGENTA_WALLETS_ENABLED=false` today. Put an organization in `shadow` or `enforce` before or
together with adding it to the gateway rollout.

Managed tools exist only while `AGENTA_WALLETS_ENABLED` is on. An `off` organization can use
them without a charge. Today the only providers are the mocks, so this costs nothing. Before
a real managed provider ships, decide whether `off` must refuse managed actions instead.

## How to turn back

- One organization: remove it from `llm-gateway-rollout` (it goes back to the vault path;
  its agents on a built-in model then fail, see above), or set its wallet mode to `off` or
  `shadow`. The change applies within about a minute.
- Everyone at once: empty the payload (everyone goes to the vault path and wallet `off`),
  or set `AGENTA_LLM_GATEWAY_ENABLED=false` or `AGENTA_WALLETS_ENABLED=false` and restart
  the API. Setting `AGENTA_ROLLOUT_FLAGS_ENABLED=false` instead turns the gateway and the
  wallet `enforce` on for every organization, so it is not a way back.

Charges that are already measured stay in the ledger. Turning an organization `off` does not
undo them.

## Decisions

- **The rollout is decided in the API, not in the SDK or the runner.** The gateway refusal
  that the SDK already understands carries the per-organization answer, and the wallet
  routes the runner already calls answer per organization. Neither needs a new setting.
- **An explicit `AGENTA_ROLLOUT_FLAGS_ENABLED`, not "a PostHog key is set".** The OSS example
  env files set the shared PostHog key, so the key cannot tell the two kinds of deployment
  apart.
- **No PostHog call on the request path.** The first version looked the payload up inside
  the request, bounded at 1.5 seconds. A review found that this could cancel a measurement
  inside its 0.5-second hand-off bound (a lost charge), and could make a `shadow` admission
  time out inside its 2-second bound (a refusal). Serving the last payload while one refresh
  runs removes both. Later review rounds added the 5-minute stale limit, the kept "off" after
  a cold timeout, the shadow wait that does not wait for cancellation, and the
  never-waiting read for the two measurement producers that follow their own admission. The shared Redis
  cache stays, under the in-process copy, so several API
  processes ask PostHog once between them.
- **Fail-safe "off", with a 5-minute last-known-good.** The PostHog client gives the same
  answer for "no flag" and "unreachable", so a last-known-good fallback cannot tell an outage
  from a deleted flag. **Changed 2026-10-03 (release review, finding W04):** this was "no
  last-known-good". Without one, a failed refresh between a call's admission (`enforce`) and
  its measurement turned the wallet `off` and dropped a charge already spent on our provider
  account. Options: carry the admission's mode through every call (gateway, managed tools,
  and the runner's per-minute sandbox reports, which are separate requests), or keep the last
  payload for a bounded time. Chosen: keep it for the existing 5-minute stale limit, one
  place for every producer. Cost: deleting a flag's payload takes up to 5 minutes to apply;
  editing it to `{}` or `[]` still applies within the TTL.

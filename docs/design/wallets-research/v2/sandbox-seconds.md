# Wallets: billing sandbox seconds

Every second a sandbox runs on the platform's own Daytona account costs wallet credit. This
page is the design of that first slice: what is measured, how it reaches the wallet, what it
costs, and what it leaves out. It sits behind `AGENTA_WALLETS_ENABLED` (EE only). With the flag
off, nothing is measured and nothing is charged.

## Decisions

These were made by the owner before the work started.

1. **Wallet only.** Each running second is charged to the wallet. There is no included
   allowance yet. This deliberately differs from
   [include-sandbox-usage](openspec/changes/include-sandbox-usage/), which puts included
   seconds first. That change stays the follow-up. See
   [spec-divergences.md](spec-divergences.md) row 23.
2. **Price is Daytona's list price times 1.5**, by resource, not by named size.
3. **Only running seconds are billed.** A stopped or parked sandbox is not billed, although
   Daytona bills its disk.
4. **At the floor, a new turn is refused before it starts; a running turn is never stopped.**
5. **Never measured:** the `local` provider, self-hosted deployments, and OSS.

## Price

Daytona list price, read from daytona.io/pricing on 2026-09-26, billed per second:

| Resource | Daytona | Ours (x 1.5) |
| --- | --- | --- |
| vCPU | $0.0504 per hour | 75,600 musd per vCPU-hour |
| Memory | $0.0162 per GiB-hour | 24,300 musd per GiB-hour |
| Disk | $0.000108 per GiB-hour past 5 free GiB | not charged |

Disk is not charged: our sandboxes use 5 GiB, which is inside Daytona's free 5 GiB.

A live sandbox from our snapshot (`agenta-agent-sandbox-v1`) reports 2 vCPU, 4 GiB of memory
and 5 GiB of disk (read through the Daytona SDK on 2026-09-26). The runner reads the size of
each sandbox from Daytona rather than assuming it. It falls back to 2 vCPU and 4 GiB only when
Daytona does not answer.

One minute of that sandbox:

```text
vcpu_seconds       = 60 x 2 = 120
memory_gib_seconds = 60 x 4 = 240
charge = ceil((120 x 75,600 + 240 x 24,300) / 3600) = 4,140 musd
```

That is $0.2484 an hour: Daytona's $0.1656 for 2 vCPU and 4 GiB, times 1.5. The rates live in
`api/ee/src/core/measurements/rate_card.py` with their source and date, and they are part of
the rate card's version hash, so every debit names the prices it was charged at.

## How it works

```text
runner --admit--> API /wallets/sandboxes/admit --> WalletsService.check
runner --usage--> API /wallets/sandboxes/usage --> streams:measurements
                                                     -> MeasurementWorker (prices SBX)
                                                     -> streams:debits -> DebitWorker
```

### Measuring

The runner measures the sandbox from outside it. The sandbox is never asked anything. There
are two kinds of sandbox on our account, and both are metered:

- The `daytona` provider's agent sandbox. It is metered from the moment the runner asks for it
  until it is parked or deleted. Warm time between turns is running time, so it is billed.
- The `inprocess` provider's command sandbox. It is metered from each bring-up until it
  stops, is retired, or is deleted. The meter reports with the credential of the newest run
  that holds the sandbox.

Every minute the meter cuts one interval of whole seconds and reports it. When the sandbox
stops, it cuts the final partial interval. A runner that crashes loses at most the minute in
progress. Bounds are floored to whole seconds, so consecutive running periods of one sandbox
never overlap; at most one second per running period is not billed.

### Reporting

The runner posts each interval to `POST /wallets/sandboxes/usage`, authenticated with the run's
own platform credential. The runner gets no Redis or database access. The API takes the
organization, project and user from that credential, never from the report, and publishes one
`MeasurementCommandV1`:

| Field | Value |
| --- | --- |
| `gateway_kind` | `sbx` |
| `measurement_id` | `sbx:{project_id}:{provider}:{sandbox_id}:{start_epoch_second}` |
| `resource_key` | `sbx:daytona` |
| `resource_locator` | `provider`, `sandbox_id`, `vcpu`, `memory_gib` |
| `endpoint_kind` | `builtin` (platform-funded, like a `builtin` gateway call) |
| components | `sandbox_seconds`, `vcpu_seconds`, `memory_gib_seconds` |
| `references.session.id`, `agent_id` | the session and the agent, when known |

The measurement id is deterministic, and the stored fingerprint ignores `created_at`. A report
the runner sends twice is therefore the same measurement, stored once and charged once. The
project is part of the id, so one tenant cannot collide with another tenant's interval. No
envelope field or port shape changed; the SBX branch in `calculate_charge` and the three
component keys are the only additions to pricing.

The runner keeps an interval the platform did not take (a network failure, 401, 403, 408, 429
or 5xx) and sends the same bytes again on the next tick, holding at most three hours of
intervals. A stopping meter retries for five seconds before it gives up and logs the seconds it
lost. A 422 means the report can never be accepted, so it is dropped and logged. A 404 means the
platform does not meter sandboxes, and the meter goes quiet.

Riding the existing 30-second session heartbeat was considered and rejected. The heartbeat
belongs to a session-owned turn in OSS, while a sandbox outlives turns (warm and parked
sandboxes, command sandboxes shared by several runs) and must be metered in EE only. A
separate one-minute timer per sandbox is simpler to reason about.

### Admission

Before a turn on `daytona` or `inprocess` starts, the runner asks `POST
/wallets/sandboxes/admit`, which answers the same spendable check the gateway uses for a
`builtin` call. Only an explicit `allowed: false` refuses the turn. The runner then emits an
error with the code `wallet_balance_exhausted` and the message "Your Agenta credits are used
up, so this turn did not start. Add credits to keep going." No sandbox is acquired. A 404 (the
wallet off, or OSS), an error, or no answer admits the turn: a metering outage must not stop
agents. A turn that is already running is never stopped for its balance, so a turn admitted
near the floor can settle below it, as a gateway call can (open-designs items 2 and 17).

Both routes are mounted only while the wallet is on. Neither needs a permission beyond the
credential, because a report can only charge the caller's own organization.

### Usage view

Sandbox charges appear under "Sandbox" in the Usage (debug) tab, grouped by session like model
calls. Each expanded row shows the seconds, vCPUs and GiB of memory of its interval.

## Not measured, and known gaps

- **Stopped and parked sandboxes.** Daytona bills their disk. Only running seconds are billed
  in this slice.
- **Boot and stop time for the command sandbox** before bring-up finishes and after the stop
  begins is partly unbilled. The agent sandbox is metered from the moment it is requested.
- **A runner killed without a shutdown** loses the minute in progress. A sandbox it leaves
  running keeps running until Daytona's auto-stop (15 minutes idle), and that time is not
  billed.
- **A platform outage longer than three hours** loses the oldest intervals, and a teardown
  during an outage loses what it could not send in five seconds. Both are logged.
- **No run credential.** A run whose trace destination is not Agenta has no platform
  credential, so its sandbox is neither admitted nor metered. Cloud runs always carry one.
- **The runner CLI** (`src/cli.ts`, a local development tool) does not admit or meter.
- **Admission reads the balance once per turn.** Nothing is reserved.
- **Self-reported.** Anyone holding a run credential can post an interval, but it can only
  charge their own organization.

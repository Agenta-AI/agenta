# Online redaction filter — tasks

> Companion to `specs.md`. Work-packages (WPs) grouped into phases. **One branch for now** — the WP
> boundaries are drawn so that *if* the phasing proves out, a WP can later be lifted into its own
> worktree with no re-cutting. Each WP notes its **level** (SDK / services / runner) and whether it is
> **do-now** or gated. The whole filter is **do-now** (independent of the deferred stateless-per-turn
> spine); the phases are about sequencing risk, not deferral.
>
> Effort tags: Very Low · Low · Medium · High. No time estimates.
>
> **The line that governs the whole plan: ship known-value, defer everything else.**
> The **known-value** pass is the only one we can turn on blind — we hold the exact credential/secret
> strings, so it has **zero false positives**, and a real vault value appearing verbatim in a user's
> message/file *is itself a leak* we want gone (there is no legitimate case for the literal secret in
> prose). Every other pass (credential-shape, token-shape, entropy) can redact something the user
> **legitimately wants to see** — an `sk-`-shaped string a user pasted deliberately, a high-entropy hash
> in a returned message, a token in a file the agent produced. That is not a tuning nuisance; it is
> "we mangled a user asset." So the shape/entropy passes are **follow-ups gated behind a defined
> opt-in** (Phase 3) that must specify *which sinks* they run on and *which asset classes are never
> touched*. Phase 0 + Slice 1 below are **known-value only**; the shape/entropy passes are all of Slice 2.

---

## Phase 0 — Redactor core, known-value only (the shared primitive)

The one thing everything else depends on. Build it once per runtime, prove it in isolation, ship
nothing user-visible yet. **Only the known-value pass is implemented in this phase** — the
`Redactor` is structured so the shape/entropy passes can be added later (Slice 2) without changing
its shape, but they are not built here.

- **WP0.1 — SDK `Redactor` (Python), known-value pass.** Level: SDK. Effort: Medium.
  Implement the `Redactor` (`redactString`/`redactJson`/`redactError`/`withKnownSecrets`) in
  `sdks/python/agenta/sdk/…/redaction/` with **the known-value pass only**: exact-match against the
  per-request deny-set, including raw/URL-enc/base64 variants and the decomposed parts of compound
  credentials. `[ag:redacted:{kind}:{last4}]` placeholder (bare `[ag:redacted]` where the sink can't
  carry the suffix); fail-safe on throw. Leave clearly-marked
  extension points (`_shapePass`, `_entropyPass`) as no-ops for Slice 2. Unit tests for the
  known-value pass. No wiring.
- **WP0.2 — Runner `Redactor` (TS), known-value pass.** Level: runner. Effort: Medium.
  Mirror WP0.1 in `services/runner/src/…/redaction.ts`. Same known-value pass, same placeholder,
  same fail-safe, same no-op extension points.
- **WP0.3 — Golden parity fixtures (known-value).** Level: SDK + runner. Effort: Low.
  Shared golden inputs → expected redactions for the known-value pass, asserted by BOTH runtimes
  (mirror the wire-contract golden pattern). Locks SDK and runner to identical behavior.
- **WP0.4 — `AGENTA_REDACTION_MODE` env.** Level: services. Effort: Very Low.
  Add the knob to `api/oss/src/utils/env.py`, but with only **two live values for now**:
  `off | known` (default `known` everywhere — it is safe by construction). Reserve `pattern | full`
  as **declared-but-inert** so Slice 2 activates them without a schema change; a config set to
  `pattern`/`full` today logs a warning and behaves as `known`.

**Exit:** a known-value redactor exists both sides, byte-identical on the goldens, gated by
`AGENTA_REDACTION_MODE`, touching no live path.

---

## Phase 1 — Slice 1: known-value at EVERY sink + the full setup (do-now, the whole shippable filter)

**This is the whole first slice: the known-value pass, wired at every sink, plus the seeding that makes
it work.** The gate in this plan is the **pass** (known-value vs shape/entropy), NOT the sink. So Slice 1
does not phase the sinks — it covers **all** of them (error, records, spans, logs) in one slice, each as
a work-package, all with known-value only. It's safe to do them all at once precisely because known-value
has zero false positives: a value only gets redacted if it's a *known live secret*, so it can't mangle a
message/file/mount even when it rides through one. Seeding + all four sinks land together.

- **WP1.1 — Seed the deny-set (runner).** Level: runner. Effort: Low.
  At run start build the per-run deny-set from `secrets`, applied provider keys, run credential, STS
  token + key pair; decompose compound credentials (`daemon.ts`, `mount.ts`, `persist.ts`).
- **WP1.2 — Seed the deny-set (SDK/services).** Level: SDK + services. Effort: Low.
  At handler entry build the per-request deny-set from the resolved connection/secret set
  (`platform/resolve.py`) + the request credential; hand it to the SDK `Redactor`.
- **WP1.3 — Sink: caller-facing errors.** Level: runner + SDK + services. Effort: Low.
  Wire `redactError` into: `server.ts:269-271,358-360` (before it hits the wire `error`),
  `wire.py:sanitize_runner_error` (extend — stack-strip THEN redact), the services HTTP error
  responses, and litellm `AuthenticationError` (`handlers.py:1055`). *Highest exposure — reaches the
  browser today.*
- **WP1.4 — Sink: stream records (durable).** Level: runner. Effort: Medium.
  `redactJson` in `persist.ts:buildPersistingEmitter.emit` before the ingest POST. Covers all three
  workflow kinds' persisted events. (Coalescing stays; redact the coalesced payload.)
- **WP1.5 — Sink: spans / traces.** Level: runner + SDK. Effort: Medium.
  `redactJson` before span write in `otel.ts` (`setInputs`/`emitMessages`/tool-arg capture) and in the
  SDK tracing decorators. **Closes SEC-4** — capture stays on, but the exact resolved secret values are
  scrubbed from what's written.
- **WP1.6 — Sink: logs (stderr).** Level: runner. Effort: Very Low.
  `redactString` in the runner `log()` helpers; `redactError` on the stderr `unhandledRejection`/
  `uncaughtException` dumps (`server.ts:417,422`).
- **WP1.7 — `redactions_total{sink,kind}` metric.** Level: SDK + runner + services. Effort: Low.
  Count redactions per sink/kind; **never log the matched value**. This lives in Slice 1 on purpose:
  it does not depend on the shape/entropy passes, and it is the **evidence the control operates** — the
  operating-effectiveness signal a SOC 2 Type II or ISO 27001 (A.8.15/A.8.12) audit asks for. A control
  that runs silently is hard to evidence; this makes Slice 1 self-contained for those audits so
  compliance never becomes a reason to build Slice 2.

**Order within the slice:** seeding (1.1–1.2) is the prerequisite; then the sinks (1.3–1.6) are
independent of each other and can go in any order or in parallel (1.3 first if sequencing by exposure).
The metric (1.7) rides on whichever sinks are wired — increment it wherever a redaction fires.

**Exit (the slice ships when all of this holds):** on every V0 workflow, a planted **real resolved**
secret appears in **none** of the four sinks — error response, persisted record, span, log — while a
deliberately-pasted `sk-`-shaped string that is **not** a resolved secret passes through **untouched**
in all four. That converse is the proof we redact leaks, not user content. This is the entire do-now
deliverable; nothing shape/entropy ships until Slice 2's opt-in is agreed.

---

## Phase 2 — Slice 2: shape/entropy passes behind a defined opt-in (FOLLOW-UP, gated)

**Do not start this until the opt-in below is designed and agreed.** The shape/entropy passes are the
ones that can redact a user asset (a deliberately-pasted key-shaped string, a high-entropy hash in a
returned message, a token inside a file the agent produced). Turning them on is a product decision
about acceptable false-positive risk, not a hardening detail — so the *first* work-package here is to
define the opt-in, not to write regexes.

- **WP2.0 — Design the opt-in mechanism (do this first, no code).** Level: SDK + services. Effort: Low.
  Define, in this doc, before any pass ships:
  - **The flag.** Activate `AGENTA_REDACTION_MODE = pattern | full` (declared-but-inert since WP0.4).
    Default stays `known`; `pattern`/`full` is an explicit operator choice.
  - **The sink allow-list — which sinks the shape/entropy passes may run on.** Proposal: **operator-only
    sinks** (runner/stderr logs, spans/traces — seen by operators, not returned to the caller) get the
    passes; **caller-facing/durable-content sinks** default to **known-value only even under `full`**,
    because that is where a mangled asset is visible to the user.
  - **The never-touch asset classes — content the passes must skip regardless of mode.** Explicitly:
    **returned messages, files, and mount paths/contents.** These are things the user asked for and
    wants to see. Even under `full`, a shape/entropy pass never rewrites a message body, a file the
    agent emitted, or a mount path — only known-value applies there. This is the guarantee that makes
    `full` safe to offer at all.
  - **The escape hatch.** How a user marks a specific field "do not redact" (and, conversely, how an
    operator marks a field "always entropy-scan"), so a false positive has a remedy that isn't
    "turn the whole feature off."
- **WP2.1 — Credential-shape + token-shape passes.** Level: SDK + runner. Effort: Medium. *Gated on WP2.0.*
  Implement the shape passes (DSN userinfo, auth headers, cookies, PEM, credential-named-key rule;
  `sk-`/`ghp_`/`AKIA…`/JWT/`Bearer` token regexes) into the extension points left in Phase 0. Apply
  **only on the sinks WP2.0 allows**, honoring the never-touch classes.
- **WP2.2 — Entropy pass + allow-list.** Level: SDK + runner. Effort: Medium. *Gated on WP2.0.*
  Enable the Shannon-entropy pass under `mode=full`; build the allow-list (hash/id shapes the product
  legitimately shows) from observed false positives on real traffic. Same sink/asset restrictions.
  Reuse the Slice-1 `redactions_total{sink,kind}` metric (WP1.7) as the over-redaction signal here — no
  new metric needed.
- **WP2.3 — (Separate deny-set) webhook/event payload sink.** Level: api/oss. Effort: Medium.
  Reuse the `Redactor` at the outbound dispatcher/delivery with an API-worker deny-set. **Coordinate
  with the in-flight `fix/redact-webhook-delivery-secrets` branch** — this WP may already be covered
  there; do not duplicate. Listed for completeness, not owned by this filter's core.

**Exit:** opt-in mechanism defined and agreed; shape/entropy passes live only where WP2.0 permits and
never on messages/files/mounts; false-positive rate observable via the metric; webhook sink either
delegated to the existing branch or covered here.

---

## Dependency order

```text
       ┌──────────────── ship this unit now: known-value at every sink ────────────────┐
       │                                                                                │
Phase 0 ──▶ Slice 1 (Phase 1): known-value pass wired at ALL sinks + deny-set seeding    │
(core,      │  WP1.1–1.2 seed ─▶ WP1.3 errors · WP1.4 records · WP1.5 spans · WP1.6 logs │
known-value)│                    (the four sinks are peers, not sub-phases)             │
       └────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                       ═══════ GATE: WP2.0 opt-in design + agreement ═══════
                                        │
                                        ▼
       Slice 2 (Phase 2): shape/entropy passes + webhook  ── FOLLOW-UP, gated
       (metric already shipped in Slice 1 — WP1.7)
```

**The gate is the pass, not the sink.** Slice 1 covers *every* sink at once (error/records/spans/logs)
— they're peer work-packages within the slice, safe to do together because known-value has no false
positives. Slice 2 is the *only* thing that waits, and it waits on the **WP2.0 opt-in**, not on a
schedule, because it's the part that can touch user content. Within Slice 1, seeding (1.1–1.2) precedes
the four sink WPs (1.3–1.6), which are mutually independent.

## If we later split into worktrees

Natural cut lines, should the phasing prove out: **Phase 0 (core+goldens, known-value)** as one branch
other work stacks on; **Slice 1** as the do-now branch on top (or, if it wants finer grain, one branch
for seeding + the four sinks together — do NOT split it *by sink*, since the sinks aren't a real
dependency boundary; split by runtime SDK-vs-runner if anything). **Slice 2** is a *separate* follow-up
branch that must not be cut until its opt-in is agreed, so it never rides along accidentally with the
known-value work. Decision deferred until the phases are validated.

## Open questions (resolve before/with implementation)

1. **Deny-set lifetime for warm sessions.** Today the deny-set is per-run; once warm session reuse
   lands (the deferred spine), it should be per-session and refreshed when secrets rotate. Note the
   coupling; don't build for it yet.
2. **The opt-in scope (WP2.0), before any shape/entropy code.** Which sinks may run the passes, and the
   never-touch asset classes (messages/files/mounts). This is a product decision, not a tuning one —
   answer it before Slice 2 starts.
3. **Entropy threshold + allow-list seed.** Needs real traffic (Slice 2) — start conservative, and only
   after the opt-in above is settled.
4. **Does the SDK tracing decorator already have a redaction seam** we should extend rather than add
   beside? Confirm during WP1.5 to avoid a parallel path.
5. **Webhook overlap.** Confirm what `fix/redact-webhook-delivery-secrets` covers so WP2.3 is delegate
   vs implement.

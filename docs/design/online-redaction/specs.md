# Online redaction filter — specs

> **Status: design-only.** This branch is docs-first: it carries the spec and the task plan so we can
> agree the phases and work-packages before touching code. If the decomposition proves out, individual
> work-packages may later become their own worktrees; for now it is one branch.
>
> Source proposal (audit): `big-agents-audit/online-redaction-filter.md`. That doc holds the narrative
> and the competitor comparison; this spec is the buildable contract.

---

## 1. Purpose

Add a **detective** redaction layer that scrubs **credentials and secrets** out of everything the
platform **stores or displays** on the V0 invoke path, right at the boundary where it leaves. It sits
*on top of* the existing **preventive** control (clear-then-apply provider-key isolation, which keeps
our own keys out of the wrong env) — prevention covers what we scope, redaction is the backstop for
everything prevention doesn't reach (user-supplied credentials, echoed secrets, stack traces, the
resolved secrets dict itself). Motivated by the HIPAA/SOC2 direction, where a secret written to a
log/span/record is a reportable data-handling failure.

## 2. Scope

**Applies to every built-in V0 workflow, not just the agent.** `agent_v0`, `completion_v0`, and
`chat_v0` (`sdks/python/agenta/sdk/engines/running/handlers.py:175`) share the `HANDLER_REGISTRY`
invoke/result boundary and all call litellm — a leaked litellm auth-error or a captured prompt is the
same exposure for a plain completion as for an agent.

Three levels, one shared capability:

| Level | Owns | Why here |
|---|---|---|
| **SDK** (`sdks/python/agenta/sdk`) | the `Redactor` itself + redaction at the boundaries every V0 workflow crosses (error parse, tracing/span write, record/event emission) | redact once → all three workflow kinds inherit it |
| **Services** (FastAPI host of the SDK engine) | seed the per-request **deny-set** from resolved credentials/secrets; redact HTTP error responses | this is where the exact secret values are known at request time |
| **Runner** (`services/runner`, Node) | TS-mirror of `Redactor` + redaction at `server.ts` error-to-wire, `persist.ts` records, `otel.ts` spans, stderr logs | the runner has its own sinks and its own copy of the resolved secrets |

**Explicitly out of scope:**
- **Sandbox level** — the sandbox is a content *source*, not a store/display sink we own; its output
  flows back through the runner (already covered). No insertion.
- **Outbound webhook/event payloads** in `api/oss` — a real leak surface but a *different* deny-set
  and owner (built in the API worker from a different source), and there is already an in-flight branch
  `fix/redact-webhook-delivery-secrets`. The `Redactor` is reusable for it; wiring that sink is a
  **follow-up**, not part of this filter's core.
- **Prevention** — clear-then-apply stays the primary control; this does not replace it.

## 3. What we protect (by origin, in this codebase)

- **Credentials** — the caller's **Agenta API key** (`ApiKey …` / `Access …`) presented on `/invoke`,
  re-used by the runner as the **run credential** to call back to the API (`services/runner/src/sessions/persist.ts:53`).
  Leak ⇒ an attacker acts as that caller.
- **Secrets** — everything resolved from the **vault** (`VaultConnectionResolver`,
  `AgentaNamedSecretProvider`, per `ModelRef`) or from **environment variables** (`AGENTA_STORE_*`,
  `AGENTA_CRYPT_KEY`, `AGENTA_AUTH_KEY`, applied provider keys `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/…,
  the per-turn STS token + access/secret key pair). These ride the `secrets` dict on the wire
  (`services/runner/src/protocol.ts:411`) and get applied into the run env (`daemon.ts:75-107`).

"Credentials and secrets" throughout means exactly these two, by origin.

## 4. Threat model — sinks (where a value gets stored or displayed)

Ranked by exposure. Redaction is applied **at the sink**, so each is a discrete insertion point and no
upstream code path can forget to redact.

| # | Sink | Location | Level | Exposure |
|---|---|---|---|---|
| 1 | Caller-facing error → wire/HTTP | `server.ts:269-271,358-360` (raw `err.stack`); `wire.py:sanitize_runner_error` (extend); services HTTP error responses; litellm `AuthenticationError` `handlers.py:1055` | runner + SDK + services | **reaches the browser today** |
| 2 | Stream records (durable) | `persist.ts:buildPersistingEmitter.emit` before POST to `/sessions/records/ingest` | runner | persisted forever |
| 3 | OTel spans / traces | `otel.ts:433,877` (`captureContent` default true); SDK tracing decorators that write inputs/messages/tool-args | runner + SDK | tracing backend + anyone with trace access |
| 4 | Logs (stderr) | `server.ts:417,422` raw `.stack`; `[sessions/persist]`/relay logs | runner | operator logs, log aggregation |

## 5. The Redactor (contract, mirrored SDK-Python + runner-TS)

Same shape both sides — same discipline as the wire contract (`protocol.ts` ↔ `wire.py`), pinned by
shared golden fixtures.

```
Redactor
  .withKnownSecrets(values: string[])   // per-request/run deny-set; also registers raw/url-enc/base64
                                        //   variants and the PARTS of compound credentials
  .redactString(s)  -> string           // known-value → credential-shape → token-shape → entropy
  .redactJson(obj)  -> obj              // deep walk; redact string leaves; redact any value under a
                                        //   credential-named key (password/secret/token/api_key/...) whole
  .redactError(err) -> string           // existing stack-strip THEN redactString
```

### Passes, in order (precision first, net last)

**Only pass 1 ships in the first cut.** Passes 2–4 are follow-ups gated behind a defined opt-in — see
§7.1. The `Redactor` is built with them as declared extension points so activation is a wiring change,
not a redesign.

1. **Known-value** *(ships now)* — exact match against the deny-set. Highest precision, **zero false
   positives**, and a real vault/credential value appearing verbatim in a user's message/file/log *is
   itself the leak we want gone* — there is no legitimate case for the literal secret in returned
   content. This is why known-value is safe on **every** sink, including caller-facing ones, without an
   opt-in. For compound credentials register the parts (the password inside a DSN, the secret half of a
   key pair, the `user:pass` inside a basic-auth header) and common encodings (raw/URL-enc/base64).
2. **Credential-shape** *(follow-up, gated — §7.1)* — structured credentials entropy misses: DSN
   userinfo (`scheme://user:pass@`), auth headers (`Authorization: Basic/Bearer`, `X-Api-Key`,
   cookies), PEM/SSH key blocks, and the **credential-named-key rule** (any JSON/query/env value whose
   *key* is `password`/`secret`/`token`/`api_key`/`access_key`/`private_key`/`client_secret`/
   `credential`/`authorization` → redact the value regardless of entropy).
3. **Token-shape** *(follow-up, gated — §7.1)* — high-confidence token regexes (`sk-…`, `ghp_…`, AWS
   `AKIA…`, JWT three-segment, `Bearer <token>`).
4. **Entropy** *(follow-up, gated — §7.1)* — last, only on long unbroken tokens above a Shannon-entropy
   threshold that survived the earlier passes, outside an allow-list (don't entropy-scan prose). The net
   for random secrets with no recognizable shape; conservative to avoid mangling legitimate high-entropy
   content (hashes, IDs).

**Why 2–4 are gated and 1 is not.** Passes 2–4 match on *shape*, so they can redact something the user
**deliberately put there and wants back** — an `sk-`-shaped string a user pasted, a high-entropy hash
in a returned message, a token inside a file the agent produced. Known-value can't: it only fires on a
string we *know* is a live secret. So the shippable filter is known-value everywhere; shape/entropy
waits for the opt-in in §7.1 that bounds *which sinks* they touch and names the asset classes they must
never touch.

### Replacement

Stable placeholder preserving debuggability without the value: `[ag:redacted:{kind}:{last4}]` (kind +
last 4 chars) where the sink can carry it, falling back to bare `[ag:redacted]` where it can't, so an
operator can correlate "which key" without seeing it. The `[ag:redacted` prefix is greppable and
unmistakably ours.

## 6. Seeding the deny-set (the highest-value, free layer)

At request/run start, the values are already in hand — seed exact-match from them:

- **Runner:** `Redactor.withKnownSecrets([...Object.values(secrets), ...appliedProviderKeys, runCredential, stsToken, stsAccessKey, stsSecretKey])`
  (`daemon.ts`, `mount.ts` sign, `persist.ts` auth). Decompose compound credentials.
- **SDK/services:** seed from the resolved connection/secret set (`platform/resolve.py` →
  `VaultConnectionResolver`, `AgentaNamedSecretProvider`) and the request credential, before the
  handler runs.

Because it's exact-match it redacts even when a value appears in an unexpected shape (echoed into
prose, split across a log line).

## 7. Controls & posture

- **On by default, fail-safe.** If the redactor throws, emit the placeholder / drop the value — never
  the raw string. A redaction bug must never *unmask*.
- **Known-value pass always on, everywhere.** It ships in the first cut on every sink with no opt-in,
  because it has zero false positives and never touches a value that isn't a known live secret.
- **`AGENTA_REDACTION_MODE = off | known | pattern | full`**, added to `api/oss/src/utils/env.py` per
  the env convention. **First cut activates only `off | known` (default `known`).** `pattern | full`
  are declared-but-inert until the §7.1 opt-in ships; setting them today warns and behaves as `known`.
- **Capture default stays true, but never un-redacted.** SEC-4's `capture_content=True` is fine *once
  known-value redaction runs first* — the finding is "capture without a scrubber," not "capture."
- **Auditability (SOC 2 / ISO 27001)** — a `redactions_total{sink,kind}` counter so a leak-spike is
  visible; **never log the matched value**. The count is the evidence the control *operates* — the
  operating-effectiveness signal a SOC 2 Type II or ISO A.8.15/A.8.12 audit asks for. **Ships in
  Slice 1** (it doesn't depend on the shape/entropy passes), so Slice 1 is self-contained as audit
  evidence and compliance never becomes a reason to build Slice 2.

### 7.1 The shape/entropy opt-in (why 2–4 are gated, and what activating them requires)

Known-value ships blind; shape/entropy do **not**, because they match on shape and can redact a user
asset the caller deliberately put there and wants back. Before any of passes 2–4 goes near a sink,
this opt-in must be designed and agreed:

- **The flag.** `pattern`/`full` is an explicit operator choice, never a default.
- **Sink allow-list — where the shape/entropy passes may run.** Default proposal: **operator-only
  sinks** (runner/stderr logs, spans/traces — seen by operators) get the passes under `full`;
  **caller-facing and durable-content sinks stay known-value-only even under `full`**, because that is
  where a mangled value is visible to the user.
- **Never-touch asset classes — skipped regardless of mode.** Explicitly **returned messages, files,
  and mount paths/contents.** These are exactly what the user asked for. Even under `full`, no
  shape/entropy pass rewrites a message body, an agent-produced file, or a mount path — only
  known-value applies to those. This guarantee is what makes offering `full` acceptable at all.
- **Escape hatch.** A per-field "do not redact" marker (and its inverse, "always entropy-scan"), so a
  false positive has a remedy short of disabling the feature.

Until §7.1 is settled, the filter is **known-value on every sink** and nothing else — which is the
whole of **Slice 1** (see tasks.md: Phase 0 core + Slice 1 wiring). Shape/entropy is **Slice 2**.

## 8. What this closes / does not close

**Closes with the known-value cut (Slice 1):** SEC-4 (span capture w/o redaction of the resolved
secret values), the online-redaction gap for *known* credentials/secrets, raw-stacks-to-wire
(`server.ts:269-271,358-360`), and the `secrets`-dict-on-wire exposure (deny-set scrubs it even if
logged/traced). This is the model's core value — we hold the exact strings, so we scrub them by value
at every boundary with no guessing and no risk to user content.

**Deferred to Slice 2 (gated on §7.1):** catching secrets that are *not* in the deny-set — a credential
the agent generated, a token shape we didn't seed. That needs shape/entropy, which needs the opt-in.

**Does not, ever:** it's detective, not preventive (a secret still transits memory); and it does **not**
stop a secret the agent *sends outbound itself* (an egress/tool-permission concern). Once Slice 2
lands, entropy still carries false positives — hence the §7.1 sink allow-list, never-touch asset
classes, and escape hatch, so the net never mangles a message/file/mount the user wanted.

**PHI is explicitly NOT in scope — do not cite this filter as HIPAA coverage.** This filter protects
**credentials and secrets by origin** (§3): things resolved from the vault, the environment, or the
`/invoke` credential. It is seeded from a **deny-set of values we hold**. PHI (patient names, MRNs,
DOBs, diagnoses) arrives as **user content** in prompts, messages, tool args, and files — it is never
in the deny-set, and even Slice 2 *deliberately exempts* returned messages/files/mounts (§7.1). So a
completion whose prompt contains PHI still writes that PHI verbatim to every sink; this filter does
nothing about it, **by design**. HIPAA's PHI-handling requirement is a **separate track** (content-aware
PHI classification/redaction, subprocessor BAAs, encryption at rest/in transit, PHI access + audit
logging, risk analysis) that neither slice addresses. This filter is a credential/secret control that
supports SOC 2 Confidentiality/CC6 and ISO A.8.12/A.8.15 — not a PHI control.

### Compliance boundary at a glance

| Framework | Slice 1 (+ WP1.7 metric) | Slice 2 |
|---|---|---|
| **SOC 2** (Confidentiality / CC6) | Self-contained, audit-evidenced control | Optional defense-in-depth, not required |
| **ISO 27001** (A.8.12 / A.8.15 / A.8.10) | Evidence for these Annex A controls | Optional; ISMS is the real deliverable |
| **HIPAA** | Not relevant — PHI is out of scope (above) | Not relevant — same reason |

## 9. Acceptance (how we know it works)

- **Unit (both runtimes):** each pass redacts its class; known-value redacts across encodings and
  compound parts; credential-named-key redacts a low-entropy `{"password":"hunter2"}`; entropy leaves
  allow-listed IDs intact; `redactError` strips stack *and* scrubs; fail-safe never returns the raw
  string on throw. Golden fixtures pinned SDK ↔ runner (like the wire contract).
- **Integration (the known-value cut):** a `completion_v0` and an `agent_v0` run whose input carries a
  planted **real resolved** secret → assert it appears in **none** of the sinks: the error response, the
  persisted record, the span, the log. And the converse — a deliberately-pasted `sk-`-shaped string that
  is **not** a resolved secret → assert it passes through **untouched** in all of them, proving we redact
  leaks, not user content.
- **Coverage note:** these are exactly the paths the current green suite does *not* exercise (no test
  plants a secret and checks the sinks) — so the acceptance tests are net-new, not overlapping.

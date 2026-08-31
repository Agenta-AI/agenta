# Daytona Secret propagation: the placeholder-401 incident and its instruments

Working notes for the 2026-08-29 finding on EU cloud production: a fresh sandbox's first
model call sometimes carries the raw `dtn_secret_<id>` placeholder instead of the real key,
because Daytona applies a new Secret's substitution rule asynchronously and gives no
completion signal. The model proxy refuses the placeholder with a 401, and the user used to
read "model authentication failed — add the project's OpenAI key", which was wrong on every
count.

## The measured facts (72h window, EU cloud prod)

- 7 placeholder 401s at the LiteLLM proxy (`Virtual Key expected. Received=dtn_****…`),
  each matching a failed runner turn, across 5 organizations.
- Every one was the FIRST outbound model call of a freshly created sandbox, 10–24 seconds
  after its Secrets were created. Substitution never failed mid-session.
- 4 of 7 had a destroy-plus-delete of the previous same-host Secret 14–61 seconds earlier
  (the eviction ordering: destroy sandbox → delete its Secrets → allocate new → create).
- Successful cold starts sit in the same age range (6–22s), so the lag is stochastic, not a
  fixed delay. Sibling measurement from 2026-08-09: value UPDATES on an existing Secret take
  15–18s to reach a running sandbox against the docs' "within seconds".

## The two hypotheses

- **H1, create lag**: the substitution rule for a new Secret + sandbox pair converges
  per-node in Daytona's egress layer, and the first call sometimes lands on a node that has
  not converged.
- **H2, delete interference**: deleting an older Secret for the same host while the new
  one propagates widens the window.

## Probe results (2026-08-30, production org, target eu) — CORRECTED

The first probe run concluded substitution was host-dependent ("a never-used host never
substitutes"). That was a measurement artifact: Daytona's egress proxy also performs
RESPONSE SCRUBBING — real values in responses are rewritten back to placeholders before
they reach the sandbox — so an echo service shows `dtn_...` whether or not substitution
happened. Proven by sending the literal real value in the header: the echo still read
`dtn_secret_...`. The correct instrument is a provider whose error body echoes a MASKED
key (api.openai.com: "Incorrect API key provided: sk-probe*****"), which scrubbing does
not rewrite.

With that instrument (20 fresh-Secret first-sandbox samples, production create shape,
target eu, 28 sandboxes total, all cleaned up):

- **15 of 20 sandboxes substituted on their FIRST request**, +1.5s to +2.9s after Secret
  creation — including brand-new hosts. Creation order and the delete-then-create eviction
  ordering do not matter.
- **5 of 20 never substituted at all** (raw placeholder for the full 90-180s watched, from
  the first request onward). The distribution is bimodal: no sample landed between 3s and
  180s. A twin sandbox created against the SAME Secret substituted at its first request
  while the stuck one stayed raw; stop+start did not repair it. One stuck sandbox returned
  an Envoy "upstream connect error or disconnect/reset before headers".

**Mechanism read:** a per-sandbox registration failure at create time, with no
reconciliation — not a propagation delay. Production's "10-24s after creation" was merely
when the first call happened; "only first calls fail" is survivorship (the 401 kills the
run and the sandbox is rebuilt). Today's stuck rate (~25%) is far above the ~3% in the
production log window, so the rate varies or the eu fleet was degraded on 2026-08-30.

Consequence for the runner: waiting does not help a stuck sandbox. The preflight must
REBUILD instead of waiting (see the instruments below).

## The instruments

- `services/runner/scripts/probe-secret-propagation.ts` measures the stuck-sandbox rate
  with the runner's own SDK calls, using the masked-echo instrument (api.openai.com's 401
  body; an echo service cannot work — response scrubbing blinds it). `--delete-old` adds
  the eviction ordering, which the 2026-08-30 runs showed is NOT a factor. Run it from an
  environment holding the runner's Daytona credentials; each run costs about one
  sandbox-minute.
- The runner now logs `[daytona-secrets] allocated/deleted n=… hosts=[…] ms=…` (counts,
  hosts, and timing only — never ids, names, placeholders, or values), so future incidents
  carry their own create/delete timeline instead of needing it reconstructed from eviction
  lines.
- A placeholder-shaped 401 classifies as `credential_delivery_failed`
  (`services/runner/src/engines/sandbox_agent/errors.ts`), with retry-flavored user copy.

## Daytona's answer (2026-08-31, their support; a fix PR is in progress on their side)

They confirmed the reproduction and gave operating guidance:

- "Substitution is not guaranteed on the first call. Some sandboxes never get wired;
  restart does not fix those. A new sandbox on the same Secret does."
- "If the provider logs dtn_secret_…, throw that sandbox away and create a new one.
  Retrying or restarting the same one will not help."
- "If a retry on the same sandbox starts working within ~30s, you can keep it. If the
  placeholder is still going out after that, recreate." (The ~30s keep-or-recreate bound
  is now the preflight's conviction budget.)
- "Keep one long-lived Secret; you don't need a new Secret per run." (A design
  consideration for us: today the runner creates and deletes Secrets per environment
  build. A long-lived Secret per project credential would cut that churn; rotation would
  then ride `secret.update`, which carries the separately measured 15-18s value lag.
  Queued, not urgent — the stuck fault is per-sandbox, not per-Secret.)
- They marked the wiring failure as priority and will report when their fix lands.

## The guard that does not wait for Daytona

The preflight (#6370): probe the fresh sandbox concurrently with acquire; convict as
stuck when the raw placeholder still echoes at Daytona's ~30s bound; destroy and rebuild
once. Tracked in the session todo list beside this
workspace.

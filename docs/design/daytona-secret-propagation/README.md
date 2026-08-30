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

## Probe results (2026-08-30, production org, target eu, our snapshot)

The probe ran from the production runner container with the runner's own key. The result
reframes the problem — substitution is HOST-dependent, not merely slow:

| Secret's allowed host | Outcome |
| --- | --- |
| gateway.eu.cloud.agenta.ai (used constantly by this org) | substituted on the FIRST request: +1.8s and +1.9s after Secret creation (2 of 2) |
| httpbin.org (never used by this org) | NEVER substituted: raw placeholder reached the server for 120s x3 (incl. ephemeral:false and the default image/target) and 300s x1 |
| postman-echo.com (never used) | NEVER substituted in 120s |

So a first-ever host may never get interception provisioned (at least within 5 minutes),
while a known host maps a NEW secret's value almost instantly — and the production 3%
(placeholder at t+10-24s on the known gateway host) is a separate, occasional lag on that
same value-mapping path, half-correlated with a same-host delete seconds earlier. The
delete-interference variant was deliberately NOT run against the gateway host from the
production org: if host interception state is shared org-wide, a probe delete could
disturb live users. That is now question 2 for Daytona.

## The instruments

- `services/runner/scripts/probe-secret-propagation.ts` measures both hypotheses with the
  runner's own SDK calls (create Secret → create sandbox → curl httpbin.org/headers until
  the echoed Authorization header shows the real value). `--delete-old` reproduces the
  eviction ordering. Run it from an environment holding the runner's Daytona credentials;
  each run costs about one sandbox-minute. Not yet run — the numbers above are from
  production logs, not this probe.
- The runner now logs `[daytona-secrets] allocated/deleted n=… hosts=[…] ms=…` (counts,
  hosts, and timing only — never ids, names, placeholders, or values), so future incidents
  carry their own create/delete timeline instead of needing it reconstructed from eviction
  lines.
- A placeholder-shaped 401 classifies as `credential_delivery_failed`
  (`services/runner/src/engines/sandbox_agent/errors.ts`), with retry-flavored user copy.

## Open questions with Daytona (asked in the shared Slack channel, 2026-08-29)

1. Is substitution guaranteed active for a sandbox created after its Secret? If not, what
   is the bound?
2. Does deleting a same-host Secret interfere with a newer one during propagation?
3. Is there a read-your-writes signal — any API that confirms a Secret is active?
4. The 15–18s update lag from 2026-08-09: same question.

## The follow-up that does not wait for Daytona

A bounded runner-side guard: when a turn fails with `credential_delivery_failed`, rebuild
the environment and retry the turn once. Tracked in the session todo list beside this
workspace.

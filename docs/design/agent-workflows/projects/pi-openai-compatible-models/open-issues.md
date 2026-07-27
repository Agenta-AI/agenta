# Open issues

Deferred TODOs and open questions for this project. Each entry carries enough context and
provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### Stat-guard the Daytona stale models.json cleanup for no-plan Pi runs

**Status:** open
**Added:** 2026-07-15
**Commit:** 277e48d9f0 (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** docs sync after the feature was implemented and end-to-end verified.

**The problem.** A Pi run that carries no model-config plan removes any stale `models.json` from
`DAYTONA_PI_DIR` before session creation. That cleanup is best-effort right now: it swallows the
delete error and continues. On a reused Daytona sandbox a leftover `models.json` from an earlier
custom run could then register a provider the current run did not ask for. A plan run overwrites
the file, so it is safe. The gap is only the no-plan case on a warm sandbox.

**Why it is deferred.** The end-to-end matrix passed, and a stale file only bites a reused sandbox
whose previous run was a custom endpoint. It is a hardening step, not a correctness fix for the
shipped happy path, so it was kept out of the first PR to keep the diff focused.

**What to decide or do.** Change the no-plan cleanup from best-effort to stat-guarded and terminal.
Stat the target path. If a `models.json` exists and the delete fails, fail the run rather than
continue on a possibly stale provider. Add a runner test that a no-plan run on a sandbox seeded
with a stale `models.json` either removes it or fails.

### Require apiBaseUrl at save time for a kind=custom connection

**Status:** open
**Added:** 2026-07-15
**Commit:** 277e48d9f0 (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** docs sync after the feature was implemented and end-to-end verified.

**The problem.** A `kind=custom` connection with no base URL is useless: the service rejects it at
run time with `EndpointResolutionError` (HTTP 422). The connection form
(`web/packages/agenta-entities/src/secret/core/providerFields.ts`) does not require `apiBaseUrl`
at save time, so a user can create a connection that can never run and only learns it when a run
fails.

**Why it is deferred.** The run-time guard already fails loud with an actionable error, so no run
routes to the wrong place. Moving the check to creation is a usability improvement, not a
correctness fix, and it touches the form validation rather than the run path this project owns.

**What to decide or do.** Make `apiBaseUrl` a required field for `kind=custom` in
`providerFields.ts` so an incomplete connection fails at save. Keep the run-time guard as the
backstop. Add a form test that a custom connection with no base URL cannot be saved.

### Add an engine-level test that an incomplete applicable request yields ok:false

**Status:** open
**Added:** 2026-07-15
**Commit:** 277e48d9f0 (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** docs sync after the feature was implemented and end-to-end verified.

**The problem.** The pure builder in `pi-model-config.ts` returns a typed error when a request is
applicable (Pi plus provider `openai` plus deployment `custom`) but incomplete, for example a
missing base URL, model, or env credential. The builder has unit coverage for this. There is no
engine-level test that a run driven by such a request ends with `{ok: false}` rather than falling
through to a default provider. The terminal behavior is only proven at the builder layer.

**Why it is deferred.** The builder unit tests and the live 422 paths give confidence the run
fails, and the engine wiring treats a builder error as terminal by construction. A dedicated
engine test pins that contract so a later refactor of the engine cannot silently reroute an
incomplete request.

**What to decide or do.** Add a runner engine test that feeds an applicable-but-incomplete request
through the sandbox-agent engine and asserts the result is `{ok: false}` with the typed error, and
that no session is created against a default endpoint.

### Run the updated Playwright model-hub suite live

**Status:** open
**Added:** 2026-07-15
**Commit:** 277e48d9f0 (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** docs sync after the feature was implemented and end-to-end verified.

**The problem.** The UI relabels the `custom` provider kind to "OpenAI-compatible endpoint". The
Playwright strings in `web/oss/tests/playwright/1-settings/model-hub.ts` (and the acceptance copy)
are updated to match, but no live Playwright run has confirmed the suite passes against the new
label. The strings are edited on trust.

**Why it is deferred.** The entity-ui unit suite (208 passed) covers the label and picker logic,
and the manual UI click-through passed on the dev stack. A full Playwright run needs a live
browser environment that was not part of this session.

**What to decide or do.** Run the Playwright model-hub suite against a deployment carrying the new
label. Confirm it passes and fix any string drift the unit tests did not catch.

### Thread model_ref for the Claude template if its named-connection wire identity is wanted

**Status:** open
**Added:** 2026-07-15
**Commit:** 277e48d9f0 (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** docs sync after the feature was implemented and end-to-end verified.

**The problem.** The fix in `adapters/harnesses.py` threads the structured `model_ref` so a named
connection's `{mode, slug}` reaches the `/run` wire. It threads it for the Pi and Agenta harnesses
only. The Claude harness is left unchanged on purpose, because Claude does not consume the slug and
this project scoped Claude out. A named connection selected for a Claude template therefore does not
carry its `{mode, slug}` identity on the wire.

**Why it is deferred.** Claude reaches Anthropic through its own deployment path and does not read a
Pi-style `models.json`, so it has no use for the slug today. Threading it would change the Claude
wire shape and its golden fixtures for no current consumer.

**What to decide or do.** If a Claude named-connection wire identity is ever wanted (for example to
key a Claude-side provider config or for parity), thread `model_ref` for the Claude harness in
`adapters/harnesses.py` the same way, and update the Claude wire golden fixtures with it.

### Add the Anthropic Messages dialect

**Status:** open
**Added:** 2026-07-15
**Commit:** 277e48d9f0 (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** design.md "Future protocol extension"; carried into this log during the docs sync.

**The problem.** The runner speaks only `openai-completions` in v1. The pure builder in
`pi-model-config.ts` exposes `api` as a discriminator so a second dialect can be added later, but
Anthropic Messages is not implemented. Anthropic Messages has different model metadata,
authentication, headers, and request and response semantics, so it cannot be inferred from a
provider label.

**Why it is deferred.** The first release covers one custom API dialect, which is the actual
requirement. Anthropic Messages needs its own product behavior specified before it is built, so it
was kept out of scope.

**What to decide or do.** When Anthropic Messages is specified, extend the pure plan's `api` union
to `"openai-completions" | "anthropic-messages"`, map an explicit Anthropic provider family to it,
keep its key as `ANTHROPIC_API_KEY`, let capability pair validation allow Pi plus Anthropic plus
`custom`, and expose the protocol choice in the UI. See [design.md](design.md) "Future protocol
extension" for the full extension point.

### Give the provider-kind UI label a design-doc home

**Status:** open
**Added:** 2026-07-16
**Commit:** 5d29b1938c (branch `gitbutler/workspace`)
**Project:** [Pi OpenAI-compatible models](README.md)
**Source:** keep-docs-in-sync sweep after the feature was implemented and end-to-end verified.

**The problem.** The UI relabels the `custom` provider kind from "Custom provider" to
"OpenAI-compatible endpoint" in `web/`. The keep-docs-in-sync sweep found no page in
`docs/design/agent-workflows/documentation/` or `interfaces/` that describes the settings
provider-kind label, so there is nothing to update. The runner and capability changes have homes
(the Pi adapter page, the model-connection-resolution and vault inventory pages); the label string
does not.

**Why it is deferred.** The label is a UI string, not a wire or config contract, and inventing a
new design-doc page for one string is out of scope for the sweep. The label is covered by the
frontend PR body and the entity-ui unit suite.

**What to decide or do.** Decide whether the vault provider-kind labels belong in the design docs
at all. If they do, add a short reference table (kind value, UI label) to an existing page rather
than a new page. If not, close this as intentionally undocumented.

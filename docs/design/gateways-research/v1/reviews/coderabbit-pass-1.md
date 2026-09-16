# CodeRabbit pass 1 — MCP gateway release candidate

CodeRabbit had refused this pull request since 2026-08-14, answering every push with "Review
skipped: 518 files exceed the limit of 300" and reporting that refusal as a **passing** check. This
file records the first review it actually performed, and what each finding is waiting on. The
running finding log stays in [open-reviews.md](../open-reviews.md).

**Reviewed revision:** `3d0bff5dee`, against base `236619ebb768`. Review submitted 2026-09-15.
**Dispositions judged at:** `b0ac98f7f7`, the next candidate, which carries the round-2 fixes.
**Scope:** production source and infrastructure. Tests and design-doc markdown were filtered out of
this pass and belong to pass 2.

Copilot's inline comments and the GitHub Advanced Security comments are out of scope here; they
predate this review and are tracked separately.

## How the review was obtained

CodeRabbit's 300-file cap is a platform limit, not a setting. No plan raises it and no command gets
past it, because the count is checked before the review runs. Files excluded by path filters are not
counted, though: CodeRabbit's own skip comment listed seven files ignored by the organization's
filters and then reported 518 selected against 525 changed, which is that subtraction made visible.
CodeRabbit also reads its configuration from the branch under review, so filters committed to the
feature branch scope to this pull request and change nothing for any other.

A temporary `path_filters` block excluding tests and design docs brought the reviewable set to 270
files, and the review ran.

One thing that block got wrong at first. `inheritance: true` does **not** merge this array with the
organization's. Asking `@coderabbitai configuration` returned a `path_filters` list sourced entirely
from "Repository YAML (base)" holding only the branch's own entries, so the organization's lock-file
and generated-code exclusions were dropped and seven generated files were reviewed as though someone
had written them. Those three patterns are now repeated explicitly in `.coderabbit.yaml`.

**The block is temporary and must be deleted before this pull request merges**, or it narrows
reviews for every future pull request in the repository.

## Totals

CodeRabbit posted 19 findings inline, every one labelled 🟠 Major, and 20 more labelled 🟡 Minor
inside a collapsed section of the review summary that is easy to miss. All 39 are dispositioned
below. Severities are CodeRabbit's; dispositions are ours.

| Disposition | Major | Minor |
| --- | --- | --- |
| Real | 9 | 14 |
| Not applicable | 4 | 0 |
| Deferred | 6 | 6 |

Nothing was already fixed at the time of the review: no commit between the reviewed revision and
the next candidate touched any file a finding names. The fix revisions in the tables below record
where each real finding was subsequently addressed.

## Release blockers

Five findings bear directly on shipping the MCP gateway, in order.

1. **CR9 — the MCP handshake probe follows redirects with credentials attached.** It POSTs to a
   user-declared URL carrying every header credential and sets no `redirect` option, so a server
   answering 302 pivots the runner, credentials included, at a host the SSRF guard never validated,
   private and cloud-metadata addresses included. The session-release `DELETE` has the same gap.
   The API plane already got this right and disables redirects with a comment explaining that a 302
   would undo the DNS pin; the runner probe is the one place missing the equivalent.
2. **CR15 — cancelling during save deletes a connection whose credentials are already stored.**
   `saving` is absent from the connected states, so cancel still deletes there, while both success
   paths enter `saving` *after* the grant is persisted. The modal stays closable across the refresh
   that follows, so a cancel at the wrong moment removes a just-authorised connection and orphans
   its OAuth grant. This is the headline Connect journey, and the shared package means mobile too.
3. **CR14 — the tool list is fetched with an incomplete MCP handshake.** `initialize` is sent, then
   `tools/list`, with no initialized notification and no protocol-version header. The custom relay
   is byte-for-byte, so a stateful upstream rejects the early request. In-house testing cannot catch
   it, because the mock is stateless and answers anyway while the repo's own runner does send the
   notification. It surfaces as a failed tool list in the permission editor and an empty tools step
   at the end of Connect.
4. **M15 — policy identifiers diverge from the bytes forwarded upstream.** The JSON-RPC reader trims
   whitespace before policy evaluation while the adapters forward the original body, so policy can
   evaluate `echo` while the upstream receives a padded name. The docstring states the
   no-rewriting intent outright. Usually the upstream rejects rather than mis-dispatching, but an
   identifier mismatch on the per-tool permission path is exactly what this release claims to have
   got right. Reject padded values rather than canonicalising them.
5. **CR18 — a hidden tool holding a permission cannot be cleared individually.** The control is
   disabled for hidden tools and the underlying helper refuses the write regardless, while the SDK
   rejects the whole policy on every run. The stale-rule sweep does not cover it, because a hidden
   tool is still advertised. One correction to CodeRabbit: the coarse escape hatch does work, since
   clearing the per-tool table removes the entry, so an agent is recoverable, just not surgically.
   Reachable only from SDK- or API-authored configs.

Three more are worth taking before pass 2. **M18** is the cheapest real fix in the set: a blocking
`getaddrinfo` with no timeout, called synchronously from the OAuth connect and probe paths, stalls
the whole worker's event loop rather than one request. **M16** will turn the branch red on its own,
because the `mcp` dependency is constrained to a range while a contract test asserts an exact
version and the comment above the constraint says to keep it exact; a lock refresh breaks CI.
**M6** is a packaging regression this pull request introduced, raising the generated client's Python
floor above what the SDK and API declare, which makes an install on the older supported version
unsatisfiable once the client is regenerated.

## Major findings

| Id | File:line | Category | Disposition | Fix revision | Note |
| --- | --- | --- | --- | --- | --- |
| CR1 | `api/oss/src/apis/fastapi/gateways/mcps/oauth_router.py:30` | Maintainability | Deferred | — | The handler does lack `@intercept_exceptions()`, but it is pure string formatting over constants and reads no project, secret or request state. `connect_callback` is undecorated too, deliberately. |
| CR2 | `api/oss/src/core/gateways/egress.py:220` | Stability | Not applicable | — | The httpx premise is right, the trigger does not exist: all eight call sites resolve a default timeout before calling. A defensive default in the factory would be free, but there is no live defect. |
| CR3 | `api/oss/src/core/gateways/mcps/providers/composio/adapter.py:135` | Correctness | Not applicable | — | The `Content-Type` cited belongs to the session-creation request, which is never scanned. The scanner sees the session's MCP headers, the capability grant. Residual worth noting: that map is upstream-controlled, so a non-secret header of eight or more characters would falsely refuse a relay. |
| CR4 | `api/oss/src/core/secrets/services.py:735` | Data integrity | Real | `a4e9aac88f` | A kind-changing secret update registers but never deregisters, orphaning the old endpoint row. Inert while the LLM plane is off; fix before it ships. Verified: deregisters on a kind change, keyed on the old slug. One of its three new cases discriminates; the other two guard against over-deregistering, which the old code also satisfied. |
| CR5 | `api/oss/src/crons/gateways.sh:22` | Security, CWE-319 | Deferred | — | Accurate but pre-existing: the identical credentialed-cleartext-to-`/admin` pattern already ships in six cron scripts on main. This adds a seventh instance of a platform decision. Track separately. |
| CR6 | `api/oss/src/crons/gateways.txt:1` | Security, CWE-319 | Deferred | — | Duplicate of CR5 counted against the schedule. The file is one crontab line holding no credential and no URL. |
| CR7 | `api/oss/src/dbs/postgres/gateways/mcps/dbes.py:46` | Data integrity | Deferred | — | The missing foreign key is real, but no reachable path creates a mismatch: the only caller validates the endpoint under the caller's project and raises before the transaction begins, and completion pins the grant to the attempt's project and endpoint. Defence in depth, costs a migration. |
| CR8 | `hosting/docker-compose/ee/docker-compose.dev.yml:932,981` | Stability | Real | `610715a0e2` | The only literal host ports in the file; every other published port is templated and allocated per worktree, so a second dev stack failed to bind them. Fixed in both editions, since the OSS dev compose carried the same two literals. |
| CR9 | `services/runner/src/engines/sandbox_agent/mcp-handshake.ts:204` | Security, CWE-918 | Real | `ba60feaeae` | See release blockers. Verified: `redirect: "manual"` on both fetch sites, and the runtime premise checked rather than assumed. Its test asserts the option, and fails without it. |
| CR10 | `services/runner/src/extensions/pi-mcp.ts:196` | Stability | Real | `466054f7fd` | `post` sets no timeout and no signal, `execute` ignores the signal it is given, and discovery runs where a hang is not caught. Bounded, because the route shape forces the target to be the Agenta gateway, whose own upstream call is capped. The sibling probe already does this correctly. Verified in code, all three limbs. **Its two most important halves are untested**: removing the request timeout, or the mid-flight abort link, leaves the suite green. |
| CR11 | `services/runner/src/gateway-error.ts:167` | Data integrity | Real | `14b4b6e7bc` | Only the bare candidate is gated on the provenance marker, so a genuine provider error body is parsed as an Agenta refusal and stamped non-retryable. Metadata-only today: nothing in the runner or web reads those fields. Verified: the marker is required on both shapes. Residual: the MCP plane renders `upstream_error` unmarked, so its `target` detail is now dropped from the operator notice; the commit reasons only about the LLM plane. |
| CR12 | `web/oss/src/components/AgentChatSlice/components/clientTools/useGatewayConnectFlow.ts:98` | Correctness | Real | `23dc332d94` | Closing the tool catalog settles the client tool as connected with no check that anything connected, so the model then calls a tool that does not exist. Desktop-only: mobile registers no gateway-connect widget, so agent-initiated connect is itself unported. |
| CR13 | `web/oss/src/components/pages/settings/Tools/ComposioProjectKey.tsx:111` | Data integrity | Deferred | — | Accurate but minor. The button library swallows clicks while loading, so only the cross-button sequence races, and both orders end in a toast and a refetch rather than data loss. |
| CR14 | `web/packages/agenta-entities/src/mcpEndpoint/api/api.ts:175` | Correctness | Real | `8079441042` | See release blockers. Verified with D32 in round 2. |
| CR15 | `web/packages/agenta-entities/src/mcpEndpoint/core/connectJourney.ts:182` | Data integrity | Real | `133f17c110` | See release blockers. Verified with D29 in round 2: `saving` counts as connected and the dialog is sealed across that window. |
| CR16 | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/McpServerFormView.tsx:108` | Stability | Not applicable | — | The list comes from the query route, which returns stored rows only, and the slug column is not nullable and carries a unique suffix at creation. The optional typing exists for synthesised builtin rows the list route emits. The select throws on an empty string, not on undefined, and the item is already disabled. |
| CR17 | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemKinds.tsx:132` | Correctness | Deferred | — | The inconsistency is real and such an item is refused by the SDK every run, but this form cannot mint the state: the prefix helper returns null for both reserved spellings and the fallback slug always carries a unique suffix. Only a legacy or hand-authored item reaches it. |
| CR18 | `web/packages/agenta-entity-ui/src/mcpEndpoint/McpToolPermissions.tsx:270` | Correctness | Real | `81efaa2ded` | See release blockers. Verified: clearing a hidden tool's permission is always allowed, and the editor lists stranded entries with a Remove. Its case fails without the fix. |
| CR19 | `web/packages/agenta-entity-ui/src/secretProvider/ProviderConnectionCard.tsx:339` | Correctness | Not applicable | — | The probe never tests a protocol. It sends only the kind and provider, and the probe request model carries no protocol field. Protocol is a routing declaration joined at save; credential edits, which are what the probe measured, do clear it. |

## Minor findings

| Id | File:line | Disposition | Fix revision | Note |
| --- | --- | --- | --- | --- |
| M1 | `docs/docs/self-host/reference/01-configuration.mdx:818-819` | Deferred | — | "Both defaults are on" means the two allowed transports, but it sits under the MCP-on/LLM-off table and reads as a contradiction. One-line reword. |
| M2 | `hosting/docker-compose/env.sh:334` | Real | `24af031a8f` | The printed start command omitted the prepared env file, so a custom output was silently ignored and the stack came up on the wrong ports. |
| M3 | `hosting/docker-compose/env.sh:13` | Real | `47e2b884f5` | Path resolution aborted under `set -e` when the parent directory did not exist yet, before the `mkdir -p` that would have created it. |
| M4 | `web/packages/agenta-entity-ui/src/mcpEndpoint/McpToolPermissions.tsx:77-93` | Real | `81efaa2ded` | Neither call site captures the slug before awaiting the tool list, so switching connections mid-flight can render another server's tools. Mis-renders, does not mis-save. Verified: both tool-list fetchers bind an answer to the connection asked. The race case holds the first list in flight, which is the only ordering that reproduces it. |
| M5 | `api/oss/src/core/gateways/llms/providers/mock/adapter.py:789-795` | Real | `b5382e95c6` | The text branch's content-block delta omits the index the tool-use branch carries. Mock adapter, registered only behind the mocks flag. Verified; its test fails without the fix. |
| M6 | `clients/scripts/generate.sh:350` | Real | `ca6e7dbab0` | Generated-client Python floor raised above what the SDK and API declare, making an install on the older supported version unsatisfiable after regeneration. Verified: floor restored, client not regenerated, three packages agree. **Nothing runs the guard** — no workflow executes `clients/python/tests`. |
| M7 | `api/oss/src/core/workflows/static_catalog.py:175-184` | Deferred | — | The schema shape would break strict function calling, but nothing in-tree feeds these schemas to a strict consumer. |
| M8 | `api/oss/src/core/gateways/mcps/oauth/storage.py:344-355` | Real | `fa7b1fcc7e` | A missing key raises where a row came from another writer, and the provider lookup matches any OAuth-provider secret at the same issuer, so a user-created one turns re-registration into a server error. **Partly.** The raise is gone and a foreign row reads as unregistered, but the issuer-only fallback scan still matches any provider row at that issuer. |
| M9 | `services/runner/src/engines/sandbox_agent/mount.ts:548` | Deferred | — | Default ports are not normalised when comparing authorities. The store endpoint is always port-qualified in practice and the failure is a loudly surfaced skipped mount. |
| M10 | `sdks/python/agenta/sdk/middlewares/running/vault.py:494-496` | Real | `facf5097da` | An agent request is inferred from the shape of a parameter named `agent`, so a non-agent workflow carrying that key runs with an empty vault. Needs a user-chosen parameter name to collide. **Partly**, as the commit concedes: a name-shaped heuristic narrowed, not a declared kind recorded. `{"agent": {}}` is now sent to the vault, and the key list duplicates the schema with no sync check. |
| M11 | `services/runner/src/tools/relay-watch.ts:130-142` | Real | `9e848417de` | The local relay source declares an abort signal and ignores it, so an abort is honoured only if the source is also closed. Bounded delay. **Not closed in effect.** The source now honours a signal, but the only caller passes none (`services/runner/src/tools/relay.ts:976`), so an abort still reaches neither source. The test supplies the signal the product never supplies. |
| M12 | `services/runner/src/engines/sandbox_agent/pi-model-config.ts:300` | Deferred | — | The check accepts two credential modes while the error text still names one. Operator-facing string only, worth the two-line fix since it names the gateway path. |
| M13 | `services/runner/src/engines/sandbox_agent/run-plan.ts:422-431` | Deferred | — | The Docker host alias counts as loopback, so a provider secret crosses plain HTTP over the bridge without the insecure-HTTP opt-in. Deliberate, documented, mirrored in the SDK, and host-local. Post-release hardening. |
| M14 | `web/packages/agenta-entities/src/mcpEndpoint/core/connectWatch.ts:95-103` | Real | `ee8486fd61` | A trusted completion that omits the endpoint id settles whichever watcher is live. Origin is still checked, so not an auth bypass; it can show a spurious failure. Verified: a completion naming no endpoint no longer settles a live watch, and the five lax cases that would have broken under the tightened guard were corrected rather than loosened. |
| M15 | `api/oss/src/apis/fastapi/gateways/mcps/utils.py:20-27` | Real | `c9e65158f4` | See release blockers. Verified: both identifiers refuse rather than trim, and the refusal renders as an invalid request. Four cases fail without it. |
| M16 | `api/pyproject.toml:14-16` | Real | `b3c8c57b69` | A version range guarded by a test asserting an exact version. A lock refresh turns CI red. Verified: pinned exactly and the lock is consistent (`uv lock --check` clean). Nothing guards the pin against being re-widened. |
| M17 | `api/oss/src/core/gateways/mcps/providers/mock/adapter.py:103-106` | Deferred | — | An unvalidated sleep duration, in a provider that registers only behind the mocks flag and cannot be resolved with it off. |
| M18 | `api/oss/src/core/gateways/mcps/oauth/registration.py:15-16` | Real | `ec5b82d8b9` | Blocking name resolution with no timeout, called synchronously from two async paths. Stalls the worker's event loop, not just the request. Verified, both call sites converted, and discrimination proven by reverting only the wrapper body. See the note on the shared executor in round 2. |
| M19 | `services/runner/src/extensions/pi-mcp.ts:184-189` | Real | `606616c997` | Configured headers are spread after the protocol headers, so a server config can clobber them or add a case variant that gets folded. Validation reserves none of the three. Breaks initialization in a way that reads as a gateway bug. Verified: case-insensitive screen, protocol headers written last, session id reserved. |
| M20 | `services/runner/src/extensions/model-provider-override.ts:68-73` | Real | `d8e2da9163` | The reserved-name check is applied only to sandbox credentials, not to the model connection's environment or bindings, so a caller-supplied override can reach the extension on a local run. Requires control of the runner request. Verified: one shared rule, both materializers screened, and the case is data-driven off the reserved set. |

## The four not-applicable findings: all four withdrawn

CR2, CR3, CR16 and CR19 were answered on their threads with the code evidence summarised above, and
CodeRabbit accepted every one on its next pass. On CR2 it re-ran the call-site search itself and
replied "All current callers pass a concrete timeout... I withdraw this finding", marking the thread
resolved. CR3 it re-verified and resolved. On CR16 and CR19 it replied "you are correct", restating
the evidence in its own words. None required a code change, and none should be re-raised.

## Incremental review of `23dc332d94`

CodeRabbit reviewed again on the next push. It confirmed fixes and raised six new findings.

**Confirmed fixed.** It marked eight threads "Addressed in commits 8079441 to 23dc332": CR4, CR8,
CR9, CR10, CR11, CR14, CR15 and the probe deadline. The remaining real findings are recorded as
fixed at the same revision on the strength of that push rather than a separate confirmation from
CodeRabbit, which only re-checks threads where it detects a change. **Nothing was re-raised.**

## Verification of the fixes

The `Fix revision` column above carried the range endpoint `23dc332d94` for every finding in that
push, which is what CodeRabbit's "Addressed in commits 8079441 to 23dc332" supports. Fourteen of
them have since been verified one at a time, and the column now names the exact commit for each:
the code read against the finding, the test read to judge whether it would fail without the fix,
the suite run, and a run pinned to the revision before the fix wherever an existing suite already
covered the behaviour. CR12, CR18, M4 and M14 keep the range shorthand, because this verification
did not cover them.

**Three are not closed as the column would otherwise suggest**, and each row says so: **M11** fixes a
seam no caller uses, **M8** leaves the lax lookup it names, and **M10** narrows a heuristic rather
than recording a declared kind, which its own commit message concedes.

Suites at the verified revisions, with the exact commands in the run log: the runner unit project
**3386 passed**; the API gateways and secrets unit suites **1279 passed** from a clean tree at the
committed revision; the gateways integration directory **94 passed** against the dev stack.

### The incremental review's own finding

**N3 — an unresolvable pinned registration was answered as "no pin at all".** Fixed by
`99b270da8d`, verified. A grant records which client the authorization server issued it to so a
renewal can present that one; when the row behind that reference could not be read, the reader
answered `None`, which is exactly what a grant carrying no pin answers, and the renewal read that as
permission to present the deployment's identity document. The one substitution the pin exists to
prevent was the one that happened, one line below a comment saying nothing can stand in for a
registration that is gone. An unresolvable pin is now a typed refresh failure, which the data plane
already turns into a reconnect that mints a fresh registration along with fresh tokens; a grant with
no pin keeps the identity-document fallback, which is the legitimate path.

Worth recording plainly: **this review read that code and missed it.** Verifying D24 I read the
write path and the pinned branch, confirmed the slug was carried forward, and did not follow what
the caller does with a `None`. CodeRabbit did.

### Residuals found while verifying

These came out of checking the fourteen fixes. None is a re-raise of a dispositioned finding.

- **The Pi MCP client still has CR9's gap.** `services/runner/src/extensions/pi-mcp.ts:241` POSTs
  with `X-AG-Credentials` and no `redirect` option, so it follows. The wire validator checks the
  path shape, not the origin, so "the route forces the target to be the Agenta gateway" holds for
  the path only. Lower severity than CR9, since this runs inside the sandbox bundle and the
  credential is supplied by the same request that names the URL, but it is a one-line inconsistency
  with the posture CR9 just set.
- **CR10's two important halves are untested.** Removing the request timeout, or the listener that
  links a caller's abort to an in-flight call, each leaves the suite green. The covered case is a
  signal already aborted before the call.
- **CR11 drops the MCP plane's `upstream_error` detail.** That refusal is rendered unmarked, so the
  `target` the handshake notice used to carry is now `undefined`. The commit reasons about the LLM
  plane only.
- **M6's guard is not executed by anything.** No workflow runs `clients/python/tests`, so the floor
  can drift again and turn nothing red.
- **M16's pin is unguarded.** The only check asserts the installed version, which passed before the
  fix too. One assertion that the manifest declares the pin would make it self-guarding.
- **M18's safety argument overstates the isolation.** A timed-out resolution abandons a worker in the
  loop's shared default thread pool rather than a detached thread, so enough concurrent stuck
  resolutions make the bound fire on queueing and answer "not resolvable" for a deployment that
  resolves. Separately, `api/oss/src/core/gateways/egress.py:170` runs the same blocking resolution
  with no bound at all, on the relay path every gateway call takes.
- **M10 regressed the other direction.** Every field of the agent template schema has a default, so
  `{"agent": {}}` is a valid agent and is now sent to the vault. No case pins it.

| Id | File:line | Severity | Disposition | Note |
| --- | --- | --- | --- | --- |
| N1 | `api/oss/src/apis/fastapi/gateways/mcps/router.py:501` | Minor | Deferred | The route discards the cache write's result, and the DAO also swallows exceptions, so a failure is silent twice over. Nothing consumes the cached copy: the scopes the journey renders come from the response body, and both begin and refresh re-discover rather than read the row. Write-only telemetry. |
| N2 | `api/oss/src/core/gateways/llms/providers/mock/adapter.py:477` | Major | Deferred | Accurate: the echo lookup returns nothing for both "no catalog" and "catalog with no match", so the fallback fires in a case it should not. Mock upstream only, reachable solely with the mocks flag on and the LLM plane enabled. Test scaffolding. |
| N3 | `api/oss/src/core/gateways/mcps/oauth/storage.py:423` | Major | **Real, release-relevant** | A pinned registration that has been deleted or fails validation returns nothing, which the refresh path cannot distinguish from "never registered", so it substitutes the metadata client the code comment says must not stand in. A lax public-client server would accept it; a strict one returns a confusing refresh failure instead of a reconnect prompt. No cross-origin leak, since the refresh token still goes only to the pinned verified issuer. Small fix: a typed unresolvable-pin result. |
| N4 | `api/oss/src/core/gateways/mcps/probe.py:221` | Major | Not applicable, already fixed | The deadline now wraps discovery as well, with a timeout arm returning an undiscoverable cause. Landed before this head, and CodeRabbit's own comment marks the thread addressed. |
| N5 | `api/oss/src/core/gateways/mcps/service.py:1115` | Major | Deferred | The race is real: the credential comparison sits outside the invalidating write, and a reconnect landing between them keeps the same secret id, so the guard passes and a repaired endpoint is marked invalid. Deferred because the window is two database round trips, the consequence is one spurious reconnect banner that a second connect clears with no data loss, and true atomicity needs a credential-version column on the endpoint row, which is a schema change out of scope for this gate. Tracked as #6879. |
| N6 | `sdks/python/agenta/sdk/agents/adapters/claude_settings.py:172` | Major | Deferred | Both halves are genuine: the iterable is built before the type guard, so a non-dict value raises, and the default permission indexes a table with no membership check. Unreachable from the product path, where the caller passes validated models whose permission fields are a literal union. Two-line hardening. |

**N3 is the only new release-relevant finding.** N5 is tracked as #6879. N1, N2 and N6 are not
release-relevant, and N4 is already fixed.

## Next

Fix N3 before the gate. N5 is filed as #6879. Pass 2 swaps the filter block for the inverse list
so the tests are reviewed, and the block comes out entirely before merge.

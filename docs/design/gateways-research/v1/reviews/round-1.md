# Independent review round 1 — MCP gateway release candidate, backend

Two reviewers read the same diff independently and without seeing each other's work. This file
records what they found, what survived verification against the code, and what each finding is
waiting on. It is the round record; the running finding log stays in
[open-reviews.md](../open-reviews.md).

**Reviewed revision:** `528204c3d9`, against base `6df148cb39`.
**Scope:** `git diff 6df148cb39..528204c3d9 -- api sdks services`. 67 files, 7,517 insertions,
268 deletions. Frontend, docs and hosting changes were out of scope for this round.

The branch has moved on since. Every line number below was read at `528204c3d9` and should be
confirmed against the revision you are reading rather than trusted, because other work has landed
in the same files.

Every path in this document is relative to the repository root. Paths to scratch files, host
directories and container names are deliberately omitted.

## The two reviews

**Codex.** An external reviewer run at medium reasoning effort, read-only, given the diff, the
decisions document, the open findings and the QA record, and told to verify every claim against
the code rather than trust the summary. Verdict: **do not ship**, on seven findings.

The exact invocation, with local paths replaced by placeholders:

```bash
codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only \
  --color never -C <repository root> "$(cat <briefing>)"
```

The CLI reported `codex-cli 0.153.4`, `model: gpt-6-astra`, `provider: openai`,
`sandbox: read-only`, `reasoning effort: medium`. Asked to name its own model, it answered that
the exact runtime identifier is not exposed, so the model string on record is the one the CLI
header printed: **gpt-6-astra at medium reasoning**. The run used 270,103 tokens.

The briefing is not committed. It gave the head and base commits, the changed paths, the six
priority areas (the grant-rekey migration, tenant isolation, credential handling and redaction,
consent and callback recovery, per-tool permission fail-closed behaviour, and the plane flags and
their fallbacks), the eight open findings, and the review-quality angles.

**Second reviewer.** An independent read of the same diff with the same priority areas, reading
the code and the tests rather than the documents' claims about them. Verdict: **ship with fixes**,
on two findings.

## Counts

| | P0 | P1 | P2 | P3 | Total |
| --- | --- | --- | --- | --- | --- |
| Codex, as filed | 2 | 5 | 2 | 1 | 10 |
| Second reviewer, as filed | 0 | 1 | 6 | 5 | 12 |
| **After verification and merge** | **1** | **3** | **8** | **5** | **17** |
| After the first round of fixes | 0 | 1 | 6 | 6 | 13 open, 4 closed, 1 withdrawn |

Five findings overlapped and are merged below. Four Codex severities were lowered on reachability
grounds and one second-reviewer severity was raised; each change is argued in the finding's own
section. The two reviewers disagreed about severity far more than about facts: every mechanism
Codex described was confirmed.

One second-reviewer finding, D8, did not survive verification and is withdrawn. It is kept in
place with its correction rather than deleted, because the probe that produced it is the one an
operator would reach for and the next person deserves to know why it misleads.

## Disposition table

`Fix rev` is the commit that resolves the finding. `Verified` records whether that fix was read
against the code and its test.

| ID | Source | Sev | Evidence | Disposition | Fix rev | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Codex 3 | P0 | `api/oss/src/core/gateways/mcps/providers/http/adapter.py:147`, `api/oss/src/apis/fastapi/gateways/mcps/proxy.py:215` | Fix, blocking | `8a2a59f76a` | **yes**, code, tests, suite run |
| D2 | Codex 1 | P1 | `services/runner/src/engines/sandbox_agent/acp-interactions.ts:946`, `:966` | Fix, blocking | `8a2a59f76a` | **yes**, code, tests, suite run |
| D3 | both | P1 | `api/oss/src/apis/fastapi/gateways/mcps/router.py:71`, `api/oss/src/core/gateways/mcps/service.py:1013` | Fix, blocking | pending | pending |
| D4 | both | P2 | `api/oss/databases/postgres/migrations/core_oss/versions/oss000000032_rekey_mcp_oauth_grants_by_connection.py:81` | Fix | pending | pending |
| D5 | Codex 5 | P2 | `api/oss/src/core/gateways/mcps/oauth/service.py:302` | Fix | pending | pending |
| D6 | Codex 6 | P2 | `api/oss/src/core/gateways/mcps/oauth/storage.py:257`, `oauth/service.py:83` | Fix | pending | pending |
| D7 | both | P2 | `services/runner/src/mcp-permission.ts:114`, `acp-interactions.ts:966` | Fix the ACP half | `e57627d8e5` | **yes**, code, tests, suite run |
| D8 | reviewer 2 | — | `services/runner/package.json:10` | **Withdrawn**, the finding was wrong | `fe58e68162` | **yes**, dispute confirmed |
| D9 | reviewer 2 | P2 | `services/runner/src/mcp-permission.ts:82` | Fix | `21d5591326` | **yes**, code, tests, suite run |
| D10 | reviewer 2 | P2 | `api/oss/src/core/gateways/mcps/service.py:264`, `services/runner/src/engines/sandbox_agent/runtime-policy.ts:145` | Fix | pending | pending |
| D11 | Codex 8 | P2 | `api/oss/src/core/gateways/mcps/service.py:569` | Defer into OR66 | n/a | n/a |
| D12 | both | P3 | `api/oss/src/core/gateways/mcps/service.py:289`, `api/oss/src/dbs/postgres/gateways/mcps/dao.py:215` | Defer | pending | pending |
| D13 | reviewer 2 | P3 | `.../oss000000032_rekey_mcp_oauth_grants_by_connection.py:86` | Fix the reporting | pending | pending |
| D14 | both | P3 | `api/oss/src/core/gateways/mcps/oauth/storage.py:229` | Defer | pending | pending |
| D15 | reviewer 2 | P3 | `api/oss/src/core/gateways/mcps/oauth/service.py:70`, `:353` | Defer | pending | pending |
| D16 | reviewer 2 | P3 | `services/runner/src/engines/sandbox_agent/runtime-policy.ts:137`, `api/oss/src/apis/fastapi/gateways/flags.py:10` | Fix | pending | pending |
| D17 | reviewer 2 | P3 | `api/oss/src/core/gateways/mcps/service.py:823` | Document | `0940769da2` | **yes**, docs read |
| D18 | D2 residual | P3 | `sdks/python/agenta/sdk/agents/adapters/codex_settings.py` | Defer | n/a | n/a |

**One finding still blocks the release: D3.** D1 and D2 are fixed and verified. D8 is withdrawn:
the finding was wrong, and the section below says why. D18 is a residual that D2's fix left
behind, opened here rather than folded silently into a closed finding.

## Verifying the fixes

A fix is marked verified only when its code was read against the finding, its test was read to
confirm it would fail without the fix, and the suite was actually run. For the runner fixes that
was `vitest run --project unit` over
`tests/unit/mcp-permission-intake.test.ts`, `tests/unit/sandbox-agent-acp-interactions.test.ts`,
`tests/unit/pi-gateway-mcp.test.ts` and `tests/unit/pi-gate-envelope.test.ts`: **113 passed**. For
D1 it was pytest over `oss/tests/pytest/unit/gateways/test_gateways_egress.py`,
`test_gateways_http_mcp_adapter.py` and `oss/tests/pytest/unit/secrets/test_dtos.py`:
**134 passed**.

`8a2a59f76a` carries both the D2 runner change and the D1 API change under a single D2-titled
message, so the D1 fix is easy to miss when reading the log. Both were verified.

## The findings

### D1. A stored credential reaches the caller through a transport-exception message — P0

`providers/http/adapter.py:147` raises `MCPUpstreamError(detail=str(e))` for any
`httpx.RequestError`, and `gateways/mcps/proxy.py:215` returns that detail to the caller as the
JSON-RPC error message.

`httpx.LocalProtocolError` is an `httpx.RequestError`. When a header value contains a byte the
HTTP/1.1 encoder rejects, the exception's string carries the offending value in full, so the
credential travels back to the caller. This was confirmed by reproduction against a live socket,
not by reading alone. The reproduction is deliberately not committed.

The trigger is a stored credential containing a control character. A trailing newline on a pasted
key is the ordinary way to get one, and nothing strips or validates a secret value on write:
there is no such check in `api/oss/src/core/secrets/dtos.py`.

Codex named one call site. There are five, and two carry more than the relay does:

| Call site | What the failing request carried |
| --- | --- |
| `api/oss/src/core/gateways/mcps/providers/http/adapter.py:147` | the connection's OAuth grant or API key |
| `api/oss/src/core/gateways/mcps/providers/composio/adapter.py:118` | the Composio session credential |
| `api/oss/src/core/gateways/mcps/oauth/client.py:545` | the client secret and the authorization code |
| `api/oss/src/core/gateways/mcps/oauth/client.py:421` | the registration request |
| `api/oss/src/core/gateways/mcps/probe.py:173` | interpolated into a user-facing message |

**Coverage.** None. `api/oss/tests/pytest/unit/gateways/test_gateways_http_mcp_adapter.py:255`
supplies a synthetic connection-refused exception and never builds a credential-bearing header.

**Suggested fix.** Do not put transport exception text on a caller-visible field. Map
`httpx.RequestError` to a closed set of causes and log the detail server-side only. Separately,
refuse a credential value containing a control character at the vault write. Add a regression test
that drives the public error mapper with such a credential and asserts it is absent from the body.

**Fixed in `8a2a59f76a`, verified.** Both layers were built. `classify_transport_error` in
`api/oss/src/core/gateways/egress.py` maps an `httpx.RequestError` to a closed set of causes and a
fixed detail string, and it withholds the exception text even from the log for the classes that may
quote a credential. `_single_line_credential` in `api/oss/src/core/secrets/dtos.py` strips
surrounding whitespace and refuses an interior control character, naming the field and never the
value.

Every site was converted, not only the five this review named: ten `httpx.RequestError` handlers
across the HTTP, Composio, passthrough, OAuth-client and probe paths now call the classifier, and
no `str(exc)` remains on any of them. The regression tests assert the credential is absent from the
error's detail, its message and its rendered proxy response. Tracked as OR86 in the findings log.

### D2. Ambiguous harness tool names resolve to another connection's `allow` — P1

`acp-interactions.ts:946` reconstructs a call's identity by taking the longest configured server
name the rendered tool name starts with, and `:966` looks up that identity's permission.

With server `acme` holding tool `prod__delete` at `deny`, and server `acme__prod` holding tool
`delete` at `allow`, both render as `mcp__acme__prod__delete`. Longest-prefix matching picks
`acme__prod` and returns `allow`. The dotted spelling has the same ambiguity.

Two things were checked before accepting it. The API-side uniqueness check does not close it:
`tool_prefix` in `api/oss/src/core/gateways/mcps/service.py:207` maps both names to themselves, so
both creates succeed. And the denied tool is reachable on this path: the Pi extension skips
registering a denied tool (`services/runner/src/extensions/pi-mcp.ts:364`), but the gateway filters
the tool list only by the endpoint's allowlist (`service.py:823`) and never by permission, so the
ACP harnesses are still offered it.

**Severity.** Filed P0, recorded P1. It is a real authorisation bypass and it blocks, but it needs
two connection names in a prefix relationship and a tool name on the shorter one that reconstructs
the longer one's tool. P0 in this table is reserved for the credential disclosure.

**Coverage.** None. `services/runner/tests/unit/sandbox-agent-acp-interactions.test.ts:1171` tests
longest-prefix matching with the permissions arranged so the safe answer wins; the reversed
assignment is untested.

**Suggested fix.** Carry the server and upstream tool identity through the ACP gate the way the Pi
gate envelope already does (`services/runner/src/engines/sandbox_agent/pi-gate-envelope.ts:44`),
rather than reconstructing it from a rendered string. Short of that, treat more than one matching
server as unresolved and fail closed instead of preferring the longest.

**Fixed in `8a2a59f76a`, verified.** The second route was taken. `splitMcpToolName` became
`mcpToolNameCandidates`, which returns every match instead of the longest, and `resolveMcpToolName`
reports one of four outcomes; an `ambiguous` outcome resolves to `deny`. The commit also renders
per-tool `deny` rules for Claude so a denied tool is no longer offered there at all.

The tests are the right ones. The reviewer's exact construction is pinned — the denying server is
the short name, so the old longest-match behaviour would answer `allow` — alongside the dotted
Codex spelling and a non-regression case where a single server whose own name contains the
separator still resolves. All would fail without the fix.

The fix leaves a remainder on one harness, carried as **D18**.

### D3. Connect, disconnect and invalidate write a stale full snapshot — P1

Both reviewers found a different half of one defect, and the merged version is worse than either.

The write is a full replacement built from a snapshot read earlier:
`gateways/mcps/router.py:71` (`_as_edit`) and `core/gateways/mcps/service.py:1013`
(`_invalidate_endpoint`), both feeding `api/oss/src/dbs/postgres/gateways/mcps/mappings.py:80`.

Two consequences. **Fields the builder omits are nulled:** `_as_edit` never sets `tags` or `meta`,
which `MCPEndpointEdit` inherits defaulting to `None`, and the mapping assigns both
unconditionally. The create body accepts them, so a user can set them and lose them on first
connect. **Fields the snapshot holds stale are restored:** an administrator who deactivates the
endpoint or tightens its tool filter while a relay is in flight has that change reverted when the
eventual 401 runs `_invalidate_endpoint` with the pre-request snapshot.

Four call sites: `router.py:505`, `:571`, `:700`, and `service.py:1013`. Two are new on this
branch, so this is not inherited debt alone.

**Coverage.** None on either half. No gateway test references `tags` or `meta`, and none
interleaves an endpoint edit with a 401 recovery.

**Suggested fix.** Stop expressing a credential-lifecycle transition as a full endpoint
replacement. Add a narrow DAO method that updates only `secret_id` and `flags.is_valid` under the
row's own lock. If the full replacement has to stay, carry `tags` and `meta` through both builders
and re-read the row inside the transaction.

### D4. The migration aborts on a destination slug the new writer already created — P2

Both reviewers reached the same sequence. Endpoint E still references legacy grant G; the new code
has already created grant H at E's new slug; the migration renames G onto H's slug at
`oss000000032_rekey_mcp_oauth_grants_by_connection.py:81`; the unique index at
`api/oss/src/dbs/postgres/secrets/dbes.py:21` rejects it and the migration fails.

**Severity.** Filed P1, recorded P2, because two things that would widen it do not. The normal
consent path writes the grant and immediately repoints the endpoint
(`api/oss/src/core/gateways/mcps/oauth/service.py:275`), so after a successful reconnect the rename
is a no-op; the collision needs a completion that stored the grant and then failed before binding
it. And while the API does serve on an unmigrated schema in principle — `check_for_new_migrations`
in `api/oss/databases/postgres/migrations/core/utils.py:157` only warns — every supported compose
deployment gates the API on a one-shot `alembic` service with
`condition: service_completed_successfully`, for example
`hosting/docker-compose/oss/docker-compose.gh.yml:108`.

The migration also sets no bounded lock wait and no writer exclusion, which is the second half of
the open **OR68**.

**Coverage.** `api/oss/tests/pytest/integration/gateways/test_mcp_oauth_grant_rekey_migration.py`
is the strongest suite on the branch — nine cases against a real scratch database, including the
rerun case at line 387 — and none seeds a row at the destination slug or interleaves a writer.

**Suggested fix.** Make the rename skip or resolve an occupied destination rather than fail, set
`lock_timeout` and `statement_timeout` at the top of `upgrade()`, and add the seeded-collision and
interrupted-completion cases to that suite.

### D5. Disconnect does not invalidate an outstanding consent — P2

`oauth/service.py:302` disconnects by deleting the stored grant only. The attempt row survives and
`:260` still completes, and `gateways/mcps/router.py:681` then rebinds the new secret. So: begin
consent, disconnect succeeds, the tab that was already mid-flight completes, and the connection is
connected again while the user believes they revoked it. An in-flight refresh writes the same way.

**Severity.** Filed P1, recorded P2: it needs a consent already in flight, the window is the
attempt lifetime, and the outcome is a connection that reappears rather than a credential reaching
the wrong party.

Pair it with the open **OR81**, which records that disconnect never revokes at the authorization
server. Together they mean disconnect is local, best-effort and racy, and the product copy should
say so.

**Coverage.** None. `test_mcp_oauth_connection_identity.py:413` and `:516` both test completed
consents, neither an outstanding one.

**Suggested fix.** Persist an authorisation generation on the connection, stamp it onto each
attempt, bump it on disconnect, and refuse a callback or refresh whose generation is stale. A
cheaper interim step is to delete the connection's pending attempt rows on disconnect.

### D6. Re-registration replaces the client identity existing grants depend on — P2

This one is introduced by the branch. The OR78 closure added `registration_covers`
(`api/oss/src/core/gateways/mcps/oauth/registration.py:46`) so a stale registration is no longer
reused. The consequence is that the fresh registration overwrites the shared per-issuer row at
`oauth/storage.py:257`, and every existing grant at that issuer was bound to the old client. Their
refreshes then present the new client with old-client tokens and fail.

OR78 therefore traded a connection that could not connect for connections that silently stop
refreshing. Narrower, but quieter.

**Severity.** P2: it needs the deployment's public address to change, and the recovery is a
reconnect.

**Coverage.** None for the interaction.
`api/oss/tests/pytest/unit/gateways/test_gateways_mcp_oauth_registration_fallback.py:335` asserts
the replacement happened and never refreshes an existing grant afterwards.

**Suggested fix.** Keep registrations immutable and addressed by a reference stored on the grant,
retaining an old one while any grant still names it, rather than mutating one row per issuer.

### D7. Unresolved MCP identity falls through to the run's default permission — P2

This needs splitting, because one half is deliberate and one is not.

**Deliberate.** A server with no permission configuration returns `undefined` from
`services/runner/src/mcp-permission.ts:114` so the pre-existing ladder decides exactly as it did
before per-tool policy existed. The comment at `:110` states that intent and changing it would
alter behaviour for every configuration that predates the feature. Codex treats this as the
defect; this record does not.

**The real finding.** A *configured* server whose rendered name the lookup cannot match also
returns `undefined` from `acp-interactions.ts:966`, which is indistinguishable from "not
configured". The lookup assumes the harness renders the configured name verbatim, and nothing
constrains a display name to characters a harness will not rewrite — `tool_prefix` in
`core/gateways/mcps/service.py:207` normalises only for comparison.

The QA record already contains measured evidence on both sides, which neither reviewer cited:
[qa.md](../qa.md) shows one harness rendering server `mock-mcp` as `mcp__mock_mcp` in the
model-facing catalogue, hyphen rewritten, while the gate frame for the same call arrives with the
hyphen intact. The lookup is correct today by a margin nobody has characterised.

**Coverage.** `sandbox-agent-acp-interactions.test.ts:1193` pins the deliberate half. Nothing
covers a configured server whose rendered name fails to match.

**Suggested fix.** Distinguish the two cases: where a tool name begins with the MCP prefix but no
configured server matches, fail closed, because that is a tool the runner itself advertised and
could not identify. Separately, constrain the display name character set at the API and add a gate
cell for a name containing a space.

**Fixed in `e57627d8e5`, verified.** The `unconfigured` outcome now resolves to `deny` alongside
`ambiguous`, and `undefined` keeps exactly one meaning. Both deliberate cases are pinned by new
tests: a tool that is not MCP-shaped still defers to the existing ladder, and a configured server
that set no permission still defers, so configurations predating per-tool policy are unchanged.

The display-name character constraint was not part of this fix and is not needed now that an
unrecognised name denies rather than defers.

### D8. Withdrawn — the permission cells did run against the shipped Codex

**As filed:** the QA record reasoned from Codex source at `rust-v0.154.0` while
`services/runner/package.json:10` pins `@openai/codex 0.145.0`, and probing the container returned
`codex-cli 0.154.0`, so the evidence appeared to describe a binary production does not ship.

**The finding was wrong, and the dispute is accepted.** The probe reached an artifact that exists
in the container but is never launched. Checked independently rather than taken on assertion:

- The bundled harness reports the pinned version. Running
  `bin/agent_processes/codex/node_modules/@openai/codex/bin/codex.js --version` in the container
  returns `codex-cli 0.145.0`, and that package's own `package.json` records `0.145.0`.
- The launcher `bin/agent_processes/codex-acp` is a two-line shell script that `exec`s
  `bin/agent_processes/codex/node_modules/.bin/codex-acp`, inside the pinned install.
- `startAcpServer()` in the adapter bundle reads `CODEX_PATH` and passes it to
  `startCodexConnection()`, which, when that value is absent, spawns
  `createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js")` — the bundled copy.
- `CODEX_PATH` is unset in the container and appears nowhere under `services/runner/src` or
  `services/runner/scripts`.

There is a `CODEX_PATH ?? "codex"` fallback in the same bundle that would resolve from `PATH`, but
it sits inside the `login` subcommand, which a run never takes. The standalone `0.154.0` binary is
therefore not what the cells exercised.

The cells were re-run against `0.145.0` on 2026-09-15. The accompanying change to the mock adapter
is comment-only: no assertion or payload moved, which is itself evidence that the wire shape did
not need adjusting between the two versions.

**One claim remains unverified and is not load-bearing.** The corrected note states the
`ResponseItem::FunctionCall` shape is identical at `rust-v0.145.0` and `rust-v0.154.0`. That is a
claim about upstream source that cannot be checked from this repository. It does not matter for the
disposition: the cells now run on the version that ships, so the evidence describes the shipped
binary whatever the other version does.

**What the finding got right, and it is small.** The development image still has no `USER`
directive while `services/runner/docker/Dockerfile.gh:118` sets `USER node`, which is why a
differently-versioned standalone binary sits in root's home on a dev stack at all. It misleads
anyone who probes the obvious path, as it misled this review. Worth tidying; not a release concern.

### D9. A corrupt `toolPermissions` container silently disables per-tool policy — P2

At `services/runner/src/mcp-permission.ts:82`, `optedIn` is false when `toolPermissions` is present
but not an object, so the fallback stays undefined and the whole per-tool table vanishes into the
run default. The module's own docstring at `:56` commits to the opposite treatment for the sibling
field: a present-and-corrupt `newToolPermission` gets `deny`. This is the one asymmetry in an
otherwise carefully fail-closed module.

**Coverage.** `services/runner/tests/unit/mcp-permission-intake.test.ts` covers a corrupt
`newToolPermission` and a corrupt per-tool entry. Every `toolPermissions` occurrence in that file
is a well-formed object; none is a non-record.

**Suggested fix.** Treat a declared-but-unreadable container the same as a declared-but-corrupt
fallback, so it resolves to `deny`.

**Fixed in `21d5591326`, verified.** `optedIn` now reads what the sender *declared* rather than what
parsed, so a corrupt container can no longer take the whole table down with it, and a declared but
unreadable `toolPermissions` resolves to `deny`. The test parameterises over corrupt shapes and
pins the two cases that must not change: a readable table with no floor still asks, and a server
declaring neither field still reaches the run's own ladder.

### D10. A renamed connection frees a name still frozen into committed agent revisions — P2

`core/gateways/mcps/service.py:264` compares the new name only against live connections, while
`sdks/python/agenta/sdk/agents/mcp/models.py:257` documents the wire name as frozen at save.

Rename connection A from `Acme` to `Acme Prod`, create connection B named `Acme`, and an agent
referencing both now sends two servers with one wire name.
`services/runner/src/engines/sandbox_agent/runtime-policy.ts:145` overwrites the map key without
comment, so the later entry wins and every call under that name resolves to one connection's
policy. The Pi path at least detects and logs its equivalent collision
(`services/runner/src/extensions/pi-mcp.ts:373`); the ACP path does not.

**Coverage.** None; the runner tests supply distinct server names throughout.

**Suggested fix.** Detect a duplicate key and resolve it to the more restrictive entry rather than
the last, and log it. The deeper fix is D2's: key the table on the connection slug the SDK already
carries.

### D11. Refusals before the audit recorder produce no audit event — P2, deferred

`core/gateways/mcps/service.py:569` places the active and allowlist checks ahead of the recording
closure, and credential resolution sits outside the dispatch handler. An inactive endpoint, a
denied tool and a credential-resolution failure therefore leave the relay without the enriched
audit event this branch adds. The mechanics were confirmed.

Since the decisions document asks for small useful audit fields rather than complete coverage, and
the events that do fire are correct and tested, this is a gap in reach rather than a defect in what
was built. **Folded into the open OR66** rather than tracked separately.

**Coverage.** `api/oss/tests/pytest/unit/gateways/test_gateways_policy_audit.py:123` tests
attribute conversion from a constructed decision and would pass if the service never emitted one.
The suite is otherwise solid on what it covers.

### D12. The name check scans every connection in the project on every create and edit — P3

`core/gateways/mcps/service.py:289` calls `query_endpoints`, which applies no limit when no
windowing is supplied (`api/oss/src/dbs/postgres/gateways/mcps/dao.py:215`). It is also a
check-then-act race with no database constraint behind it, so two concurrent creates with one name
both succeed, and it runs on every edit rather than only on a name change.

**Suggested fix.** Store the normalised prefix as a column with a partial unique index on
`(project_id, prefix)`, which closes the race and removes the scan together.

### D13. The migration silently declines to rekey a cross-project grant — P3

`oss000000032_rekey_mcp_oauth_grants_by_connection.py:86` joins on the project as well as the
secret id, so a grant row whose project does not match its referencing endpoint's is not renamed,
not counted, and not mentioned in the summary line. **OR62** records that the schema does not
constrain this, so such rows are possible by construction. The outcome, a connection that reads as
needing authorisation, is acceptable; the silence is not.

**Suggested fix.** Count the referenced rows the update did not touch and print them.

### D14. The client-registration lookup scans every secret in the project — P3

`core/gateways/mcps/oauth/storage.py:229` lists the project's secrets and matches in Python, while
the grant half of the same class was converted to a slug lookup on this branch at `:127`, for the
reason stated there. Both reviewers named the same fix independently.

**Suggested fix.** Read by the issuer-derived slug, keeping the scan only as a fallback for rows
written before the slug was deterministic.

### D15. The refresh-lock dictionary is never evicted — P3

`core/gateways/mcps/oauth/service.py:70` and `:353` use `setdefault` with no removal, one lock per
connection for the life of the worker. The key moved from server URL to connection on this branch,
which is correct for the semantics and strictly raises the cardinality. Not a regression in kind.

### D16. Two comments describe behaviour the code no longer has — P3

`services/runner/src/engines/sandbox_agent/runtime-policy.ts:137` claims the wire's server name is
the connection's stable key and that the route is `custom/{name}`. That route is the deprecated
fallback now; `sdks/python/agenta/sdk/agents/mcp/resolver.py:38` builds it from the connection slug
whenever a connection reference is present.

`api/oss/src/apis/fastapi/gateways/flags.py:10` claims a test can set the switch from the
environment. The attribute read is per call, but the value is captured at import, because both
`enabled` fields are model defaults evaluated at class-definition time
(`api/oss/src/utils/env.py:968`). A test has to patch the settings attribute directly, and the
sentence invites the wrong test.

### D18. Codex is still offered tools the run denies — P3, deferred

Opened by D2's fix rather than found in review, and recorded here so a closed finding does not
carry an unstated remainder.

D2's fix stops a denied tool from *executing* on every harness. It does not stop one being
*offered*. The three harnesses now differ:

| Harness | A denied tool is | Where it is stopped |
| --- | --- | --- |
| Pi | not registered | `services/runner/src/extensions/pi-mcp.ts` drops it at registration |
| Claude | not offered | a per-tool `deny` rule from `claude_settings.py`, added by D2's fix |
| Codex | **still advertised** | the runner gate refuses it at call time |

Codex is the exception for a structural reason, not an oversight. Per-tool approval would need a
`[mcp_servers.<name>.tools.<tool>]` table, and Codex rejects a server entry with no transport at
`session/new`; the runner delivers these servers over ACP instead, so it has no table to write
them into. The module docstring in `sdks/python/agenta/sdk/agents/adapters/codex_settings.py`
records this as decision D-008.

The consequence is a worse experience, not a weaker boundary: the model sees a tool, tries it, and
gets a refusal instead of never being offered it. The gate holds.

**The proper closure is not in the runner.** Have the gateway filter `tools/list` by the run's deny
set, the way it already filters by the endpoint's allowlist
(`api/oss/src/core/gateways/mcps/service.py:823`). That removes a denied tool from the catalogue
for every harness at once, needs no per-harness settings file, and does not depend on what any
harness can be told. It also closes the gap D17 describes from the other side. Deferred: it is a
gateway change, not a release fix, and the gate already prevents execution.

### D17. `deny` is an experience control, not a security boundary — P3, document only

The API enforces the endpoint's tool allowlist at relay (`core/gateways/mcps/service.py:823`) and
has no notion of allow, ask or deny at all. The three-verdict permission lives in agent
configuration and is enforced only in the runner. The sandbox holds a gateway credential and the
connection URLs, so a model with shell access can reach an allowlisted tool without passing either
gate.

This matches the decisions document, which frames permissions as the runner approval experience, so
it is not a defect. It needs saying in the product copy and the documentation, because anyone
reading a permission editor will assume `deny` makes a tool unreachable.

**Documented in `0940769da2`, verified.** Both the guide and the reference now say that `deny`
governs the agent's behaviour rather than the tool's reach, and both point the reader at the
control that is a boundary: the credential the connection was made with. The reference adds the
consequence explicitly, that `deny` should not be used to protect data the agent must not reach.

## The eight open findings

Both reviewers were asked to judge OR63, OR65 to OR68, OR76, OR81 and OR85.

| Finding | Disposition after round 1 |
| --- | --- |
| OR63 | Defer. Layering debt with no runtime consequence. Both reviewers agree. |
| OR65 | Defer, with the charge narrowed. See below. |
| OR66 | Defer, absorbing D11. |
| OR67 | Out of scope for this round; the diff reviewed was backend only. |
| OR68 | Fix the unbounded lock together with D4. Keep the no-op downgrade, whose docstring is honest about what cannot come back. |
| OR76 | Defer. The LLM plane ships disabled. |
| OR81 | Defer the upstream revocation, fix D5, and pair them in the product copy. |
| OR85 | Defer. Reconnecting through settings is a real workaround. |

**On OR65.** The blanket charge does not hold, and three of Codex's four specific examples do. The
strongest new suites are not mocked at the boundary: the grant-rekey suite runs the real `upgrade()`
against a real scratch database, and the disabled-plane acceptance suite drives a deployed stack
over HTTP. But the integration OAuth issuer at
`api/oss/tests/pytest/integration/gateways/conftest.py:178` returns a fixed client identity and
accepts a code without validating PKCE or client binding, so no test in the suite would fail if
that binding regressed. That one deserves its own follow-up.

**Closed findings that do not hold.** OR80's closure does not establish safe identity across the
ACP paths, which is D2. OR75's scanner does not cover transport-error disclosure, which is D1.

## Checked and found correct

Recorded so round 2 does not spend time here again.

- The migration's SQL slug arithmetic matches the Python helper in `api/oss/src/utils/helpers.py:56`.
- `mcps_endpoints` does carry `deleted_at`, so the migration's filter is valid SQL. It is a no-op in
  practice because endpoint deletion is a hard delete.
- Clearing the credential handle on disconnect genuinely clears the column, because the mapping is a
  full replacement.
- **The LLM plane's disabled fallback works, and the default configuration is not broken.**
  `sdks/python/agenta/sdk/agents/platform/connections.py:1084` calls the resolve route before any
  credential exchange, so the refusal envelope reaches the fallback and the vault path runs. This
  closes the independent-enablement blocker recorded in
  [mcp-release-status.md](../mcp-release-status.md). Covered end to end by
  `api/oss/tests/pytest/acceptance/gateways/test_llm_gateway_disabled_acceptance.py` and by nine
  cases in `sdks/python/oss/tests/pytest/unit/agents/platform/test_gateway_plane_fallbacks.py`.
- The plane switches are well covered: seventeen cases in
  `api/oss/tests/pytest/unit/gateways/test_gateways_plane_flags.py`, including that the switch sits
  in front of the permission check rather than instead of it, and that the OAuth attempt sweep keeps
  running while the plane is off.
- The audit attributes carry no secret and bound their caller-supplied fields
  (`api/oss/src/core/gateways/policy/audit.py:17`).
- The credential echo scanner covers both response headers and body before anything is relayed
  (`api/oss/src/core/gateways/mcps/providers/http/adapter.py:153`), so OR70 and OR75 hold for the
  successful-response path.
- The JSON serialisation change in `api/oss/src/dbs/postgres/secrets/mappings.py:54` is the correct
  fix for the new identifier field and does not change how any pre-existing field renders.

## Recommendation

**As reviewed:** do not ship, for four reasons and no more — D1, D2, D3 and D8.

**After the first round of fixes:** one reason remains, **D3**. The connect, disconnect and
invalidate paths still write a stale full snapshot, losing `tags` and `meta` and reverting a
concurrent administrator edit.

D1 and D2 are fixed and verified, D7, D9 and D17 with them. D8 was withdrawn on the evidence.
Everything still open is a fix-soon or a defer with a reason, and none of it needs to hold the
release once D3 lands.

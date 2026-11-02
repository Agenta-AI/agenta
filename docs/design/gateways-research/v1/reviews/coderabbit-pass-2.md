# CodeRabbit pass 2 — the tests and the configuration that runs them

Pass 1 reviewed the production source; its findings are in
[coderabbit-pass-1.md](coderabbit-pass-1.md). This pass covers what pass 1 excluded: the tests, the
configuration that runs them, and the infrastructure and repository configuration. The split exists
because CodeRabbit refuses any review above 300 changed files, so neither half fits alone.

**Reviewed revision:** `664838e419`, against base `236619ebb768`. Review submitted 2026-09-16.
**Scope:** 238 files, measured before the push and confirmed by CodeRabbit's own resolved filters.

15 findings: 6 Major, 9 Minor, by CodeRabbit's labelling. Dispositions are ours.

| Disposition | Count |
| --- | --- |
| Real | 9 |
| Deferred | 4 |
| Not applicable | 2 |

## One run was lost before this one

The first attempt was triggered at 12:42 and never ran. Another push landed seconds later and
CodeRabbit answered "Action not completed — Head commit changed", while its check row still read
"Review completed". That is the second time on this pull request that a CodeRabbit check has looked
green while nothing was reviewed, the first being the file-limit skip. **A push during the opening
minute of a review cancels it silently.** Re-triggered at 13:06 against the head above.

## What a test-file pass is for

A finding here rarely threatens what ships. It threatens whether the other evidence can be believed,
which for a release gate is worth as much. The findings divide accordingly:

- **False-green capable**, in order of how quietly they fail: P15, P7, P11, P12, P6.
- **Loud rather than silent**, costing time and confidence: P4, P14.
- **Shipped behaviour**: P10, and P9 as a deferred residual.
- **Repository process**: P1.

## Findings

| Id | File:line | Severity | Disposition | Note |
| --- | --- | --- | --- | --- |
| P1 | `.coderabbit.yaml:66` | Major | Real, tracked | The temporary `path_filters` block must be deleted before merge or it narrows every future pull request. Known and documented in the file itself, but the condition it names fails today: the diff against main is 78 insertions, not empty. Correct finding about a tracked item. |
| P2 | `acceptance/gateways/test_llm_gateway_proxy_acceptance.py:93` | Minor | Deferred | The fixture creates an endpoint and never deletes it. True, but the module is double-gated on the mocks flag and the LLM plane, which ships off, and slugs carry a unique suffix so leaked rows never collide. Dev-deployment hygiene. |
| P3 | `acceptance/gateways/test_mcp_gateway_oauth_acceptance.py:21` | Major | Deferred | Asks for the shared `env` object instead of `os.getenv`. Its premise is wrong: all three fields are already declared in `MockGatewaysConfig`. What is left is stylistic, and the convention it cites governs application config, not harness switches read by the test process, which is not the process under test. |
| P4 | `acceptance/gateways/test_mcp_gateway_proxy_acceptance.py:73` | Minor | **Real**, hygiene | Two endpoints created per run with no teardown, and unlike P2 this suite does run. Each pass leaves litter in the dev deployment. Unique slugs mean no cross-test interference, so it costs tidiness rather than trust. |
| P5 | `unit/gateways/test_gateways_egress.py:490` | Minor | Not applicable | Asks to clear the insecure-egress variable with monkeypatch. The dependency on the ambient process is deliberate and the test says so in its own comment: if the process exports the opt-out, the guard is not enforcing there either. Clearing it would turn a loud, self-explaining failure into a false pass. |
| P6 | `unit/webhooks/test_webhooks_utils.py:257` | Minor | **Real**, false-green capable | The `finally` reloads the modules before monkeypatch restores the deprecated aliases, so a process exporting either one leaves the insecure-webhook setting pinned wrong for every later test in that worker. New in this pull request. Conditional on an ambient alias, so unlikely in CI and nasty where it happens. |
| P7 | `api/run-tests.py:298` | Minor | **Real**, false-green capable | The generated `-m` is appended after forwarded arguments, and pytest takes the last one, so a caller's `-- -m acceptance` is silently discarded whenever a selection or dimension flag is also set. `hosting/docker-compose/test.sh` always injects `--fast`, so it takes that path. The operator gets a different selection than they asked for and a green answer to a question they did not pose. |
| P8 | `hosting/docker-compose/ee/README.md:15` | Minor | **Real**, docs | The README still says three ports; `env.sh` allocates five on dev and six with the object store. Someone sizing a port range off that sentence gets an allocation failure. |
| P9 | `sdks/.../unit/middlewares/running/test_vault.py:106` | Major | Deferred | Pass 1's M10 re-raised. The test only pins what the product decided, and the product's own docstring concedes the point: the request carries no field saying which kind of workflow it is. Recording a declared kind on the wire is an API and SDK change, out of scope here. |
| P10 | `sdks/.../utils/ssrf_guard_vectors.py:46` | Major | **Real, shipped behaviour** | See below. |
| P11 | `sdks/python/run-tests.py:267` | Major | **Real**, false-green capable | Any forwarded value containing a slash is treated as a test target, so `-- --basetemp /tmp/x` drops the resolved test directories and pytest falls back to its config's `testpaths`, losing both the license and layer scoping. Carries the same `-m` clobber as P7. |
| P12 | `services/run-tests.py:260` | Major | **Real**, false-green capable | The same code and the same two limbs. Here the target confusion usually widens collection rather than narrowing it, so it tends to surface as noise; the silent under-run risk is in the `-m` limb. |
| P13 | `services/runner/tests/unit/sandbox-agent-run-plan.test.ts:726` | Minor | Not applicable | Asks for a wrong-origin, same-path case. It exists, in `pi-gateway-mcp.test.ts`, which sets both API bases, passes a gateway-shaped URL on another origin with a real credential, and asserts the throw, alongside the accept case and the path-only fallback. CodeRabbit anchored on the wrong file. |
| P14 | `web/oss/tests/playwright/.../mcpConnections.ts:149` | Minor | **Real**, flakiness | Navigation compares the path only, and settings tabs are selected by query string, so the retry loop can exit on the wrong tab and burn the next locator's timeout. Fails loudly, so it costs run time rather than correctness. |
| P15 | `web/packages/agenta-entity-ui/tests/unit/mcpToolPermissions.render.test.tsx:326` | Minor | **Real**, false-green capable | The stub uses an Axios-shaped rejection that the code path cannot produce: every throw is funnelled into a protocol error first. So the test exercises the wrong branch, and the branch the real flow depends on could be deleted with this test still green. The file already documents this rule, having corrected two sibling cases for exactly this reason; the third was left behind. |

## P10, the one finding about shipped behaviour

`100.64.0.0/10`, the carrier-grade NAT range from RFC 6598, is not blocked by the SSRF guard, and
that guard is the same code in all three planes: the webhook checker, the SDK's network helper, and
the runner's generated table. The gateway's egress boundary adds no ranges of its own; it calls the
same helper.

The reason is that Python's `ipaddress` module returns false for every one of the six predicates the
guard tests on an address in that range, and the range is absent from its private-networks table.
The test helper records the gap honestly in a comment rather than hiding it.

The consequence for this release: an MCP endpoint URL is supplied by the tenant by design, and one
resolving into that range is relayed with the vault credential attached. The range is in everyday
use for cloud pod and service networks and for some mesh VPNs. The gap is pre-existing for webhooks
on main, but the MCP gateway is a materially more exposed surface than a webhook target, because
reaching it is the feature rather than an administrator's configuration choice.

## Recommended order

1. **P1**, delete the `path_filters` block. It blocks merge by its own stated condition.
2. **P10**, add the range to the shared blocked set. Product, security, and one line.
3. **P7, P11, P12**, combine the forwarded and generated `-m` and stop treating option values as
   test targets. These are what make every other green result in this record worth believing, and
   nothing tests the wrappers themselves.
4. **P15**, a one-line stub swap that removes a false green.
5. **P6, P14**, cheap, one removes a false green and one removes a flake.
6. **P4, P8**, hygiene and documentation.

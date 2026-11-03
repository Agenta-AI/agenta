# MCP QA and release gate

Status: all evidence pending. This gate concerns the MCP release, not later LLM SDK or wallet adoption.

## Mandatory coverage

| Journey | Automated evidence | Visible product evidence |
| --- | --- | --- |
| URL-first connection | Discovery/metadata/fallback cases; no tool write during probing | One Connect flow into OAuth and back, with editable suggested name |
| OAuth lifecycle | Single-use callback, project/user binding, cancellation, denied access, interrupted save | Correct pending/error/success states and retry without duplicate connection |
| Multiple accounts | A/B at one URL; separate grants/refresh/disconnect; name edits retain identity | Both selectable, configured account used, disconnect A leaves B working |
| Tools and permissions | Discovery maps to policy; allow/deny/ask/reject/resume; new/duplicate tool names | Tool list and permission editor; approval/rejection reflected in real execution |
| Recovery | Revocation, expiration, concurrent refresh, timeouts, safe retry | Reconnect works and preserves identity; failed discovery can retry after auth |
| Credentials and tenancy | Real middleware, foreign-project denial, secret redaction, outbound controls, migration compatibility | No exposed credentials in screens/replays; cross-account side effects absent |
| Release independence | MCP on with new LLM/wallet off; MCP off behavior; legacy model/starter path regression | Existing model flow continues; hidden later features stay unavailable |
| Audit | Available fields accurate, no tokens or unnecessary arguments | Failure can be diagnosed from safe context |
| Supported runners | Run supported MCP paths and schedule behavior; verify upstream side effects | Repeat representative journeys through actual agent UI |

The zero-auth and manual-credential fallbacks need tests if offered by the candidate. A required-provider or supported-runner row cannot silently skip. Record unsupported behavior in scope and obtain a product decision if it removes promised support.

## Test layers

Use unit tests for identity resolution, discovery classification and permission mapping. Use integration tests with real database/middleware and a controlled upstream for consent, isolation, migration and call side effects. Use UI acceptance tests and recorded browser QA for the actual workflow. Exercise at least the required real OAuth providers in addition to a mock issuer; a mock cannot prove every provider's registration behavior.

Use the repository's area test runners and current CI configuration. Read their options before running them; record exact commands and exit status. Run relevant agent-release-gate cells and new MCP coverage against the candidate. Do not use an unconfigured subscription/provider skip as a passing result.

## Evidence index

For each run record candidate SHA, base SHA, deployment URL/version, relevant non-secret flag values, scenario, result, command or UI steps, log/artifact/replay link, and unresolved findings. Match the candidate to the deployed image rather than assuming branch labels are sufficient.

Record Codex Astra medium and CodeRabbit review links/output references, reviewed revisions, every actionable finding and its disposition. Recheck fixed findings on the final integrated candidate.

## Release-ready checklist

- [ ] Independent account identity and any migration verified.
- [ ] Single Connect flow and fallback/error states verified.
- [ ] Per-tool permission enforcement verified through supported runners.
- [ ] OAuth recovery, isolation and credential boundaries verified.
- [ ] Required automated suites and CI pass on the final candidate.
- [ ] Recorded product QA and upstream side effects support the result.
- [ ] New LLM gateway and wallets remain disabled; legacy model path works.
- [ ] Existing unresolved code findings are classified for this release with evidence; no release-blocking finding remains.
- [ ] Codex gpt-6-astra, medium reasoning, reviewed the final candidate/fixes.
- [ ] CodeRabbit completed review; skips or service failures are not approval.
- [ ] Docs match implemented behavior; no planned capability is advertised as shipped.
- [ ] Data-preserving rollback/disable procedure verified in test environment.
- [ ] PR evidence index identifies the exact release-ready revision.

An unchecked mandatory item means NOT READY. A closed architecture topic or a large unit-test count is not a substitute. Production release remains a separate human action.

# Template loading acceptance

## Final acceptance, 2026-09-21

OpenSpec tasks 6.3 and 6.4 are complete. The main matrix ran against `45afb1bfd6456f7bb1225a9bf3e7b4c691828fc3` on the isolated Hetzner preview, using local Chromium as requested. A separate direct-playground test found that the composer passed the template name but omitted the selected package. Commit `f48618e0120d16ec2af1e7e4731bcb22830fa1b3` fixes that handoff. The affected in-place path was then verified at both widths against the mounted source matching that commit.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Template creation and reload | PASS | Legacy and `/m`, each at 1440 and 390 pixels, reopen the returned server session. The legacy phone gate was dismissed through View anyway. |
| Lost-response retry after reload | PASS | Intercepted the successful load response and aborted it as a network timeout. All four host/width combinations resent the same key and payload and returned the original workflow and session with `replayed=true`. |
| Two tabs racing the first same-key request | PASS | Two separate browser pages concurrently submitted one identical new request through fetch. All four host/width combinations returned one 201 and one replay 200 with identical workflow, session, execution, and input IDs. Both pages opened the returned session. This verifies same-key concurrency; independently initiated actions with different keys remain distinct. |
| Ordinary blank creation and reload | PASS | All four host/width combinations created an ordinary agent without calling the template loader and retained the first message after refresh. |
| Direct legacy playground creation | PASS | After the composer handoff fix, both widths called the template loader, adopted its server session in place, wrote its ID to the URL, and reopened that session after refresh. |
| Missing connection and inactive recipe | PASS | Loaded internal outbound-prospecting 1.0.1 without a mailbox binding. Durable acceptance returned in 1.71 seconds before the setup interaction completed. The agent displayed the ordinary request-input form, including Gmail/MCP/skip choices and weekday schedule choice/time/timezone. Submitted Skip mailbox and No schedule; the agent continued with fictional file drafts. |
| Durable state | PASS | Database read-back found one claimed input per tested race/timeout session and zero project schedules and subscriptions after the setup conversation. |

Focused backend verification: 99 template/session-start tests passed. The legacy TypeScript check and scoped ESLint/Prettier passed for the handoff correction. The repository-wide `pnpm lint-fix` command was attempted but could not replay Turbo logs because existing cache/log files on the shared checkout are not writable. Scoped lint completed successfully; this is not a claim that the full command passed.

## Historical CI blocker (cleared)

The final CI run on `45afb1bfd6` completed with two web acceptance errors: `playground/mcp-agent-config.spec.ts` and `settings/mcp-connect.spec.ts` cannot reach the required MCP mock at `http://127.0.0.1:9092`. The workflow and mock-test helper are unchanged from `release/v0.119.1`. The run reported 50 passing tests, two errors, and 39 skipped tests. See [the failed job](https://github.com/Agenta-AI/agenta/actions/runs/35615326542/job/106390914242).

Provision the mock where both the Railway API and the browser test runner can reach it, configure the supported mock URL variables, and rerun acceptance. Do not skip these suites or treat the missing dependency as a passing check. This session has no connected Railway management tool.

The user has authorized merging into `release/v0.119.1` once verification passes. Superpowers final verification is blocked by CI; development-branch completion and OpenSpec archival remain pending. No merge has been performed. Deferred subagents remain NOT IMPLEMENTED and unarchived.

## Release integration

CI on `5bd91e6ae7e6369f378cfacbc6af5b8c50db0e08` passed, including Railway web acceptance. This supersedes the earlier missing-mock blocker above. Integration with `release/v0.119.1` preserves the template loader's existing server session and the release branch's fresh blank-session/configuration behavior. Four regression tests cover server-session adoption, blank creation, ordinary seeded creation, and cancelled navigation. Final merge status is recorded on PR #6944.

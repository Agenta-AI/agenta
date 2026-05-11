# PR 4231 Synced Findings

> PR: `Agenta-AI/agenta#4231`
> Branch: `feat/llm-judge-chat-unification`
> Base: `main`
> Head synced: `d1862e55f`
> Synced on: `2026-05-01`

## Sources

- GitHub PR `#4231`: `https://github.com/Agenta-AI/agenta/pull/4231`
- GitHub issue `#4244`: `https://github.com/Agenta-AI/agenta/issues/4244`
- GitHub review comments fetched through the GitHub plugin comment surface on `2026-05-01`
- Shared findings references:
  - `agents/skills/shared/references/findings.schema.md`
  - `agents/skills/shared/references/findings.lifecycle.md`
- Local implementation:
  - `docs/design/prompt-runtime-unification/README.md`
  - `docs/design/prompt-runtime-unification/appendix-rendering-edge-cases.md`
  - `docs/design/prompt-runtime-unification/wp-b1-runtime-foundation/plan.md`
  - `sdk/agenta/sdk/engines/running/handlers.py`
  - `sdk/agenta/sdk/litellm/mockllm.py`
  - `sdk/agenta/sdk/utils/types.py`

## Sync Summary

- Re-checked the PR against the local branch on `2026-05-01`.
- The AWS credential-mutation risk remains present in code, but this PR path now defers that work to GitHub issue `#4244` while preserving the original PR-review provenance.
- The stale `api/sdk/...` code-path references in the RFC are fixed in this branch.
- The rendering-appendix table complaint is being treated as a false positive for this findings record.
- One previously reported runtime finding is already fixed in this branch: the guarded `_load_jinja2()` handling in `PromptTemplate._format_with_template`.

## Rules

- `findings.md` is the canonical synced findings record for this PR path.
- Keep all non-findings sections above `Open Findings`.
- Re-check each carried-forward finding against the current branch state before keeping it open.

## Notes

- A GitHub review reply says an external issue was created for the AWS credential-mutation risk. Per user direction, this synced record keeps the PR-thread provenance and closes the PR-path finding as deferred to issue `#4244`.
- Issue `#4244` captures the intended long-term resolution for the AWS path: remove `os.environ` mutation and pass request-scoped AWS session/client state into the Bedrock/Sagemaker integration.
- I did not include low-value newline-only review comments as findings.

## Open Questions

- None.

## Open Findings

## Closed Findings

### [CLOSED] F1. Judge runtime mutates process-global AWS credentials across an awaited LLM call

- ID: `F1`
- Origin: `sync`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `wontfix`
- Category: `Correctness`, `Security`, `Compatibility`
- Summary: `auto_ai_critique_v0` wraps `await mockllm.acompletion(...)` inside `mockllm.user_aws_credentials_from(provider_settings)`, and that context manager rewrites `os.environ`. This PR path intentionally does not fix that risk and defers the work to GitHub issue `#4244`.
- Evidence:
  - [handlers.py](sdk/agenta/sdk/engines/running/handlers.py:1020) keeps the credential-mutation context open across the awaited completion call.
  - [mockllm.py](sdk/agenta/sdk/litellm/mockllm.py:42) mutates process-global environment variables in `user_aws_credentials_from`.
  - PR review comment `3172964744` raised the same risk.
  - GitHub issue `#4244` documents the same concurrency hazard, scope, and acceptance criteria for the follow-up fix.
- Files:
  - `sdk/agenta/sdk/engines/running/handlers.py`
  - `sdk/agenta/sdk/litellm/mockllm.py`
- Cause: Provider credentials for AWS-backed custom models are injected through process-global environment variables instead of request-scoped client configuration.
- Explanation: The risk is real, but per user direction it is deferred out of this PR path and tracked in the dedicated follow-up issue. The synced record keeps both the PR-review provenance and the issue linkage.
- Suggested Fix:
  - Resolve via GitHub issue `#4244`.
- Alternatives:
  - Fix directly in this PR instead of deferring, but that is not the chosen disposition.
- Sources:
  - GitHub PR comment `3172964744`
  - GitHub PR reply `3173028409`
  - GitHub PR reply `3173029226`
  - GitHub issue `#4244`

### [CLOSED] F2. Rendering appendix still has a malformed Markdown table row

- ID: `F2`
- Origin: `sync`
- Lens: `verification`
- Severity: `P3`
- Confidence: `low`
- Status: `stale`
- Category: `Documentation`, `Completeness`
- Summary: Closed as a false positive per user direction.
- Evidence:
  - GitHub review comment `4210927738`
  - User disposition: `F2 is false positive`
- Files:
  - `docs/design/prompt-runtime-unification/appendix-rendering-edge-cases.md`
- Cause: Review feedback over-called a Markdown formatting concern.
- Explanation: This synced record no longer treats the appendix row as an actionable finding on this PR path.
- Suggested Fix:
  - None.
- Alternatives:
  - Reopen if the rendered doc or lint output proves the row is actually broken in the target renderer.
- Sources:
  - GitHub PR review comment `4210927738`
  - User disposition on `2026-05-01`

### [CLOSED] F3. RFC current-state section still points to obsolete `api/sdk/...` paths

- ID: `F3`
- Origin: `sync`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Documentation`, `Maintainability`
- Summary: The stale SDK path references in the RFC were updated to the current `sdk/agenta/sdk/...` locations in this branch.
- Evidence:
  - [README.md](docs/design/prompt-runtime-unification/README.md:36) now points to `sdk/agenta/sdk/utils/types.py`.
  - [README.md](docs/design/prompt-runtime-unification/README.md:42) now points to `sdk/agenta/sdk/engines/running/handlers.py`.
- Files:
  - `docs/design/prompt-runtime-unification/README.md`
- Cause: The RFC text had not been updated after the SDK/runtime code moved to the current repo layout.
- Explanation: The references now match the live repository structure, so the RFC is again auditable against the implementation it describes.
- Suggested Fix:
  - None.
- Alternatives:
  - None.
- Sources:
  - Local branch inspection on `2026-05-01`

### [CLOSED] F4. `_load_jinja2()` masking in `PromptTemplate._format_with_template`

- ID: `F4`
- Origin: `sync`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Robustness`
- Summary: The earlier PR review concern that `_load_jinja2()` could mask the original formatting exception is already fixed in this branch.
- Evidence:
  - [types.py](sdk/agenta/sdk/utils/types.py:732) now wraps `_load_jinja2()` in `try/except ImportError` before checking `TemplateError`.
  - `git log --grep='Guard _load_jinja2'` shows commit `477ee62f4`.
- Files:
  - `sdk/agenta/sdk/utils/types.py`
- Cause: The original implementation called `_load_jinja2()` unguarded inside a broad exception handler.
- Explanation: The current branch no longer has that failure mode, so this item should not remain open in the synced record.
- Suggested Fix:
  - None.
- Alternatives:
  - None.
- Sources:
  - GitHub PR comment `3170264586`
  - Local branch inspection on `2026-05-01`

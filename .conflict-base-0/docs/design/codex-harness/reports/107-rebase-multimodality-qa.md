# v0.107.0 rebase + codex multimodality — live QA

Date: 2026-08-02. Branch HEAD `b5a7cf6615` (merge `9d0ba57a35` bringing in v0.107.0, four
multimodality commits, two review-fix commits). Stack: the codex-harness worktree deployment
(`agenta-ee-dev-codex-harness`, EE dev images, traefik 8180), runner image rebuilt from the
branch before QA. Full evidence with verbatim frames and log lines lives in the session
artifacts; this file records what was proven and how.

## What changed and why QA was needed

v0.107.0 introduced the attachment pipeline (materialize → 4-layer capability gate → prompt
blocks). The pipeline is harness-agnostic except three independent gates, and codex was blocked
by all three: the runner's `ADAPTER_NATIVE_SUPPORT` table had no codex row, the SDK's
`model_input_modalities()` had no codex arm, and `codex_models.curated.json` declared every
model text-only. All three were fixed on this branch, plus a codex-specific 10 MiB inline
base64 cap (`CODEX_INLINE_BASE64_MAX_BYTES`) and a review-found guard: the legacy inline-image
path no longer assumes image capability on codex, because codex-acp rejects a whole prompt with
`invalidRequest` when its catalog says the model lacks image input (Claude/Pi merely degrade).

Method note (scope discipline): the approval matrix from `reports/warm-approvals-qa.md` was NOT
re-run; it is pre-merge-verified and the release gate covers it again at release time. This QA
tested only what the rebase and the multimodality commits could have changed, 8 checks.

## Results — 8/8 PASS

| # | Check | Verdict | Decisive evidence |
| --- | --- | --- | --- |
| 1 | Sandbox daemon reports codex image capability (local) | PASS | `getAgent("codex")` → `installed:true, images:true, fileAttachments:true` (codex-cli 0.146.0) |
| 2 | Codex image run end to end (local) | PASS | `outcome:native reasonCode:native_supported`; model read the digits ("7412") off the PNG; no `invalidRequest` |
| 3 | Over-cap image (8.27 MiB raw ≈ 11 MiB base64) | PASS | `workspace_only / provider_inline_cap`, turn completed normally, model never saw the pixels |
| 4 | Warm turn 2 still sees the workspace copy | PASS | zero delivery frames on turn 2 (live cwd reused), file readable (size matched exactly) |
| 5 | Non-codex regression sanity (`pi_core` image run) | PASS | `native / native_supported`, digits read — the gate refactor + fingerprint change broke nothing shared |
| 6 | Codex image run on DAYTONA | PASS (after snapshot re-rebuild, below) | `native / native_supported`, digits read; native outcome doubles as proof the Daytona daemon reports `images:true` |
| 7 | Approval smoke post-merge: ask parks + warm resume | PASS | all five criteria; parked tool-call id unchanged on resume; codeword survived |
| 8 | Legacy inline image on codex degrades, not hard-fails | PASS | `legacy inline image delivery=degraded reason=model_modality_unknown`, clean `finish`, no `invalidRequest` |

Notes:
- The over-cap boundary is 7.5-10 MiB raw: the API rejects >10 MiB images outright (413), and
  the runner cap compares base64 length, so `provider_inline_cap` only fires in that window.
- Check 8 sends a base64 image inline in the message content (the pre-catalog legacy path, no
  attachment upload) with no `modelCapabilities` on the request. Pre-fix this was the one
  reachable route to codex-acp's whole-prompt `invalidRequest`.

## Incident found during QA: the dev Daytona snapshot had drifted

Check 6 first FAILED: the Daytona session rejected every `gpt-5.6-*` model, offering the older
`gpt-5.3-codex/gpt-5.4/...` family. Cause, confirmed via the Daytona API: `agenta-agent-sandbox-v1`
in the dev account had been recreated on 2026-08-02 15:55 UTC from MAIN's recipe, replacing the
patched 2026-07-31 build. Main's recipe carries neither the codex-acp 1.1.7 pin nor the approval
patch, so the drift also silently reverted warm approvals on Daytona dev.

Fixed by re-running this branch's `images/sandbox/daytona/build_snapshot.py --force` against the
dev account (build log asserts `codex-acp-version=1.1.7` and `codex-acp-approvals=on-request`
in-image); check 6 then passed. **Standing hazard until this PR merges:** any snapshot rebuild
from main reverts the pin and the patch. After merge, main's recipe carries both and the hazard
disappears. Cloud stage accounts get the fix via the `agenta_cloud` rebuild workflow (PR #1662).

## Pre-existing observations (not this branch)

- The runner image's daemon reports `claude installed:false images:false`; Claude installs at
  runtime. Not a regression, recorded for context.
- When codex delivery downgrades to a workspace copy, the model may fabricate a guess instead of
  saying it cannot see the image (model behavior, gate worked correctly).

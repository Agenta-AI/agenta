---
id: silent-fallback
code: INV-6
title: Invoke endpoint silently falls back instead of validating — how to fix
status: resolved
needs_reply: false
promoted_to: ''
created: '2026-07-01T13:54:47Z'
updated: '2026-07-01T15:21:45Z'
---










# Invoke endpoint silently falls back instead of validating — how to fix

## Summary

RESOLVED (redundant, folded into the locked harden-invoke decision: OpenAPI off, optional clear-error validation).

## Messages


**Agent** · Jul 1, 13:54

User: silent fallback instead of validation errors made wrong-shape guessing expensive. How can we solve that?

**Agent** · Jul 1, 14:08

This is by-design looseness, not a targeted bug. Three things stack up:

- The request envelope models ignore unknown fields (Pydantic's default; `WorkflowRequestData` / `WorkflowInvokeRequest` at `sdks/python/agenta/sdk/models/workflows.py:237,296`).
- `parameters` is an unvalidated `Optional[dict]` (`workflows.py:239`).
- The agent-template parsing is best-effort with a per-field default fallback (`sdks/python/agenta/sdk/agents/dtos.py:1166-1204`).

So a misspelled field or wrong nesting is silently dropped and the run proceeds on defaults. The caller gets no 422 and no signal, which is what made the wrong-shape guessing so slow.

**Fix:** add strict validation scoped to the agent. Either return a 422 when `parameters` is non-empty but has no recognizable agent template, or validate `parameters.agent` against a strict model (`extra="forbid"`). The precedent already exists in the codebase: `WorkflowInvokeRequestFlags` uses `extra="forbid"` (`workflows.py:153`), as does `_SkillFileSchema`. Note this pairs naturally with the reference-only fix and the OpenAPI fix, since all three harden the same invoke route.

**Agent** · Jul 1, 14:47

On your two questions.

Validation, and why not blanket "forbid": you are right to push on this. I am not proposing we reject arbitrary extra fields wholesale, and definitely not on commit. The goal is narrow: when `parameters.agent` is present but a field is misspelled or wrong-nested, the run should say so clearly instead of silently using defaults. So the plan is to validate the KNOWN agent-config fields and return a clear, specific error or warning that names the bad field and why, while still leaving room for extra metadata the user may want to attach. Where the check lives (on the invoke request vs at commit) is part of what I will confirm. The point is fail-loud with a good message, not lock the shape down.

OpenAPI: agreed, we should not just flip it on blind. A subagent is checking what enabling `openapi_url` would actually generate for the invoke route on this codebase — whether FastAPI produces a correct, useful schema, or a misleading one, and the risks of turning it on for all three services at once. Meanwhile `/inspect` stays the contract. I will report what enabling it would really do before recommending anything.

Either way, I will fold these invoke edge cases (inline config, /inspect is the contract, the validation behavior) into the kit instructions so the agent handles them correctly regardless of what we change at the source.

**Agent** · Jul 1, 15:02

OpenAPI verdict from the research: do NOT enable it. It would render a technically valid but misleading schema — WorkflowInvokeRequest.parameters is a bare Optional[dict], so it shows as an opaque object and is identical across agent/completion/chat; the response side is already documented. No security risk, just doc-accuracy risk. /inspect is strictly better (concrete per-workflow JSON schema). Your instinct not to enable it was right. The validation half still stands: add a clear error when parameters.agent has an unrecognized/misspelled field, WITHOUT blanket forbid, so bad params fail loud instead of silently defaulting. That is the remaining optional fix.

**You** · Jul 1, 15:10

agian is this not a redundant therad. i am confused

**Agent** · Jul 1, 15:21

Agreed, redundant. silent-fallback and invoke-contract were two of your original notes, but they are the same route and are both captured in the locked harden-invoke decision (OpenAPI: keep off; validation: optional clear-error). Resolving both; the single place is the harden-invoke decision.

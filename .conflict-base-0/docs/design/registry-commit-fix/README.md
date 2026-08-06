# Registry Commit Fix

**Problem:** Committing a new revision from the registry page fails after a hard refresh with `"badly formed hexadecimal UUID string"`. The frontend incorrectly routes the commit through the legacy `PUT /variants/{variantId}/parameters` endpoint instead of the workflow `POST /workflows/revisions/commit` endpoint.

**Scope:** Frontend only. Make the registry commit flow always use the workflow commit path.

The current implementation plan is intentionally narrow: fix the commit path now, and treat create/delete as separate follow-ups unless we reproduce the same cold-refresh bug there.

## Files

- `context.md` — Background, root cause analysis, the two bugs
- `plan.md` — Step-by-step execution plan
- `research.md` — Code paths, data flow, key file references
- `status.md` — Progress tracker

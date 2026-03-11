# Registry Commit Fix

**Problem:** Committing a new revision from the registry page fails after a hard refresh with `"badly formed hexadecimal UUID string"`. The frontend incorrectly routes the commit through the legacy `PUT /variants/{variantId}/parameters` endpoint instead of the workflow `POST /preview/workflows/revisions/commit` endpoint.

**Scope:** Frontend only. Make the registry commit flow always use the workflow commit path.

## Files

- `context.md` — Background, root cause analysis, the two bugs
- `plan.md` — Step-by-step execution plan
- `research.md` — Code paths, data flow, key file references
- `status.md` — Progress tracker

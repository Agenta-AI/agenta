# Thread 01 — The agent edits and saves itself (commit_revision)

## Context

`commit_revision` lets an agent change its own config and save it as a new version.
Two bugs blocked it, and the core save path got reworked twice. We are now making the
agent-facing logic a proper tool instead of baking it into the core router.

## Explanations

- The tool is "update yourself." The model never names the variant; the runner binds
  it. The targeting detail lives in thread 03.
- **Bug B (clobber):** the model sends only the fields it changes. The old endpoint
  treated that partial payload as the whole config, so everything omitted got deleted.
- **#4936's fix:** added a second core endpoint, `/revisions/commit/patch`, that
  deep-merges. Rejected, because merge logic does not belong in the core workflows
  router.
- **JP's delta (commit `4ae6289d68`):** one commit endpoint takes either `data` (full
  replace) or `delta` (set / remove ops). The delta base is the variant's LATEST
  committed revision (`service.py:1915-1935`). Cleaner than the patch endpoint, and it
  supports delete. Still lives in core.
- A delta or data commit requires `workflow_variant_id`; it returns 400 if absent
  (`router.py:1526-1530`). On a draft there is no variant, so commit fails closed.
  See thread 03.
- You noted we already added an Agenta tool next to the Composio tools, through a tool
  router. That is the candidate home for the agent-facing patch and validation logic.

## History

- 2026-06-30 ~04:20 — #4936 merged with the `/commit/patch` endpoint (patch in core).
- 2026-06-30 06:58 — JP reworked it into the `delta` model (`4ae6289d68`), still in core.
- We reviewed, rejected patch-in-core, found JP's delta, decided to keep delta and drop
  the revert.
- Revert PR #4975 was opened then closed; the workspace is back on JP's delta.

## Open decision threads

**D1. Where does the agent-facing `commit_revision` logic live?**
- (a) In the Agenta tool layer / tool router (your lean): the tool reads the current
  revision, validates, builds the delta, and calls JP's core commit. Core stays a clean
  primitive.
- (b) Keep it in core (JP's delta as is) and let the platform op call it directly.

My recommendation: (a). It honors "not in the core router," keeps JP's delta as the
clean primitive, and puts agent-specific validation and UX in the tool where it belongs.
I will bring a concrete organization proposal (file layout, where the tool registers,
how it calls core).

Your decision: **(a) — approved.** Dispatched a plan-feature task: research + design
docs for adding a new schema-validating tool to the `/tool` router (the commit_revision
logic on top of JP's delta), landing under `projects/commit-revision-tool/`. The draft
PR follows once the invoke-URL PR frees the git-writer (one git-writer at a time).

DESIGN LANDED (`projects/commit-revision-tool/design.md`): a dedicated tools-domain endpoint
`POST /api/tools/agenta/commit-revision` (NOT the generic `/tools/call`, which cannot carry
`runContext` and would break self-targeting), backed by a new `core/tools/agenta/commit.py`.
Repoint the SDK op `path` one line; it stays a direct-call `platform` op, so the `$ctx`
binding, the SSRF guard, and the draft fail-closed behavior all keep working with zero runner
change. The tool reads the variant's latest committed revision, deep-merges the `delta`,
validates the merged `parameters.agent` against the strict `agent-template` schema, then calls
JP's core `commit_workflow_revision` with the delta (core stays the single merge authority).
Risk O5: the strict schema may reject already-non-conforming stored configs; verify in the
live test (or validate only the changed subtree).

**D2. Should the tool use `delta` (set/remove) or `data` (replace)?**
Likely `delta`, so partial edits and field deletes both work.

Your decision: **delta** (design confirms it: partial edits do not clobber omitted fields,
`delta.remove` is the only way to delete a field, and delta merges onto the same
latest-revision base the validator reads, so model and validator never disagree).

# Analysis of `docs/design` and `docs/designs`

Note:

This analysis describes the state before those two trees were merged into `docs/sdlc/projects/`.

## Question

Do `docs/design` and `docs/designs` currently behave like project content?

Short answer:

- `docs/design` = yes, strongly
- `docs/designs` = mostly yes, with some folders already drifting toward more durable product/system/process documentation

## `docs/design` analysis

Top-level directories inspected: 20.

The file pattern is extremely consistent with project workspaces:

- 20/20 have `README.md`
- 19/20 have `context.md`
- 19/20 have `plan.md`
- 19/20 have `research.md`
- 20/20 have `status`-style files
- several have `qa`, `prd`, `rfc`, `CR.*`, `PR.*`

Representative examples:

- `annotation-queue-v2`
- `stateless-playground`
- `migrate-evaluator-playground`
- `railway-preview-environments`

These are clearly initiative-scoped working-memory folders.

### Conclusion for `docs/design`

Treat `docs/design/*` as internal project docs.

This is the cleanest current reading.

## `docs/designs` analysis

Top-level directories inspected: 13.

This tree is more mixed in style, but still mostly project-derived.

Observed patterns:

- many folders contain `PR.md`, `PRD.md`, `RFC.md`, `QA.md`, `CR.*`, `status`, `plan`
- many also contain `*.specs.md`, `*.initial.specs.md`, implementation summaries, and other more durable-looking reference files

Representative examples:

- `folders`: `PRD.md`, `RFC.md`, `PR.md`
- `snippets`: `PRD.md`, `RFC.md`, `PR.md`
- `tags`: `PRD.md`, `RFC.md`, `PR.md`
- `gateway-tools`: `plan.md`, `status.md`, `PR.md`, `CR.md`, specs, implementation notes
- `loadables`: `CR.*`, `*.specs.md`
- `advanced-auth`: spec pack plus `PR.md`, `QA.md`, implementation status

### What this means

`docs/designs` is not cleanly "durable canonical docs" yet.

It is better described as:

- project/initiative content that has been organized into more formal design/spec packs
- in some cases, partially distilled project output

So while some content in `docs/designs` clearly wants to become:

- internal system docs
- internal product docs
- internal process docs

the tree as it stands still looks mostly project-oriented.

## Useful distinction

The difference between the two trees is not "project vs non-project".

It is more like:

- `docs/design` = active project workspaces / working memory
- `docs/designs` = project-derived design/spec packs, often more crystallized, but still mostly initiative-scoped

## Practical recommendation for the reorganization

For the next step, use this simplifying assumption:

- treat all of `docs/design/*` as internal project docs
- treat all of `docs/designs/*` as project-derived content that should stay in the "to reorganize" bucket for now

In other words:

- do **not** assume `docs/designs/*` is already cleanly split into internal process/system/product docs
- do **not** try to preserve the current `design` vs `designs` distinction as if it already encodes the final taxonomy

## Recommended working assumption

For wave 1 of the reorganization:

1. `docs/design/*` -> internal project docs source pool
2. `docs/designs/*` -> mixed project-derived source pool

Then later:

- extract durable system-definition material into `docs/sdlc/system/*`
- extract durable product-definition material into `docs/sdlc/product/*`
- extract durable process/lifecycle material into `docs/sdlc/process/*`

## Notable exceptions / closest-to-durable folders

The folders that already feel least like pure project memory are:

- `docs/designs/testing`
- `docs/designs/advanced-auth`
- `docs/designs/api-rate-limiting`
- `docs/designs/loadables`

Even there, the presence of `PR`, `QA`, `status`, `initial`, `CR`, and similar files still suggests project lineage rather than a final clean taxonomy.

## Bottom line

Yes:

- `docs/design/*` clearly looks like project content
- `docs/designs/*` also still mostly looks like project content, just more formalized and more spec-heavy

So for now, it is reasonable to treat both trees as reorganization inputs rather than as already-canonical destinations.

# Proposal

## Goal

Support both missing behaviors without splitting the product into unrelated special cases:

1. query-backed live/batch runs should be able to carry human/custom evaluator work as pending/manual steps
2. annotation queues should be creatable from higher-level query/testset sources, while still executing on concrete source items
3. existing loop topologies should be extended or new loops added where needed, but not unified into a single normalized runtime path in this work

## Proposed Model

Keep the current loop families, and extend them where necessary:

- query-backed loops should remain query-backed
- testset-backed loops should remain testset-backed
- queue-backed loops should remain queue-backed
- if a new loop is needed for a specific case, introduce it explicitly rather than forcing a shared abstraction

Where the runtime already accepts concrete execution items, keep that path stable.
Where a new setup form is needed, add a source-to-item translation layer at the edge of that loop, not a shared unified runtime model.

## Query-Backed Runs

Query-backed runs should gain the same pending/manual evaluator semantics that testset-backed runs already use.

Proposed behavior:

- auto evaluators execute immediately
- human evaluators create pending annotation work
- custom evaluators create pending annotation work
- the run keeps scenario/result structure even when some annotation steps are not auto-executed

Implementation shape:

- reuse the existing scenario/result creation model
- add a manual-annotation branch to the query-backed workers
- persist pending step state instead of skipping the step entirely

## Annotation Queues

Queues should be creatable from:

- query revisions
- testset revisions

The server should resolve those sources into concrete execution items, while preserving the source revision in the run step definitions:

- query revision -> source step references the query revision, execution materializes trace IDs
- testset revision -> source step references the testset revision, execution materializes testcase IDs

The concrete execution items remain:

- trace IDs for query-backed queues
- testcase IDs for testset-backed queues

The existing low-level queue endpoints must remain fully supported:

- trace IDs stay a valid direct input
- testcase IDs stay a valid direct input
- no existing queue flow should be removed or downgraded

This preserves the current execution model while lifting the setup API one level higher.

This proposal does not require collapsing queues, query runs, and testset runs into a shared loop abstraction.

## API Shape

Add source-aware request models that can express:

- `source_kind`
- `source_ids` or source refs
- evaluator set
- repeat/assignment settings

The existing trace/testcase queue endpoints remain the low-level direct path.
The new source-aware path is additive and should resolve to the same execution layer, not replace it.
For the new path, the created run should keep the query/testset revision in the step definitions so the queue is attributable and reproducible.

## Compatibility

The proposal should not break:

- existing auto evaluation runs
- existing live query runs
- existing queue creation from trace IDs or testcase IDs

The new source-aware path should be additive.
It should not introduce a requirement to normalize every loop behind one common runtime object.

# Gap Analysis

## Query-Backed Runs

Missing from current state:

- no pending/manual path for human evaluators
- no pending/manual path for custom evaluators
- no persistence model for manual annotation tasks in query-backed runs

## Queue Setup

Missing from current state:

- queues cannot be created from query revisions directly
- queues cannot be created from testset revisions directly
- queue APIs only accept trace IDs or testcase IDs
- there is no source-aware queue request model
- there is no source resolver layer that turns a query or testset source into execution items
- there is no queue run shape that preserves the query/testset revision in the step definitions for a source-aware queue

## Runtime Model

Missing from current state:

- a common pending/manual step lifecycle for query-backed and queue-backed flows
- explicit product-level semantics for human/custom annotation work in query-backed runs

Not in scope for this effort:

- a single unified loop abstraction
- a single normalized source model for all evaluation families
- collapsing query, testset, and queue execution into one runtime path

## API Surface

Missing from current state:

- request schemas for source-based queue creation
- request schemas for query-backed manual annotation setup
- server-side validation that distinguishes source kind from execution item kind
- response payloads that explain the resolved execution items back to the client
- run-data builders that include the revision source in the queue step definitions while still materializing trace/testcase items

## UI Surface

Not in scope for this effort:

- source pickers
- queue creation screens
- user-facing copy changes
- any other web-layer work

## Tests

Missing from current state:

- query-backed runs with human evaluators remaining pending
- query-backed runs with custom evaluators remaining pending
- queue creation from query revisions
- queue creation from testset revisions
- queue runs that assert the revision source is preserved in the step definitions
- validation failures for invalid source kinds
- regression tests for current trace/testcase queue behavior

## Docs

Missing from current state:

- a single user-facing explanation of the supported evaluation source matrix
- setup documentation for the new source-aware proposal
- migration guidance for moving from trace/testcase queue inputs to source-based setup

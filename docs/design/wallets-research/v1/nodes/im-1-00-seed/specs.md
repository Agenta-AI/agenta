# IM-1-00 specification: contract seed review

Review and merge `WP-1-00` as the Wave 1 seed commit. Every later Wave 1 worktree forks from the
commit this node produces, so an error here is inherited by three packages.

## What must be true to merge

| Check | How to verify |
| --- | --- |
| No implementation leaked in | every port body raises `NotImplementedError`; grep the diff for `xadd`, `session`, `engine`, `APIRouter` |
| No migration | the diff touches no `migrations/` path |
| No worker logic | the `DebitWorker` shell constructs and raises `NotImplementedError`; no processing body, and no change to `api/entrypoints/worker_streams.py` |
| The shell is constructible | instantiate it in a throwaway test, so `WP-1-02` can register a stream against it |
| The envelopes match `entities.md` | field by field against §"`streams:measurements`" and §"`streams:debits`" |
| The asymmetry is intentional and present | `organization_id` optional on the measurement envelope, required on the debit envelope |
| No provider or cost data on the debit envelope | the test over `DebitCommandV1.model_fields.keys()` exists and passes |
| One import path per concept | no duplicate DTO or enum across the two domains |
| The split-identity rule is written down | `WalletSettlementPort.settle`'s docstring states posting key plus actual funding source, never an invented sequence |
| Fixtures are usable | a throwaway test constructs both envelopes overriding one field each |
| Terminal versus retryable is declared | all four errors carry the docstring saying which they are |

## Output

The merged commit SHA, recorded as the fork point for `WP-1-01` and `WP-1-02`. Neither may fork
before it exists.

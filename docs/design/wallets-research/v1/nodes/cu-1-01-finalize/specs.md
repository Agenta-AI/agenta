# CU-1-01 specification: final cleanup and deployment handoff

Clean only what the merged Wave 1 implementation exposed. This is a real node with its own worktree,
not informal post-merge tidying.

## Scope

| Do | Do not |
| --- | --- |
| Remove terminology the delivered code superseded | rename anything the code still uses |
| Synchronise `entities.md`, `wave-1.md` and the node documents with delivered names, limits and migration ids | reopen a settled design question |
| Close the open-design items Wave 1 actually answered, and only those | mark an item decided that the wave merely worked around |
| Record the delivered `MAXLEN`, consumer-group names and stream names | tune them without a measured reason |
| Run repository-level checks | expand into SBX, live providers, L1 exposure, rollups, or store separation |

The design documents are the deliverable here as much as the code. A name that changed during
implementation and was not written back is how the next wave inherits a lie.

## Handoff

The deployment is the user's, not this node's. Produce the branch and the acceptance procedure; the
local deployment and the acceptance run happen on it afterwards.

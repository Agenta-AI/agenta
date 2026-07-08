# In-place reconfiguration of a live session

The follow-up to keep-alive Decision 2. It answers one question: when the user edits the agent's configuration mid-conversation, can the runner reconfigure the live parked session in place, instead of evicting it and cold-starting a fresh one?

Keep-alive v1 evicts and cold-starts on any config change (Decision 2, "option C"). That is the simplest correct thing for the first release. It is not the only thing possible. Much of the config can change on a running harness without tearing the process down: the model is already set live today, the instructions and skills are workspace files the harness can re-read, and the tool list is a dynamic MCP surface. This design lays out the in-place path per config dimension, and the rule for the mixed case where some dimensions can update live and others still need a respawn.

## Files

- [design.md](design.md): the full design. The mental model, the per-dimension classification table, an in-place update design for each important dimension, the partial-reconfiguration rule that splits the config fingerprint into a live-updatable set and a respawn-required set, and the honest risks.

## Read first

- [../../architecture-notes.md](../../architecture-notes.md) Decision 2 ("the two fingerprints") and its config-change subsection. This design is the deep dive behind that subsection.
- [../../architecture-notes.md](../../architecture-notes.md) Part 1 ("What one turn builds today"), for how config is baked at `createSession`.
- [../../../approval-boundary/how-approvals-work.md](../../../approval-boundary/how-approvals-work.md), for what the config contains (harness rules, per-tool and per-MCP permissions, skills, instructions).

## Status

Design only. It builds on keep-alive slices 1 and 2 and is sequenced after them. v1 keeps option C; nothing here changes v1.

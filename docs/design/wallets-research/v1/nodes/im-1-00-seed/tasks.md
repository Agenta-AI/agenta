# IM-1-00 tasks

1. Merge `WP-1-00` in the IM worktree.
2. Walk the ten checks in the specification; record the result of each.
3. Verify the envelope fields against `entities.md` one at a time, not by skimming.
4. Run the DTO and serialization unit tests.
5. Write a throwaway test that builds both envelopes from the fixtures overriding a single field, to
   prove the builders are usable before three packages depend on them. Delete it after.
6. Record the merged commit SHA in `wave-1.md` as the Wave 1 fork point.
7. Release `WP-1-01` and `WP-1-02` to fork.

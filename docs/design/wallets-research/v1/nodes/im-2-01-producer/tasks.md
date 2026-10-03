# IM-2-01 tasks

1. Merge `WP-2-01` and `WP-2-02` in the IM worktrees, gateway side first.
2. Walk the nine checks and record each result.
3. Put the emitted component keys and the priced component keys in one table and compare them.
4. Take one real usage payload per protocol and follow it by hand to a charge. Record the
   arithmetic in this node's record, not just the assertion.
5. Record the drain finding verbatim. If the non-streaming path did not record, record what
   fixed it and what test now pins it.
6. Record whether `SecretOrigin.LOCAL` is producible. If it is not, stop and raise it: every
   charge decision downstream reads that stamp.
7. Run the suites on both branches and record the counts before releasing the next two nodes.

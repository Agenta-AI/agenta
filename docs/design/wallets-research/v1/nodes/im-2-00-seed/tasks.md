# IM-2-00 tasks

1. Merge `WP-2-00`'s gateway commit first, then its wallet commit. The wallet side imports
   gateway-declared ports; reviewing it against an unmerged gateway commit reviews a guess.
2. Walk the nine checks in the specification and record the result of each.
3. Read the field-role table against the actual code, field by field.
4. Write down, in this node's record, what an MCP measurement and a sandbox measurement would
   put in `components`. If either needs a key that does not exist, add it here.
5. Run both unit suites and record the counts.
6. Record the two SHAs and the exported names before releasing `WP-2-01` and `WP-2-02` to fork.

# When to act (optional)

Load when the caller asks when to act on each finding.

- **Before merge or implementation**: the finding is on new surface that will ship, or on a
  migration not yet written.
- **Now, bounded**: a small fix that does not change shipped names.
- **Follow-up, with a trigger**: pre-existing and stable; name the event that should start
  the work (for example "the next change that touches both folders").

A rename of a shipped name follows a safe order: pin the behavior with a test, add the new
name, move every caller, then remove the old name in a later release (expand and contract).

Add one line per finding: `- When: Before merge | Now | Follow-up (<trigger>)`.

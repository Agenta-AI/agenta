# Honest contracts (optional)

Load this page when a name, a status or a response could claim more than the operation does.

- **Queued is not done.** An action that starts work (sends an OAuth redirect, enqueues a
  job) returns a name or status that says "started", not "connected" or "sent". The UI shows
  the done state only after the result is stored.
- **Query is not command.** A read does not change business state. A function named `get_`,
  `fetch_`, `list_` or `read_` has no side effects that a caller would notice. A read that
  must write (a lazy fill) says so in its contract.
- **Borrowed is not owned.** A name that hands over an object says whether the caller now
  owns it (must close, may change) or only borrows it.
- **Similar names, same semantics.** Two operations with parallel names (`connect` on two
  kinds) behave the same way: same effects, same errors, same timing. Where they cannot, the
  names differ.

Evidence for a finding: the name, the actual effect, and the caller who acts on the wrong
belief.

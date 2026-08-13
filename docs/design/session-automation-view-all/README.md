# Automation Runs View All

This folder describes the route state used when an agent Overview page opens its session list.

Read `context.md` for the user-visible bug, `plan.md` for the implemented change, `research.md`
for the relevant code paths, and `status.md` for validation status.

Terms:

- An automation run is a session started by a trigger, such as a schedule or an event.
- A session scope is the existing in-memory filter input that selects which sessions the list
  requests.
- Route mode is the public `mode` query parameter used to restore a session scope from a URL.

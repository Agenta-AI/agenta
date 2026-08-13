# Implemented Design

The Automation runs View all link now points to the agent sessions URL with
`mode=automation`. The Sessions View all link remains unchanged.

The agent sessions route parses `mode` through a small pure function. When it receives the
supported automation value, it returns the existing session scope `{origin: "trigger"}`. The
route applies that scope before it mounts `SessionsPage`.

Applying the scope sets the existing `sessionShowTriggeredAtom`. The session list then selects
its existing `trigger-only` request policy. No new backend parameter or shared state contract is
introduced.

Unknown, missing, and repeated `mode` parameters return no scope. Those URLs keep the existing
Sessions behavior and do not overwrite the user's active filters.

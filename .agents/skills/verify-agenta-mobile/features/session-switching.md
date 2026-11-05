# Session switching

Sessions of an agent show as tabs in the top bar. A switch swaps the transcript and keeps the frame up, with no spinner and no config pane teardown.

## Sub-features

- `switch-same-agent` keeps the config pane mounted.
- `switch-other-agent` shows that agent's own name and config.

## How to get to it (user POV)

- Choose a tab in the top bar.
- Choose a session in the sidebar under `Sessions`.

## Driving it with Claude in Chrome

Preconditions: the baseline, plus a session of a second agent from `pick-fixture.sh`.

- **Same agent.** Run `await __v.go(__v.sessionB)` and sample `__v.words()` every 250 ms. It stays a number at every sample.
- **Other agent.** Run `await __v.go("<other-session>")`. `__v.words()` changes to that agent's count, and `__v.pill()` stays null.
- **Proof.** Screenshot both sessions, with the agent name visible in the top bar.

## Gotchas

- `header` has no text in the desktop bar, so read the name from a screenshot.
- During a switch the bar holds the last session's revision and agent until the new ones resolve.

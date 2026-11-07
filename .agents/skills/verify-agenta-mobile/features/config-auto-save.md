# Config auto-save

A change in the config pane saves itself as a new version. There is no Save button. The session follows its own commit.

## Sub-features

- `save-permissions` changes the policy in `Permissions`.

## How to get to it (user POV)

- Open a session. In the config pane, open the `Permissions` dropdown and choose another policy.

## Driving it with Claude in Chrome

Preconditions: the baseline.

- **Change.** Choose the dropdown under `Permissions`, then `Ask`. The version button's aria-label reads `Version N, Saving…` and then `Version N+1, Saved`. Read the aria-label, because the visible words hide below the `sm` width.
- **Confirm.** Read the latest version from `workflows/revisions/retrieve`. It equals `N+1`, and the row reads `Policy · Ask`.
- **Proof.** Screenshot the row, then set the policy back.

## Gotchas

- The status label is hidden when settled, about 2 seconds after a save.

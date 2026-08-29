# Context

## The symptom

The agent playground binds forty-three keyboard shortcuts. They live in six separate files:

| File                                                                                    | What it binds                     |
| --------------------------------------------------------------------------------------- | --------------------------------- |
| `web/oss/src/components/AgentChatSlice/hooks/useSessionShortcuts.ts`                    | the session and panel Alt chords  |
| `web/oss/src/components/AgentChatSlice/AgentConversation.tsx`                           | `Esc` to stop, `Alt+G` to approve |
| `web/packages/agenta-ui/src/RichChatInput/plugins/SubmitPlugin.tsx`                     | the composer's Enter behaviour    |
| `web/oss/src/components/AgentChatSlice/components/SlashCommand/useRovingList.ts`        | the command picker                |
| `web/packages/agenta-chat/src/components/ApprovalCard.tsx`, `ConnectionDock.tsx`        | approve, deny, connect            |
| `web/packages/agenta-chat/src/components/ElicitationDock.tsx`, `hooks/usePushToTalk.ts` | the agent's forms, and dictation  |

Six of the forty-three named a key on screen: the composer's send and newline hints, three in the
elicitation dock, and the voice button's hold label. The other thirty-four were invisible. A
user could only find them by reading the source.

Eleven of them answer no control at all. `Alt+1…9` and the `Alt+Z` / `Alt+X` pair switch
sessions, and there is no button anywhere to hang a tooltip on, so a tooltip pass alone could
never make them discoverable.

## What the user asked for

1. Find every shortcut and list them.
2. Propose where each one becomes visible.
3. Show the proposal in Storybook so it can be judged by eye before anything ships.
4. Confirm the shortcuts work on Windows, Linux and macOS, and change them if they do not.

## Decisions the user made

- The approval card shows its keys as keycaps inside the Approve and Deny buttons. Two other
  variants were built and rejected: a hint line under the buttons, and tooltips only.
- No first-run nudge on the session strip. Shortcuts appear on their controls and in the
  sheet, nowhere else.
- The shortcuts button sits at the right edge of the playground top bar, not in the session
  bar.
- The sheet must fit a 15 inch screen without scrolling.

## Related

- `docs/design/agents-md-compartmentalization/playbook.md` for where instructions live.
- The `agenta-package-practices` skill for the package placement rules this work follows.

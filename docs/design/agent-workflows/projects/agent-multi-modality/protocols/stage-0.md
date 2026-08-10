# Stage 0 protocol: gate the ungated paste and drag-to-attach paths

Stage 0 of [plan.md](../plan.md) closes the silent-failure gap: paste-to-attach and
drag-and-drop-to-attach predated the `NEXT_PUBLIC_AGENT_FILE_UPLOADS` flag and were live ungated,
so a pasted screenshot reached the runner and was flattened to a useless `[image]` placeholder with
no warning. This protocol records what was done, what was found along the way, and every decision
made during implementation that the plan did not spell out.

## What was done

One file changed: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx`.

- The shared guard `attachmentsBlocked` now includes `!uploadsEnabled`. This guard was already
  called at every user-facing entry point (`onDragEnter`, `onDragOver`, `onDrop`, and the
  `onPasteFile` callback), so one line gates all four paths with the same mechanism the feature
  already used for "recording in flight" and "composer disabled".
- Two comments that documented the old ungated behavior were corrected.

Verified with `pnpm lint-fix` (clean on the touched file) and the repo's fast typecheck
(`tsgo --noEmit`, zero errors).

## Flag-off behavior

- Dropping a file attaches nothing, shows no toast, and the drop overlay never appears; the drag
  cursor shows "no drop".
- Pasting a screenshot inserts nothing. Plain-text paste is untouched, because the rich-input layer
  only intercepts pastes whose clipboard carries files.
- With the flag on, the guard expression is byte-for-byte the old behavior.

## Implicit decisions and their tradeoffs

1. **The panel stays a drop target even when the flag is off; a drop is swallowed, not released to
   the browser.** The handlers call `preventDefault()` before the guard returns. This ordering
   pre-existed for the other blocked states, and the reason is that a browser's default action for
   a dropped file is to navigate to it, which unloads the app and destroys the conversation.
   Tradeoff: a person who drops a file gets no feedback beyond the "no drop" cursor. The
   alternative, an explanatory toast, was rejected because Stage 0 gates a dark feature; the toast
   would advertise a capability that does not exist yet.
2. **A paste that carries files is consumed entirely, not degraded to its text part.** The
   rich-input layer prevents the default paste for any clipboard that has files, to stop the editor
   from inserting the junk HTML sibling of a pasted image. With the flag off, the file then goes
   nowhere. Tradeoff: a clipboard carrying both a file and meaningful text loses the text. This
   matches the pre-existing blocked-state behavior; the common case (a screenshot) would otherwise
   paste junk markup.
3. **The voice-recorder completion path is deliberately not gated by the uploads flag.** A finished
   recording calls `addFiles` below the guard, and voice has its own flag
   (`NEXT_PUBLIC_AGENT_VOICE_INPUT`). Consequence: if voice were enabled while uploads is off, a
   recorded clip would still land in the attachment tray. Both flags are off by default today, so
   the combination is unreachable, but the two flags independently guard overlapping machinery.
   This becomes relevant in Stage 2 when the voice flag turns on; the Stage 2 work should decide
   whether the recorder's output should respect the uploads flag.

## Audit: other entry points to the attachment state

- `validateIncoming` has exactly one caller (`addFiles` in `AgentConversation.tsx`); no other
  component imports it.
- The hidden file input in `ComposerAttachments.tsx` is not directly flag-gated but is unreachable
  with the flag off: the tray renders only when attachments are open or files exist, and neither
  can become true when the attach button is dead and `addFiles` is unreachable. Left unchanged.
- Drive-staged files and the attachment viewer drawer were already gated.
- The rich-input paste interception is ungated in the package layer but inert unless a consumer
  passes `onPasteFile`; the only consumer's callback is now guarded.

## Live QA (dev stack, 2026-07-31)

Both flag states were verified in a browser against the running dev stack, with synthetic
paste and drag events dispatched at the real composer.

- Flag off: a pasted image file attaches nothing; plain-text paste inserts normally; a file
  drag shows no overlay; the drop is swallowed (`preventDefault` fires, so the browser does
  not navigate to the file) and attaches nothing.
- Flag on: the attach button is enabled; a pasted image renders the attachment chip (file
  counter "1 / 5"); plain-text paste is unaffected; a file drag shows the "Drop files here"
  overlay. The guard is inert when the flag is true.

## Issues found

None beyond the gap itself. No behavior change was needed outside the one guard. During
flag-on QA the Next.js dev server dropped the login session once after a hot-reload cycle;
that is a dev-server artifact unrelated to this change.

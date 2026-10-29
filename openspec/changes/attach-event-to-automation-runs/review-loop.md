<!-- review-loop: design=5335c10a7e37 lenses=simplify,naming -->

**Review loop result** for design hash `5335c10a7e37`, checked against repo commit `d2651bc1d96924d80e842c636feac54f5ce18a3d` (tip of `release/v0.127.1`), 3 rounds.

| Lens | Round 1 | Round 2 | Round 3 (final) |
| --- | --- | --- | --- |
| Simplify (Codex) | Medium | Medium | Medium |
| Naming (Opus in rounds 1 and 3, Codex in rounds 1 and 2) | Medium (Opus), Low (Codex) | Low | Medium |

The loop stopped because three rounds ran, not because every lens rated Low. The owner fixed every finding of round 3 in the spec, but no reviewer has checked those fixes yet. Each later round found a new, smaller problem that the earlier fix exposed, and none of them questioned the scope of the change.

## The six parts the owner asked about

1. The new `data.event` field on each subscription delivery is kept. The preview must follow edits to the instruction and must show fields when the option is off, and the stored `data.inputs` cannot do either.
2. Run now filling pills from the newest delivery is kept. Today Run now sends the joined text, which would hold raw selectors such as `$.event.attributes.title` once pills exist. Run now now sends the same text as the preview, built by one function.
3. The text coercion of pill values that are not strings is kept, for subscriptions only. A number field, such as a pull request number, fails the run today. Schedules keep today's inputs, because their messages are static text.
4. The 20,000 character cap is cut. It added a rule, a note line and tests on both the Python and TypeScript sides. The `"$"` mapping already sends the full payload with no cap today, and no recorded payload shows a size problem. QA records the size of one real payload (task 12.1), and a cap comes in a later change if a payload is too large.
5. The restored `PillEditor.tsx` and the two new components are kept. `MessageComposer` is a plain text area and cannot hold a pill as one unit, so an event mode inside it would change the schedule editor. Restoring the old editor is less new code than writing one.
6. The fix to the builder agent reference text in `agenta_builtins.py` is kept in this change. It is a text edit, and the current text tells builder agents to add an `event` key that the agent never reads.

## Fixed

- The frontend and the dispatcher use one text rule for pill values. A string stays as it is, an absent or null value becomes empty text, and any other value becomes compact JSON. Both test suites use the same fixtures.
- The frontend lookup keeps a quoted key such as `["a.b"]` whole. Today it splits the key at the dot.
- The backend function takes the event context (`compose_event_inputs(inputs, *, context, include_event)`), so a caller cannot pass the raw provider body by mistake.
- The preview function is named `renderMessagePreview`, so its name differs clearly from `formatEventText`.
- The specs and tasks say "include", the word of the code field, and the approved checkbox label keeps "attach".
- `AutomationInstructionField` takes the automation and reads its runs, and it has no second `deliveries` prop.
- For a mapping the composer cannot show, the preview shows only today's warning line and Run now sends today's text. `parseMessageTemplate` returns `null` for that case.
- Run now reads the newest event when the user presses it. Labels in square brackets appear only when the call succeeds and finds no event. When the call fails, Run now starts no run, logs the error and stays enabled, so it adds no new UI text.
- A pure `latestDeliveryEvent(deliveries)` picks the newest event for both the preview and Run now.
- `compileMessageTemplate`, which has no caller today, now keeps other keys of the mapping. The design adds no second writer.
- A new `remapMessageTemplate` moves text with pills to the right key when the agent's input shape resolves late.
- The design text says where `MessageComposer` lives and that it serves every automation kind today.

## Left on purpose

- The name `renderMessagePreview` stays, although Run now also sends its text. A reviewer asked about it as a question only. The preview and Run now send the same text by design, so one name fits both callers.
- The round 3 fixes have had no review. The next review loop, on the implementation PR, covers them.

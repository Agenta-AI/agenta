# QA: break-it pass

Run on 2026-10-23 against the mobile app on `localhost:3000`, in a QA conversation, with
uploaded fixtures: `budget.xlsx` (data from B3), `tricky.xlsx`, `memo.docx`, `deck.pptx`,
`report.html`, `page2.html`, `dynamic.html` (live counter, remove and insert buttons,
duplicate list items) and `hostile.html` (scripted clicks every 700 ms, capture listeners, a
forged `postMessage`, markdown injection text, a 10,000-character element).

## Results

| Level | Scenario | Result |
|---|---|---|
| Easy | Toggle shows for XLSX, DOCX, PPTX, HTML; hidden for Markdown | Pass |
| Easy | Escape on the page turns comment mode off; switching files turns it off | Pass |
| Easy | Escape in the note box discards the draft and keeps comment mode on | Pass |
| Medium | Three comments number 1 to 3; a page-2 paragraph reads `p. 2` | Pass |
| Medium | Deleting the middle chip removes its pin and renumbers | Pass |
| Medium | Chip click opens the editor with the note, cursor at the end | Pass after fix |
| Medium | Sheet name `Q3 "final" (v2)` + backtick, cells with `\|`, a line break, a fake quote head | Pass: escaped and flattened |
| Medium | A pin on one sheet hides on another sheet and returns | Pass |
| Hard | Overwrite `budget.xlsx` with different values under a comment | Pass: chip shows "changed" |
| Hard | Overwrite `report.html` without the commented heading, reopen | Pass: chip shows "changed" |
| Hard | Live counter (`#c`) commented | Pass after fix (was "changed" within 1 s) |
| Hard | Element inserted above commented items | Pass: pins move with them |
| Hard | Third of three identical list items | Pass: pin stays on the third |
| Hard | Commented heading removed by the app | Pass: "changed" |
| Hard | App calls `el.click()` every 700 ms while in comment mode | Pass after fix (was opening and resetting the note box) |
| Hard | Pane resized while the note box is open | Pass after fix (box overflowed the pane) |
| Hard | Sending markdown-injection text and a 10,000-character element | Pass: no forged quote card, excerpt capped at 2,000 characters, agent treated the text as data |
| Hard | First click into the frame picks nothing | Not a product bug: the browser pane spends that click on focus; a probe page received no events even with comment mode off |

## Fixed in this pass (commit `pro`)

1. A pick needs a press on the same element before the click, so scripted clicks cannot open
   the note box.
2. A unique-id selector keeps its pin while the element's text changes.
3. The comment layer re-renders when its root resizes, so the note box stays in the pane.
4. The chip editor puts the cursor after the existing note.

## Open findings, not fixed

1. A second pick while a draft is open replaces the draft and loses its typed text.
2. Pin numbers do not appear on the composer chips, so a pin and its chip are hard to match
   when several comments exist.
3. An open draft note stays where it opened when the preview scrolls or resizes.
4. Staged comments live in memory and are lost on a page reload, the same as text quotes.
5. The chip shows `Q3 "final" (v2)!A2:B5` without the quotes Excel puts around such sheet
   names.
6. A comment marked "changed" still sends with its old excerpt; the chip warns, the send does
   not.

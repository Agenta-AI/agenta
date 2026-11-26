# Spec Delta

## Purpose

Lets people point at a part of a rendered HTML app, Word document, slide deck or spreadsheet
preview, attach a comment to that location, and send it to the agent with a precise location.

## ADDED Requirements

### Requirement: Comment mode is available on supported previews in a conversation
The Files pane SHALL show a Comment toggle when the selected file is a running HTML app, a
DOCX document, a PPTX presentation or a spreadsheet (XLSX, XLSM, XLS, ODS) and the drive is
shown inside a conversation. The toggle SHALL NOT show outside a conversation or for other
file types. A preview that failed to render SHALL ignore comment mode. Comment mode SHALL turn off when the user presses
Escape, toggles it off, or selects another file.

#### Scenario: Toggle shown for a deck in a conversation
- **WHEN** a user opens `deck.pptx` in the Files pane of a conversation
- **THEN** the toolbar shows a Comment toggle

#### Scenario: No toggle outside a conversation
- **WHEN** a user opens `deck.pptx` from a drive that is not part of a conversation
- **THEN** the toolbar shows no Comment toggle

#### Scenario: No toggle for a PDF
- **WHEN** a user opens `report.pdf` in a conversation
- **THEN** the toolbar shows no Comment toggle

### Requirement: Users pick an element in HTML, DOCX and PPTX previews
In comment mode, the HTML, DOCX and PPTX previews SHALL highlight the pickable element under
the pointer and SHALL pick it on click or tap. A click in comment mode SHALL NOT trigger the
previewed content's own behavior, such as a button handler or a link. The pickable element
SHALL be:
- HTML: the element under the pointer, or its nearest ancestor that is not an inline text
  formatting element.
- DOCX: the nearest paragraph, table or image, together with its page number.
- PPTX: the top-level shape on the current slide that contains the pointer, or the whole
  slide when the pointer is on the slide background, together with the slide number.
For an HTML app that has loaded another page of its folder through a link, the comment
SHALL refer to the page on screen, not the file first opened.

#### Scenario: Pick a heading in an HTML app
- **WHEN** a user in comment mode clicks a `<strong>` word inside an `<h2>` in a running HTML app
- **THEN** the `<h2>` is picked and the note box opens next to it

#### Scenario: Button handler does not run
- **WHEN** a user in comment mode clicks a button whose handler deletes a row
- **THEN** the button is picked and the row is not deleted

#### Scenario: Comment on a linked page of an HTML app
- **WHEN** a user follows a link from `app/index.html` to `app/pricing.html` inside the app and comments on a heading
- **THEN** the comment refers to `app/pricing.html`

#### Scenario: Pick a shape on a slide
- **WHEN** a user in comment mode clicks text inside a text box on slide 3
- **THEN** the text box is picked with slide number 3

### Requirement: Users select cells in spreadsheet previews
In comment mode, the spreadsheet preview SHALL select a single cell on click and a
rectangular range on drag or Shift+click, and SHALL open the note box for the selection. Cell
addresses SHALL use the sheet's own A1 coordinates, including when the sheet's used range
does not start at A1.

#### Scenario: Range in a sheet whose data starts at B3
- **WHEN** a sheet's used range starts at `B3` and the user selects the second to fourth data cells of its first column
- **THEN** the comment's range is `B4:B6`

### Requirement: A comment uses the quote note box and the quote store
After a pick, the system SHALL open the same note box used for text quotes. Enter SHALL stage
the comment, Command or Control plus Enter SHALL stage it and send the message, and Escape or
a press outside SHALL discard the draft. A staged comment SHALL appear as a composer chip
together with any staged text quotes and SHALL be sent with the next message.

#### Scenario: Stage two comments and send once
- **WHEN** a user stages a comment on a slide shape, stages a comment on a spreadsheet range, and sends a message
- **THEN** the message carries both comments and the composer shows no chips afterwards

#### Scenario: Failed send keeps the comments
- **WHEN** the send fails before the message goes out
- **THEN** both comments are staged again

### Requirement: Staged comments show as pins on the preview
The preview SHALL show a numbered pin for each staged comment on the file on screen, placed at
the point the user picked. Pins SHALL follow their element while the preview scrolls, resizes
or re-renders. A PPTX pin SHALL show only while its slide is on screen. Hover on a pointer
device, or tap on a touch device, SHALL show the comment text, the quoted content, an Edit
action and a Delete action. Comments that have been sent SHALL NOT show pins.

#### Scenario: Pin follows scroll
- **WHEN** a user stages a comment on page 3 of a DOCX and scrolls the document
- **THEN** the pin stays on the commented paragraph

#### Scenario: Pins clear on send
- **WHEN** the message carrying a comment is sent
- **THEN** the comment's pin disappears from the preview

### Requirement: Users edit and delete comments before send
Before the message is sent, the user SHALL be able to edit a comment's text and delete a
comment from its pin card. A click on a preview comment's composer chip SHALL open the note
editor with the current text, and Enter SHALL save it. Chips of text quotes SHALL keep their
current behavior. Deleting a comment SHALL remove its pin and its
chip together. Editing SHALL NOT change the comment's location.

#### Scenario: Edit from the pin
- **WHEN** a user opens a pin card, chooses Edit, changes the text and presses Enter
- **THEN** the pin card and the chip show the new text and the sent message carries it

#### Scenario: Delete from the pin
- **WHEN** a user chooses Delete on a pin card
- **THEN** the pin and the matching composer chip disappear

### Requirement: The agent receives a precise location for each comment
Each sent comment SHALL reach the agent as a quote block whose first line names the file's
drive path and the location, followed by the quoted content and then the user's comment:
- HTML: the element's CSS selector, plus the element's opening tag with its attributes.
- DOCX: the page number.
- PPTX: the slide number.
- Spreadsheet: the sheet name and the A1 range; the quoted content is the selected cells as a
  table, with the sheet's first row added on top as the header when the selection does not
  include it.
The element's visible text SHALL be the quoted content for HTML, DOCX and PPTX, capped at the
existing quote excerpt limit. The sent message SHALL show each comment as a quote card that
names the file and the location.

#### Scenario: Spreadsheet comment content
- **WHEN** a user sends a comment on range `B4:C5` of sheet `Q3`
- **THEN** the agent receives a block headed by the file path and `sheet Q3, B4:C5`, containing a table with the header row and the two selected rows

#### Scenario: Slide comment content
- **WHEN** a user sends a comment on a text box reading "Q3 revenue grew 40%" on slide 3
- **THEN** the agent receives a block headed by the file path and `slide 3`, quoting "Q3 revenue grew 40%"

### Requirement: Comments become stale when their element is gone
When the preview renders a new version of the file, the system SHALL locate each staged
comment again. A comment whose element can no longer be found, or whose spreadsheet range now
holds different values, SHALL be marked "changed" on its chip and SHALL show no pin. A comment found again SHALL clear the mark.

#### Scenario: Agent changes the commented cells
- **WHEN** a user staged a comment on `B4:D4` and the agent re-sorts the sheet so `B4:D4` holds other values
- **THEN** the comment's chip shows "changed"

#### Scenario: Agent removes the commented heading
- **WHEN** the agent rewrites `report.html` without the commented heading and the user reloads the app
- **THEN** the comment's chip shows "changed" and its pin is hidden

### Requirement: Preview content cannot act as the user through comments
The host SHALL accept a pick from a preview only while comment mode is on, and SHALL reject
pick or position messages with oversized text, non-finite numbers or rectangles outside the
preview. A pick SHALL only fill the note box; nothing SHALL be sent to the agent until the
user stages or sends it.

#### Scenario: Unprompted pick message
- **WHEN** an HTML app posts a pick message while comment mode is off
- **THEN** the host ignores it and no note box opens

# Spec Delta

## Purpose

Lets people look at spreadsheets, Word documents and slide decks stored in agent and session
drives without downloading them.

## ADDED Requirements

### Requirement: Office files resolve to a previewable kind
The system SHALL treat files ending in `.xlsx`, `.xlsm`, `.xls` or `.ods` as spreadsheets,
files ending in `.docx` as documents, and files ending in `.pptx` as presentations, matching
the extension case-insensitively. Files ending in `.doc` or `.ppt` SHALL keep the existing
download-only fallback.

#### Scenario: Spreadsheet extension
- **WHEN** a drive lists `reports/Q3.XLSX`
- **THEN** the file shows a spreadsheet icon and opens in the spreadsheet preview

#### Scenario: Legacy Word file
- **WHEN** a user opens `notes.doc`
- **THEN** the pane shows "No preview for this type" with a download action

### Requirement: Spreadsheet preview shows every sheet
The spreadsheet preview SHALL show one tab per sheet, in workbook order, with the first sheet
selected. Each sheet SHALL render as a table with its first row as the header. A sheet with more
rows than the preview row limit SHALL show the first rows up to that limit and a note that names
how many rows are shown.

#### Scenario: Workbook with two sheets
- **WHEN** a user opens a workbook with sheets `Sales` and `Notes`
- **THEN** the preview shows tabs `Sales` and `Notes`, and the `Sales` table is visible

#### Scenario: Long sheet
- **WHEN** a sheet has more rows than the preview row limit
- **THEN** the table shows rows up to the limit and a note "Showing the first N rows"

### Requirement: Formula cells show values, or the formula when no value is stored
A formula cell with a stored computed value SHALL show that value. A formula cell without a
stored value SHALL show its formula text, visually marked as a formula.

#### Scenario: Workbook saved by a spreadsheet application
- **WHEN** cell D2 holds `=B2+C2` with stored value `260`
- **THEN** the preview shows `260` in D2

#### Scenario: Workbook written by an agent script
- **WHEN** cell D4 holds `=B4+C4` with no stored value
- **THEN** the preview shows `=B4+C4` in D4, styled as a formula

#### Scenario: Formatted empty cells
- **WHEN** a sheet has data in A1:B2 and a bold but empty cell at Z2000
- **THEN** the table shows two rows and two columns, and no cell shows placeholder text

### Requirement: An open preview follows changes to the file
When a previewed office file changes in the drive, the open preview SHALL show the new content
after the drive listing refreshes, without the user closing and reopening it. An unchanged file
SHALL NOT be downloaded again.

#### Scenario: Agent edits an open workbook
- **WHEN** a user has `report.xlsx` open and the agent adds a row to it during a turn
- **THEN** the preview shows the new row once the turn ends

### Requirement: Document preview renders as pages
The document preview SHALL render a `.docx` file's headings, paragraphs, tables and images in
page form. Document content SHALL NOT change the styles of the surrounding application. Only
`http:`, `https:` and `mailto:` links SHALL stay clickable; any other link SHALL render as plain
text.

#### Scenario: Simple report
- **WHEN** a user opens a document with a heading and three paragraphs
- **THEN** the preview shows the heading and the three paragraphs in order

#### Scenario: Script link
- **WHEN** a document holds a hyperlink whose target is a `javascript:` URL
- **THEN** the link text renders as plain text with no link target

### Requirement: Document content cannot act as the user
Content inside a previewed document or presentation SHALL NOT run script with the user's
session, read the user's credentials or storage, call the Agenta API, navigate the app, or load
resources from the network. This SHALL hold for any content the file carries, including
embedded HTML parts, hyperlinks, and external image or media references.

#### Scenario: Document with embedded HTML
- **WHEN** a user opens a `.docx` whose altChunk part holds `<script>` and `<img onerror>` HTML
- **THEN** no script runs with the user's session and the user's access token is not readable
  by the document

#### Scenario: Presentation with an external image
- **WHEN** a user opens a `.pptx` whose picture links to `https://example.com/pixel.png`
- **THEN** the preview makes no request to `example.com`

### Requirement: Presentation preview shows slides one at a time
The presentation preview SHALL show one slide at a time with controls to go to the next and
previous slide and an indicator of the current slide number and total.

#### Scenario: Five-slide deck
- **WHEN** a user opens a deck with five slides and selects next twice
- **THEN** the preview shows slide 3 and the indicator reads "3 / 5"

### Requirement: Oversized or unreadable office files fall back to download
An office file above its preview size limit SHALL show "Too large to preview" with a download
action. A file that cannot be parsed SHALL show the download fallback instead of an error
screen. Spreadsheet and document files SHALL use a 10 MB limit; presentations SHALL use a
25 MB limit.

#### Scenario: Large workbook
- **WHEN** a user opens a 40 MB `.xlsx`
- **THEN** the pane shows "Too large to preview" and a download action

#### Scenario: Corrupt file
- **WHEN** a user opens a `.docx` whose bytes are plain text
- **THEN** the pane shows the download fallback

### Requirement: Previews work in every drive surface
The same previews SHALL appear in the Files pane, in Quick Look, and when a user opens a chat
attachment of one of these types. An attachment without a file extension SHALL resolve its kind
from its media type.

#### Scenario: Attached workbook
- **WHEN** a user attaches `budget.xlsx` in chat and opens the attachment
- **THEN** the attachment viewer shows the spreadsheet preview

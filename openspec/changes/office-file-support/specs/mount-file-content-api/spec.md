# Spec Delta

## Purpose

Defines how the mount file routes return binary content, so clients either get exact bytes
with the right media type or a clear error, and never silently corrupted text.

## ADDED Requirements

### Requirement: Text read refuses binary content
`GET /mounts/{mount_id}/files?read=<path>` SHALL respond with HTTP 415 when the file's content
is binary. The error message SHALL name the download route. A text file SHALL read as before,
including a text file with a few invalid UTF-8 bytes. A file above the text-read size limit SHALL
keep responding with HTTP 413, whether or not it is binary.

#### Scenario: Read a workbook as text
- **WHEN** a client calls `?read=reports/q3.xlsx`
- **THEN** the response is 415 and the message points to `/files/download`

#### Scenario: Read a text file
- **WHEN** a client calls `?read=notes.md`
- **THEN** the response is 200 with the file's text

#### Scenario: Read a large binary file
- **WHEN** a client calls `?read=` on a 5 MiB `.xlsx`
- **THEN** the response is 413

### Requirement: Download returns office media types
`GET /mounts/{mount_id}/files/download` and its session-scoped equivalent SHALL return the
standard media type for `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.docx`, `.doc`, `.odt`, `.pptx`,
`.ppt` and `.odp` files,
regardless of the host's MIME database, and SHALL return the exact stored bytes.

#### Scenario: Download a workbook
- **WHEN** a client downloads `reports/q3.xlsx`
- **THEN** the `Content-Type` is
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and the body equals the
  uploaded bytes

# Spec Delta

## Purpose

Keeps binary file content out of a Pi agent's context and stops a Pi agent from destroying
office files with its text tools, while telling it how to work with those files instead.

## ADDED Requirements

### Requirement: Reading a binary file returns guidance, not undecodable text
When a Pi agent's file-read tool reads a file whose content is binary, the tool result SHALL be
an error that names the file, states that it is binary, and, for spreadsheet, document and
presentation formats, names a way to read it with the tools in the sandbox. A file that the tool
already returns as an image SHALL be unaffected. A text file SHALL read as before.

#### Scenario: Agent reads a workbook
- **WHEN** a Pi agent calls its read tool on `agent-files/report.xlsx`
- **THEN** the result is an error that says the file is a binary Excel workbook and suggests
  `python3` with `openpyxl` through the shell tool

#### Scenario: Agent reads a text file
- **WHEN** a Pi agent calls its read tool on `notes.md`
- **THEN** the result is the file's text, unchanged

#### Scenario: Agent reads an image
- **WHEN** a Pi agent calls its read tool on `chart.png`
- **THEN** the result is the image, unchanged

### Requirement: Writing text to an office-format path is refused
A Pi agent's file-write tool SHALL refuse a write whose target path ends in `.xlsx`, `.xlsm`,
`.xls`, `.ods`, `.docx`, `.doc`, `.odt`, `.pptx`, `.ppt` or `.odp`, and SHALL return guidance to create
or change such files with a script instead. The target file SHALL be left unchanged.

#### Scenario: Agent overwrites a workbook
- **WHEN** a Pi agent calls its write tool on `agent-files/report.xlsx` with CSV text
- **THEN** the call is refused with guidance, and `report.xlsx` keeps its previous bytes

#### Scenario: Agent writes a CSV
- **WHEN** a Pi agent calls its write tool on `agent-files/report.csv`
- **THEN** the write succeeds

### Requirement: The guard applies on every Pi path
The read and write rules SHALL apply whether the Pi harness runs in-process, in the sandbox on a
local sandbox, or in the sandbox on Daytona. A refused write SHALL NOT first ask the user to
approve it.

#### Scenario: Three Pi paths
- **WHEN** the same Pi agent reads `report.xlsx` in an in-process session, on a local sandbox,
  and in a sessionless run on Daytona
- **THEN** all three reads return the same guidance error

#### Scenario: Write under approval gating
- **WHEN** built-in tool approval is on and a Pi agent writes text to `report.docx`
- **THEN** the write is refused without an approval prompt

### Requirement: A binary slice is still caught
The read rule SHALL apply when the agent reads a binary file from an offset or with a line
limit.

#### Scenario: Offset read of a workbook
- **WHEN** a Pi agent reads `report.xlsx` with an offset of 20 lines
- **THEN** the result is the guidance error

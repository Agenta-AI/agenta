# Workspace files

## Purpose

The agent sees and edits the same files it sees today: its durable agent folder and the session folder (the drive).

## ADDED Requirements

### Requirement: Same folders, same paths

The agent SHALL see the session folder as its working directory and the agent folder as `agent-files/` inside it, with the same content the web drive shows.

#### Scenario: File from the drive

- **WHEN** a user uploads `notes.md` to the session drive
- **THEN** the agent can read `notes.md` from its working directory.

#### Scenario: File from an earlier session

- **WHEN** an earlier session saved `agent-files/report.md`
- **THEN** the agent in a new session can read it at the same path.

### Requirement: Read and edit files

The agent SHALL be able to list, search, read, create, edit and delete files in both folders. Every file tool SHALL run in the command sandbox, on its mount of the drive (round 7, design 2c); the runner SHALL NOT open a path the model chose, and SHALL NOT mount the drive. A session that only chats SHALL NOT start a sandbox.

#### Scenario: Edit without shell

- **WHEN** the agent edits a file and runs no command
- **THEN** the edit runs in the command sandbox (started for it if none runs), and it is in the store when the tool reports.

#### Scenario: Path escape

- **WHEN** the agent asks to read `../../etc/passwd` or follows a symlink out of its folders
- **THEN** the request runs in the command sandbox, never on the runner host, and sees only the sandbox's own files.

### Requirement: Files and commands agree

A file the agent writes with a file tool SHALL be visible to the next shell command, and a file a command writes SHALL be visible to the next file tool call. Both use the same mount, and each change is flushed to the store before it reports.

#### Scenario: Write then run

- **WHEN** the agent writes `script.py` and then runs `python script.py`
- **THEN** the command runs the version just written.

### Requirement: Outside changes are seen at the next turn

A file changed in the store by someone else (the files pane, an upload, another conversation of the agent) SHALL be visible to the agent from the start of its next turn, for every provider.

#### Scenario: Files-pane edit

- **WHEN** the user edits `notes.md` in the files pane between two turns
- **THEN** the agent's first read of `notes.md` in the next turn shows the edit.

### Requirement: Keep today's folder features

The agent folder README, the `.tools/` restore (`bin/` and `setup.sh`), the durable-link repair, and "last writer wins" for shared files SHALL behave as on `daytona` today. The command sandbox holds no copy of its own, so when a files-pane edit and a command write the same file, the later write wins.

#### Scenario: Tools restore

- **WHEN** a session's sandbox starts and `agent-files/.tools/setup.sh` exists and the run posture is `allow`
- **THEN** the script runs once before the first command.

### Requirement: Temporary files stay on fast disk

Scratch work, builds and downloads SHALL use the sandbox's local disk, not the mounted drive.

#### Scenario: Large build

- **WHEN** the agent clones a repository to `/tmp`
- **THEN** the files stay on sandbox local disk and never reach the drive.

# Skills and attachments

## Purpose

Skills, user images and files the agent shares keep working.

## ADDED Requirements

### Requirement: Skills load and read

Pi SHALL list the configured skills in its prompt, built by the runner without a sandbox. When the model reads a skill file, the read SHALL run in the command sandbox (round 7, design 2c), at the path the prompt lists; the runner puts the skill snapshot on the drive for it.

#### Scenario: Read a skill

- **WHEN** the model reads `SKILL.md` of a configured skill
- **THEN** it gets the content through the sandbox's `read`, starting the sandbox if none runs.

### Requirement: Skill scripts run in the sandbox

Bundled skill files marked executable SHALL be present in the sandbox and runnable there, under today's executable-file policy.

#### Scenario: Run a skill script

- **WHEN** the model runs a skill's `scripts/check.sh`
- **THEN** the script runs in the sandbox.

### Requirement: User images reach the model

Images the user attaches SHALL reach the model natively, as they do today for Pi.

#### Scenario: Screenshot

- **WHEN** the user attaches a screenshot and asks about it
- **THEN** the model receives the image.

### Requirement: Shared files are visible

Files the agent writes to the drive SHALL be visible to the user in the drive, and links to them SHALL open, as today.

#### Scenario: Report link

- **WHEN** the agent writes `report.md` and links it in its reply
- **THEN** the user opens the link and sees the file.

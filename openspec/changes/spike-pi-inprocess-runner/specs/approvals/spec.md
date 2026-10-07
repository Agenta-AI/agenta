# Approvals

## Purpose

Human-in-the-loop behavior is identical to today.

## ADDED Requirements

### Requirement: Same approval cards

Every tool that asks for approval today SHALL ask on `inprocess`, with the same card content, and SHALL run only after approval.

#### Scenario: Ask posture

- **WHEN** the run posture is `ask` and the agent calls `bash`
- **THEN** an approval card appears before the command runs in the sandbox.

### Requirement: Pause and resume

An unanswered approval SHALL end the turn as it does today. Answering it SHALL resume the session with the decision applied.

#### Scenario: Approve later

- **WHEN** the user approves a pending tool call ten minutes later
- **THEN** the session resumes, the tool runs once, and the result reaches the model.

### Requirement: Concurrent approvals

Several pending approvals in one turn SHALL behave as they do today.

#### Scenario: Two cards

- **WHEN** the model asks for two approval-gated tools in one step
- **THEN** both cards appear, and each decision applies only to its own call.

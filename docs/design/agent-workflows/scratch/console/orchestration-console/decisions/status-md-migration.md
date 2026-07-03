---
id: status-md-migration
title: Retire scratch/STATUS.md, or generate it as a fallback during rollout?
status: locked
task: skill-edits
pr: ''
recommendation: Generate it (option 2) for one project as a shadow, then retire (option
  1) once you trust the UI.
answer: let's retrire it
answered_by: user
raised: '2026-07-01T11:24:35Z'
updated: '2026-07-01T12:34:33Z'
---



# Retire scratch/STATUS.md, or generate it as a fallback during rollout?

## Context

STATUS.md today is the plain-language status you skim; the console's project.md + feed now serve the same purpose. Keeping both during migration means two sources of truth, but retiring STATUS.md means status is only readable when the web app is up (mitigated by 'console status' printing the same thing to the terminal).

## Options

- (1) Retire STATUS.md now; the console is the status.
- (2) Have the CLI also write a rendered STATUS.md as a fallback flat file, retire later. (my rec)

## Recommendation

Generate it (option 2) for one project as a shadow, then retire (option 1) once you trust the UI.

## Your decision

**Locked:** let's retrire it

Per your call, retiring STATUS.md (no fallback). Updated skill-integration.md + both orchestration skills + orchestration-console SKILL.md to say: when a project is tracked in the console, stop writing STATUS.md; read status from the dashboard or 'console status'.

_2026-07-01T12:34:33Z_

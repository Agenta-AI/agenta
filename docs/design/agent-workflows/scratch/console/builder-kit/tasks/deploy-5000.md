---
id: deploy-5000
title: 'Make the #5000 CLAUDE.md fix live in the local dev stack'
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-03T13:48:42Z'
updated: '2026-07-03T13:49:15Z'
---



# Make the #5000 CLAUDE.md fix live in the local dev stack

## Context

Restart/rebuild whatever runs the runner code (agenta-claude-sub-sidecar compiles on startup; compose runner may bake the image). Verify CLAUDE.md logic is live in the container.

## Messages

**Agent** · Jul 3, 13:48

task created.

**Agent** · Jul 3, 13:49

Fix live: agenta-claude-sub-sidecar + compose runner restarted (both bind-mount source), SDK half hot-reloads. Gap: agenta-oss-team shared stack runs a baked image without the fix (separate checkout at /home/team/agenta, left untouched).

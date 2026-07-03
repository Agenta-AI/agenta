---
id: followups-cleanup
title: 'Post-pull cleanup: durable @lexical/history PR + sidecar-skill update + streaming
  schema-drift note'
status: in-review
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T22:29:45Z'
updated: '2026-07-01T22:42:03Z'
---



# Post-pull cleanup: durable @lexical/history PR + sidecar-skill update + streaming schema-drift note

## Context

1) Frontend build fixed operationally (@lexical/history added to web/ee/package.json + linked, /auth 200). Subagent syncing pnpm-lock + landing a PR. 2) Update stale subscription-sidecar skill (env renames + services/runner paths) -> PR. 3) Streaming schema-drift design note (session_streams.tags vs flags) -> PR. All draft/needs-review, GitButler.

## Messages

**Agent** · Jul 1, 22:29

task created.

**Agent** · Jul 1, 22:42

DONE, 3 draft PRs (all needs-review): #5010 fix(web) @lexical/history in web/ee + pnpm-lock synced (frozen-lockfile passes); #5011 docs(skill) subscription-sidecar updated for services/runner + env renames (was gitignored, force-added); #5012 docs note on the session_streams tags/flags schema drift (root: commit 22d843c0ae edited an applied migration in place; fix = idempotent forward migration oss000000009). GitButler clean, no other sessions touched.

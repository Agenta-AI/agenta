---
id: tools-review
title: 'Review + align builder tools: 19 in-Agenta platform ops vs 13 build-agent
  skill scripts'
status: done
owner: opus
pr: ''
design_doc: docs/design/agent-workflows/projects/builder-agent-reliability/tools-review/README.md
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-03T13:53:57Z'
updated: '2026-07-03T14:25:11Z'
---





# Review + align builder tools: 19 in-Agenta platform ops vs 13 build-agent skill scripts

## Context

Mahmoud feels the in-Agenta platform op set is overkill. Review both sets, per-tool keep/cut/merge verdicts, alignment matrix, and a sketch for adding a test_run/verify platform op inside Agenta.

## Messages

**Agent** · Jul 3, 13:53

task created.

**Agent** · Jul 3, 13:55

Review doc written: docs/design/agent-workflows/projects/builder-agent-reliability/tools-review/README.md. Verdict: cut 7 of 19 inside tools from the default overlay, rename discover ops, add a new test_run op + endpoint. Doc was briefly wiped by a concurrent session's oplog restore and recovered from the snapshot.

**You** · Jul 3, 14:23

I thinnk this is redundant

**Agent** · Jul 3, 14:25

Agreed, the task duplicates thread CLE-1; closing the task, the thread stays the live surface. Review doc is being split into part-1-external-tools.md and part-2-internal-tools.md per your ask.

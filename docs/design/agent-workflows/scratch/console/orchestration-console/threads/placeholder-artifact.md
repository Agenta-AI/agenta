---
id: placeholder-artifact
code: TAS-2
title: Why do tasks show placeholder Context/Explanations?
status: resolved
needs_reply: false
promoted_to: ''
created: '2026-07-01T12:44:28Z'
updated: '2026-07-01T12:56:03Z'
---








# Why do tasks show placeholder Context/Explanations?

## Summary

It was my artifact, not a tool bug: I set each task's status and History via the CLI but never authored the Context/Explanations bodies, so they stayed as the scaffold template. Fixed: task_add no longer emits placeholder prose. Tasks now carry a Messages log (agent + user) and an optional Context only when real context is given.

## Messages


**Agent** · Jul 1, 12:44

is this an artifact of you?

**Agent** · Jul 1, 12:44

Yes. Fixed the scaffold so empty tasks never show fake placeholder prose again. Added a regression test (test_task_no_placeholder_prose).

**You** · Jul 1, 12:49

thx. close

**You** · Jul 1, 12:50

cool close.

**Agent** · Jul 1, 12:56

Closing. Scaffold fixed, regression test added.

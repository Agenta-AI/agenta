---
id: skill-schema
title: Find the real skill schema (folders/files), not just name/description/body
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T13:55:34Z'
updated: '2026-07-01T13:58:32Z'
---




# Find the real skill schema (folders/files), not just name/description/body

## Context

Kit claims a skill is {name,description,body}. skill-template catalog type also showed a second required set [path,content] — likely a files array. Find the full inline-skill schema incl folders/extra files, from the SDK SkillTemplate + agent-template schema. Report the correct shape to put in BUILD-AGENT.md.

## Messages


**Agent** · Jul 1, 13:55

task created.

**Agent** · Jul 1, 13:58

Found full 6-field schema (models.py:77 + SkillFile models.py:49). Correcting kit + verified-facts.

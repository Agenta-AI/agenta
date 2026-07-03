---
id: skill-files-test
title: Live-test the corrected skill schema (files/folders)
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T14:48:40Z'
updated: '2026-07-01T14:53:15Z'
---



# Live-test the corrected skill schema (files/folders)

## Context

Create an agent whose skill bundles a folder/file via files[], invoke it, and confirm the file is materialized next to SKILL.md and usable. Confirm the kit's corrected 6-field schema holds in practice.

## Messages

**Agent** · Jul 1, 14:48

task created.

**Agent** · Jul 1, 14:53

PASS, single-shot. Bundled references/secret.md (subfolder) -> agent returned APRICOT-7731 (string only in the file), check-tools shows Skill->Read->PASS. Corrected 6-field schema works end to end. result.md in experiments/10-skill-files/.

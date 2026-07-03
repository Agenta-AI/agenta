---
id: skills-repo
title: Create agenta-skills repo + build-agent skill
status: in-review
owner: sonnet
pr: https://github.com/Agenta-AI/agenta-skills/pull/1
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T16:59:51Z'
updated: '2026-07-01T17:50:27Z'
---




# Create agenta-skills repo + build-agent skill

## Context

Per user PR #5001 comments: create /home/mahmoud/code/agenta-skills (sibling repo), top-level skills/ with build-agent (naming: build-agent, not build-agenta-agent). Progressive disclosure (SKILL.md index + references/). Give Agenta context but use-skill-first. Research skill best practices. Port kit + scripts. marketplace.json + npx skills. Private repo first (flag public needed). Draft PR into the new repo.

## Messages

**Agent** · Jul 1, 16:59

task created.

**Agent** · Jul 1, 17:06

Built: Agenta-AI/agenta-skills (PRIVATE — needs public for point-at-repo install; left private, your call). skills/build-agent/ = SKILL.md index (169 lines) + 13 scripts (12 ported + check-prereqs.sh) + references/ (4 files, progressive disclosure). marketplace.json (name agenta) + README both-channel install + MIT + .gitignore. Naming build-agent. Best practices from Anthropic Agent Skills guidance. Draft PR #1. Ported env-creds + product-API + prereq-check; smoke-tested bash -n.

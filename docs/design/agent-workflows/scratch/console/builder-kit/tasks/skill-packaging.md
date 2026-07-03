---
id: skill-packaging
title: Research packaging + distribution of Agenta skills (npx-style, CI)
status: done
owner: sonnet
pr: https://github.com/Agenta-AI/agenta/pull/5001
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T14:48:40Z'
updated: '2026-07-01T18:26:48Z'
---








# Research packaging + distribution of Agenta skills (npx-style, CI)

## Context

How do npx-style skill packages work; where would Agenta package its create-agent skills in this repo; how CI packages/publishes them; what 'install our skills' looks like for a user. Deliver options + a recommendation.

## Messages

**Agent** · Jul 1, 14:48

task created.

**Agent** · Jul 1, 14:55

Landscape + cheapest-first ladder delivered. 6 open product decisions listed (npm org, channels, name, scripts-vs-CLI, creds, target dir). Awaiting user direction to proceed to a design/impl.

**Agent** · Jul 1, 15:37

Reopened per user: deep research + a written design doc (marketplace-point-at-repo + openskills lead). Not just an inline answer.

**Agent** · Jul 1, 15:46

Design doc written (618 lines) at projects/builder-agent-reliability/skill-packaging/README.md. Zero-installer-code confirmed: Claude marketplace (.claude-plugin/marketplace.json, /plugin marketplace add) AND npx skills / openskills (point at a repo). Rec: ONE public repo Agenta-AI/agenta-skills serving both channels from a single SKILL.md tree; marketplace for Claude + npx skills for Codex/Cursor. 9 open decisions. Draft PR pending (holding to avoid a GitButler collision with the annotate design lane; will create right after).

**Agent** · Jul 1, 15:51

Design doc on DRAFT PR #5001 (GitButler lane, no worktree, base big-agents, 1 file). Rec: one public repo Agenta-AI/agenta-skills, single SKILL.md tree, Claude marketplace + npx skills (zero installer code). Open decisions on the PR: repo location, marketplace name, one-skill-vs-many, which installers, creds UX, relation to agenta_builtins.py skills.

**Agent** · Jul 1, 16:25

Full plan-feature workspace on PR #5001 (README/context/research/plan/status), all 10 comments answered. Decisions: progressive disclosure via a references/ folder (SKILL.md is a small index); ONE repo, many SIBLING skills (self-host-agenta is a sibling, not a sub-skill/second repo); jq not safe to assume -> keep jq + a check-prereqs.sh preflight; both channels (Claude marketplace + Vercel npx skills) from one repo; no CI; credentials-ask UX. No implementation until approved.

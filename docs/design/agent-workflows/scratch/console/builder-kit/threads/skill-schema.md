---
id: skill-schema
code: SKI-1
title: Kit's skill schema looks wrong (skills can have folders/files)
status: resolved
needs_reply: false
promoted_to: ''
created: '2026-07-01T13:54:46Z'
updated: '2026-07-01T18:23:49Z'
---











# Kit's skill schema looks wrong (skills can have folders/files)

## Summary

DONE + verified live. Kit corrected to the 6-field schema, and a live test proved files[]/folders work end to end: a secret placed only in a bundled references/secret.md was read back by the agent (check-tools: Skill->Read->PASS). Nothing broke.

## Messages


**Agent** · Jul 1, 13:54

User: the skill schema in BUILD-AGENT.md (name/description/body only) seems wrong. Skills can have folders etc. Spin a subagent to find the right info.

**Agent** · Jul 1, 13:58

You were right, the kit was wrong. A skill (SkillTemplate, sdks/python/agenta/sdk/agents/skills/models.py:77) has SIX fields, not three: required name / description / body, plus optional files[] (each item {path, content, executable}), disable_model_invocation, and allow_executable_files. A folder is just /-separated segments in a file path (e.g. scripts/parse.py, references/schema.md) — there is no separate folder object; the runner materializes files[] into a directory beside SKILL.md. The [path,content] required set I saw earlier is the files[] item shape, not a second skill variant. name/description/body-only is valid but incomplete (that is how the platform builtins are built). The 500 the UC2 subagent hit was from putting slug/content at the TOP level; content belongs inside a files[] item. Skills can also be an @ag.embed reference the backend inlines. Full detail + a folder example in the findings file. Fixing BUILD-AGENT.md and verified-facts.md now.

**You** · Jul 1, 14:08

ok please update the schema in the kit to fix the issue . spin off a subagent to test these before and try them out.

**Agent** · Jul 1, 14:48

Kit schema already corrected (6 fields; files[] with {path,content,executable}; folders = /-separated path segments). Now spinning a subagent to LIVE-test it against the deployment: create a skill that bundles a folder/file, invoke the agent, and confirm the file is materialized next to SKILL.md and actually usable by the agent. Will report whether the corrected kit holds up in practice.

**Agent** · Jul 1, 14:53

Live test PASSED, single-shot. A skill bundling references/secret.md (a subfolder path) with a secret string ONLY in that file made the agent return the string (APRICOT-7731) — proof the runner materialized the file next to SKILL.md and the agent read it. check-tools confirms Skill then Read (VERDICT PASS), so it is not answering from memory. Folders-as-path-segments are real. The corrected 6-field kit schema is confirmed in practice, not just on paper. Full write-up: experiments/10-skill-files/result.md.

**You** · Jul 1, 17:00

Did you update here the build agent?

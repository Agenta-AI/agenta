---
id: skill-packaging
code: PAC-9
title: How to package + distribute Agenta skills (npx-style), where they live, CI
status: waiting
needs_reply: false
promoted_to: ''
created: '2026-07-01T14:48:39Z'
updated: '2026-07-01T18:23:49Z'
hidden: true
---















# How to package + distribute Agenta skills (npx-style), where they live, CI

## Summary

**Awaiting PR review.** agenta-skills#1 is updated with the advisor's improvements. #5001's design was reviewed and LGTM'd.

## Messages

**Agent** · Jul 1, 14:48

User: spin a subagent to explore how to create a skill package (like the npx skills people do). How does it work, where do we package it, how does CI work? This kit becomes the basis for Agenta's initial skills — packaged so users can 'install our skills and start building agents with Agenta'. They live in this repo as Agenta skills (skills to CREATE agents with Agenta, not skills to implement Agenta).

**Agent** · Jul 1, 14:55

Research done (findings/skill-packaging.md). How npx skill installers work: an npm package with a bin that npx runs without install; it bundles the skill folder(s) and copies them into the target (default ./.claude/skills, --global to ~/.claude/skills). Versioning rides npm semver. Precedents: openskills, skills-claude, Vercel add-skill. Footgun: some write .agents/skills while Claude reads .claude/skills, so skills silently do not appear — target the right dir per harness. Native zero-npm alternative: Claude Code plugins + marketplaces (a .claude-plugin/marketplace.json in a git repo, installed via /plugin marketplace add agenta-ai/agenta) — zero infra, but Claude-only. Recommended repo home: a new top-level builder-kit/ (or skills/) with src/build-agenta-agent/ as the single canonical skill (SKILL.md + the kit scripts + references), an installer/ (package.json + bin/cli.js), and an optional .claude-plugin/. Keep it OUT of .agents/skills (contributor tooling) and out of sdks/ (Python). Apply the single-source PRINCIPLE (like agenta_builtins.py -> static_catalog.py) but a separate tree — this is a different product from the platform build-kit skills. CI/publish is greenfield: the repo publishes ZERO npm packages today (all @agenta/* are private), so this would be the first npm publish and needs an @agenta npm org + NPM_TOKEN. Recommended cheapest-first ladder: (a) commit marketplace.json -> /plugin (no infra); (b) npx giget gh:agenta-ai/agenta/... off a GitHub Release (no npm org); (c) full npx @agenta/skills add build-agent once the org exists. Ship (a)+(b) now, graduate to (c).

**You** · Jul 1, 15:17

One thing I don't understand is this installer. I expected there would be a package with a marketplace where you can point to a GitHub repository, and it installs the skills. For example, with our Open Skills, can you use that?

It is surprising that you need to run `npx` and write the code for CLI.js, including where to save the skills. There is a lot of logic in installing a skill: where to save it, whether it is global, and whether you can search for whether someone has already solved it.

Please check how Sentry packages their skills, how Langfuse packages their skills, and how Langchain packages their skills. Check a few ways they package their skills and whether this Vercel thing is something you can reuse. Is there a built-in solution like Open Skills that you can simply reuse? You can point it to a repository or a folder, or reuse it when you repack the thing so you do not have to write the code yourself.

Please check that out and update the findings. 


The other thing is, let's not build a single agent-agent folder. Let's use a top-level folder called `skills` (or `agent-skills`, I don't know) and have multiple skills under it.

Right now, I think it makes sense to start with a skill for how to build an agent, and then add skills for things like how to reflect and how to run an evaluation.

The main thing is that I don't want you to reinvent the wheel when you do this. When you add `build agents`, I'm quite sure somebody did it before, and I saw something like `npx skills`.

**Agent** · Jul 1, 15:21

You are right, and your expectation is the better path. There are two distinct models, and I led with the wrong one.

- **Marketplace, point at a GitHub repo (no installer code):** this is the Claude Code plugin/marketplace model. You commit a `.claude-plugin/marketplace.json` in the Agenta repo listing the skill(s). A user runs `/plugin marketplace add agenta-ai/agenta` then `/plugin install build-agent`, and it pulls the skill straight from the repo. Zero npm, zero installer code, versioned by git. This matches exactly what you described, and it is the right first step.
- **npx installer (writing code):** this is the heavier, harness-agnostic option. You would only reach for it to also cover Codex and Cursor (which read `.agents/skills`, not `.claude/skills`), or for a branded `npx @agenta/skills` one-liner. It is not required to ship.

On "our Open Skills": `openskills` is an existing community npx installer. So even for the npx route we would REUSE it rather than write our own installer code (`npx openskills add <repo>/<skill>`), which removes the "write the code" surprise. But you do not need it at all if we go marketplace-first.

Recommendation: ship the marketplace-from-repo path first (one `marketplace.json` committed to the repo, no code), and only add an npx path later if we want Codex/Cursor coverage. If you want, I will draft the `marketplace.json` and the repo layout so the skill installs by pointing at the GitHub repo, and you review it.

**You** · Jul 1, 15:27

Man, spin off a sub-agent to research this. Don't answer me. Research this very well first. And ask it to write a document.

**Agent** · Jul 1, 15:46

Research done + a 618-line design doc written. Confirmed the zero-code path you expected: (1) Claude marketplace — commit .claude-plugin/marketplace.json to a public repo, users run /plugin marketplace add Agenta-AI/agenta-skills then /plugin install; no npm, no token, no build (Claude-only). (2) For Codex/Cursor too: npx skills (vercel-labs/skills) or openskills — both point at a repo, no installer code we write. Recommendation: ONE public repo Agenta-AI/agenta-skills serving both channels from a single SKILL.md tree (the SKILL.md folder is the portable unit; installers own the .claude vs .agents fan-out). Concrete files to commit: skills/build-agenta-agent/SKILL.md (the ported playbook), scripts/*.sh, one marketplace.json, a README. Gotchas: the name agent-skills is reserved (use agenta); three content edits when porting the lab scripts (env creds, target the product API not the lab endpoint, list bash/curl/jq prereqs). 9 open decisions are in the doc. I will put this on a draft PR for you to review and continue there.

**Agent** · Jul 1, 15:51

Design doc is now on DRAFT PR #5001 (created via a GitButler lane, not a worktree). Review and continue there. Recommendation up front: one public repo Agenta-AI/agenta-skills serving Claude (marketplace) and Codex/Cursor (npx skills) from a single SKILL.md tree, zero installer code. The PR asks you to weigh in on the open decisions (repo location, marketplace name = must be 'agenta' since 'agent-skills' is reserved, one skill vs several, which installers to endorse, credentials UX, and the relationship to the in-product agenta_builtins.py skills).

**Agent** · Jul 1, 16:25

Full design workspace is on PR #5001 (README/context/research/plan/status), and I replied to all 10 of your inline comments. Key decisions baked in: progressive disclosure via a references/ folder (SKILL.md stays a small index that says 'to annotate a trace, read references/annotate-trace.md'); ONE repo with many SIBLING skills (self-host-agenta is a sibling skill in the same repo, not a sub-skill and not a second repo; skills-within-skills is not a real feature); jq is NOT safe to assume (macOS only ships it from 15 Sequoia) so we keep jq and add a check-prereqs.sh preflight that prints the install command; both channels (Claude marketplace + Vercel npx skills) from that one repo; no CI needed; credentials handled by the skill asking the user with links and offering to write the env file. Review on the PR.

**You** · Jul 1, 16:54

Thank you. I have reviewed this. I have a couple of comments I want taken into account when doing this.
If you can spin off a subagent that:
- creates a folder in the parent folder for the repository
- creates this repository in Agenta (an empty one, or whatever makes sense)
- creates a PR into the repository
Ask it to read my comments first.

**Agent** · Jul 1, 16:59

On it. A subagent is reading your PR comments first, then creating the agenta-skills repo (sibling folder) with a top-level skills/ holding build-agent (naming: build-agent, since agenta is in the repo name), progressive disclosure via references/, Agenta context with use-skill-first, a best-practices research pass, the ported kit + scripts, marketplace.json + npx skills, and a draft PR into the new repo (private first).

**Agent** · Jul 1, 17:06

Built and ready for review. Repo Agenta-AI/agenta-skills created (PRIVATE — the point-at-repo install needs it public, so that's your call; I left it private and flagged it). skills/build-agent/: a 169-line SKILL.md index + 13 scripts (12 ported + check-prereqs.sh) + references/ (config-schema, tools-and-connections, writing-instructions, annotate-trace) for progressive disclosure. Repo-level marketplace.json (name agenta), README with both-channel install one-liners, MIT, .gitignore. Naming = build-agent. Best practices applied from Anthropic's Agent Skills authoring guidance. Draft PR: https://github.com/Agenta-AI/agenta-skills/pull/1 — review there.

**Agent** · Jul 1, 17:40

Made the repo PUBLIC (you are right, the marketplace/npx point-at-repo install needs it public). And confirming your LGTM was honored: I created the repo FIRST (Agenta-AI/agenta-skills) then the PR (agenta-skills#1), and your comments are addressed IN THE IMPLEMENTATION, not just the design: progressive disclosure (SKILL.md index + references/ folder), credentials-ask UX (skill asks the user + links + offers to write the env file), jq handled via check-prereqs.sh, both channels (marketplace + npx skills) from one repo, no CI, naming build-agent, Agenta context with use-your-content-first, and best practices from Anthropic's Agent Skills guidance. Review the built skill on agenta-skills#1.

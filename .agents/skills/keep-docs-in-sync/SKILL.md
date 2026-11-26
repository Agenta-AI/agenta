---
name: keep-docs-in-sync
description: Keep documentation in sync with a code or contract change in the SAME PR. Use whenever you change an interface, wire field, endpoint, config field, default, harness/backend value, or runtime behavior, and after any implement-feature slice that lands such a change. Triggers - "keep docs in sync", "update the docs too", "the docs drifted", "document this change", "did we update the inventory". Maps a change to every doc that describes it (design docs, the agent-workflows documentation/ pages, the interface inventory + its index, AGENTS.md, skills) and enforces one source of truth.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Skill: Keep Documentation In Sync

A contract or behavior change and the docs that describe it land in the **same PR**. The code
is the source of truth, and a doc that has drifted from the code is worse than no doc: it reads
as authoritative while it is wrong. This skill turns "also update the docs" into a concrete map
so nothing is missed.

Run this at the end of any change that moves an interface, and inside `implement-feature`
Phase 5.

When the change reshaped an interface (new or moved fields, not just a rename), run the
`design-interfaces` skill first, so the inventory records a shape already reviewed by semantic
role rather than documenting a shape that should have been fixed.

## When this applies

You changed one of these, so a doc somewhere now describes the old reality:

- a wire field, endpoint, request/response shape, event, or capability
- a harness or backend value, an enum, or a default
- a config field the playground renders, or a catalog type marker
- a runtime behavior (what is enforced, what is wired, what is a no-op)
- a file or symbol that a doc cites by path or line number

If none of these moved, you probably do not need this skill.

## The procedure

1. **Name the change in one sentence.** "Removed the legacy in-process backend and renamed
   harness `pi`->`pi_core`." That sentence is what you are hunting for in the docs.

2. **Find every doc that describes it.** Do not rely on memory. Grep the docs tree for the old
   names, the old field, the old behavior:

   ```bash
   grep -rn "<old name or field>" docs/ --include=*.md
   rg -l "<old name or field>" --glob '**/AGENTS.md' --glob '**/CLAUDE.md' .
   grep -rln "<old name or field>" .claude/skills .agents/skills
   ```

   For an agent-workflows change, the usual surface is:
   - `docs/design/agent-workflows/documentation/`: the living design docs. Check
     `ground-truth.md` (what is wired), `protocol.md` (the wire surfaces), `ports-and-adapters.md`,
     and the topic page (`tools.md`, `sessions.md`, `triggers.md`, the `adapters/*` pages).
   - `docs/design/agent-workflows/interfaces/`: the review inventory. Update the specific
     page, its `## Watch for when changing` / `## Required test updates`, the per-category
     README, AND the scan-fast index table in `interfaces/README.md` (the row and its Status
     column: stable / evolving / declared-not-wired).
   - the relevant `AGENTS.md` / `CLAUDE.md` (e.g. `services/runner/AGENTS.md` for the wire
     contract) and any skill that names the thing.
   - the project workspace under `docs/design/<project>/` (`status.md` to "landed", plus the
     plan/research if they now mislead).

3. **Update each in the same change.** Edit them in the PR that makes the code change, not in a
   follow-up. If you removed a thing, delete its page and its index row, not just its prose.

4. **One source of truth.** If two docs would state the same fact, pick the owner and have the
   other link to it. The interface inventory owns the "what crosses / what can break / what to
   check" review lens; the `documentation/` pages own the field-by-field narrative. Cross-link;
   do not re-document. Two copies drift; a pointer does not.

5. **Verify.** Re-grep for the old name to confirm zero stragglers. Check that any file or line
   citation you touched still resolves (prefer citing a symbol over a brittle line number).
   Confirm relative links in edited files resolve.

## The external-integration caveat

When a doc mentions an external dependency or integration you did NOT change (Composio, the
tool gateway, connections, MCP, Daytona, a provider), describe it only as something that
**exists**, and state explicitly that it is **unchanged** by this PR. If you did change how one
behaves, say exactly what changed and why. Never imply you touched an integration you only
read.

## Checklist before you call it done

- [ ] The change is described in one sentence and grepped for across `docs/`, `AGENTS.md`, skills.
- [ ] `documentation/` pages updated (ground-truth, protocol, ports-and-adapters, topic page).
- [ ] Interface inventory page + its category README + the `interfaces/README.md` index row and Status updated.
- [ ] Removed things have their page and index row deleted, not just edited.
- [ ] Duplication resolved by a cross-link, not a second copy.
- [ ] External integrations described as existing and unchanged unless you actually changed them.
- [ ] Old names re-grepped to zero; touched citations still resolve.
- [ ] `status.md` in the project workspace reflects what landed and what deferred.

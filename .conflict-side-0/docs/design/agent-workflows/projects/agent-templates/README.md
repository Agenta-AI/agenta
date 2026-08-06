# Agent templates: planning workspace

The six home-page template cards seed a builder agent with a one-line prompt, then leave it
to invent the whole use case on its own. It asks the wrong questions, wires the wrong tools,
and stalls. This project moves the per-use-case intelligence out of the card prompt and into
the platform build-an-agent skill as a set of reference playbooks, keeps the card prompts as
short pointers, grows the catalog to about 28 templates for three beachhead personas, and
adds a repo skill that encodes how to write the playbooks.

## Files

- [context.md](context.md): why this exists (the broken-prompt problem), goals, non-goals,
  the three personas, and how this builds on the builder-agent-reliability and
  skill-packaging prior art. Read this first.
- [research.md](research.md): the verified mechanics with current file:line anchors. Skill
  delivery and size limits, read-first mechanics, the builder-op reality check (no
  request_input defaults, test_run delta exploration, the real trigger-test button),
  frontend surfaces and their constraints, and the condensed prompting checklist. Includes a
  Constraints section of hard limits.
- [exemplar.md](exemplar.md): the changelog-writer playbook, cleaned into the canonical
  example a playbook author copies, plus the meta-principles every playbook must encode.
- [playbook-spec.md](playbook-spec.md): the canonical playbook file format. The markdown
  skeleton, the size target, the request_input reality (no default field), the rule that a
  playbook never repeats the generic loop, and the index match-table format.
- [template-inventory.md](template-inventory.md): the 28-template table (key, name, category,
  personas, integrations, trigger, card seed, confidence), the kept originals, and the
  category-set trade-off.
- [plan.md](plan.md): five work packages (playbook format skill, skill restructure, playbook
  authoring, frontend registry, verification) with scope, files touched, and acceptance
  criteria, plus sequencing and a docs-sync note.
- [open-questions.md](open-questions.md): six decisions for Mahmoud, each with context,
  options, trade-offs, and a recommendation.
- [status.md](status.md): current state and next steps. Source of truth for progress.

## Related

- Builder-agent reliability and the external CLI skill:
  [../builder-agent-reliability/](../builder-agent-reliability/). Its skill-packaging plan
  governs a sibling channel (the `.agents/skills/build-agent/` skill shipped over the Claude
  marketplace), and its authoring principles apply here verbatim.
- The platform skill this project edits: `BUILD_AN_AGENT_SKILL` in
  `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`.
- The card registry this project grows:
  `web/oss/src/components/pages/agent-home/assets/templates.ts`.

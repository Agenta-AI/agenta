# Sources and attribution

The rules in this skill are written in our own words unless a line below says otherwise.
Ideas were taken from the sources below, under their licenses.

## Agenta (ours)

- `api/AGENTS.md`, `web/AGENTS.md` and the code on `origin/main` at `a77e503782`: every row
  of `project-conventions.md`. File paths are given in that page.
- The per-layer name table, the resource template, the project convention table, the
  folder rule and the spec checklist were written for Agenta. No outside source covers them.
- `design-interfaces` skill: field roles.
  This skill links to it and does not copy it.

## Review guides supplied by the owner (free to reuse)

- `api-design-code-review` (after Jasmin Blanchette, *The Little Manual of API Design*):
  one term per concept, false consistency, caller examples first, neighboring APIs, defaults,
  surface size, edge values, signature checks, a feature without new API.
- `2026-10-29-architecture-code-review` (after John Ousterhout, *A Philosophy of Software
  Design*, 1st edition): vague and hard-to-pick names, consistency, design it twice.
- `architecture-and-code-review-2026-10-29` (after Eric Evans, *Domain-Driven Design*):
  shared language and correspondence with code, same word in two contexts, ownership.
- `enterprise-architecture-review` (after Martin Fowler, *Patterns of Enterprise
  Application Architecture*): rolling deployments and shipped changes.

## MIT

- mattpocock/skills, `domain-modeling` (`GLOSSARY-FORMAT.md`, `SKILL.md`): the glossary
  entry with an `_Avoid_` line, opinionated term choice, tight definitions, no
  implementation details, lazy creation, challenging terms against the glossary and the code.
  `codebase-design`: the vocabulary in `optional/design-vocabulary.md` (adapted).
  Copyright Matt Pocock, MIT License (from the repository).
- nielsmadan/skills, `review-interfaces` and `review-architecture`: verb vocabulary and
  symmetric pairs, inconsistent vocabulary, project conventions over generic practice.
  MIT License (from the repository).
- luoling8192/software-design-philosophy-skill (`SKILL.md`): naming red flags and consistency.
  Copyright (c) 2026 luoling8192, MIT License.

MIT notice for adapted text: Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files, to deal in the
Software without restriction, subject to including the copyright notice and this
permission notice in all copies or substantial portions of the Software. The software is
provided "as is", without warranty of any kind.

## Apache-2.0 and CC BY 4.0

- rkarbowiak/aip-skill (Apache-2.0 for the skill and code): the outside-in design steps and
  the idea of saying which rules are generic.
- Google API Improvement Proposals (aip.dev), text under CC BY 4.0, as bundled in
  rkarbowiak/aip-skill: AIP-121 (resource-oriented design), 122 (resource names), 124
  (association), 126 (enumerations), 129 (server-modified values), 130 to 136 (standard and
  custom methods), 140 to 144 and 148 (field names, quantities, time, repeated fields,
  standard fields), 180 (backwards compatibility), 216 (states). The rules here paraphrase
  them and are changed to follow Agenta conventions, which win where they differ. Attribution:
  "API Improvement Proposals" by Google, https://aip.dev, licensed under CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Changes were made.

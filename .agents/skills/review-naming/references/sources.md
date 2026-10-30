# Sources and attribution

The lens is written in our own words unless a line below says otherwise.

## Agenta (ours)

- `review-simplify` skill: the lens shape (inputs,
  read-only rule, output format, "What to keep", the `Rating:` last line) and the rating scale.
- `naming-and-resources` skill: every naming rule this lens applies.
- `api/AGENTS.md` on `origin/main`: the layering authority.
- `evals.md` golden cases: from our own naming reviews of a spec draft and of the gateway
  modules.

## Review guides supplied by the owner (free to reuse)

- `2026-10-29-architecture-code-review` (after John Ousterhout, *A Philosophy of Software
  Design*, 1st edition): deep modules, information leakage, pass-through layers, defaults
  and overexposure, define errors out, complexity symptoms, the final filter (evidence gate),
  finding categories, the working model, normal and failure traces, the change exercise,
  guardrails against mechanical reviews, the restraint cases in `optional/restraint-cases.md`
  (adapted from its evaluation cases), and the long report format.
- `architecture-and-code-review-2026-10-29` (after Eric Evans, *Domain-Driven Design*): the
  calibration cases in `calibration.md` (adapted), isolation of domain rules, transactions
  and invariants, same word in two contexts.
- `enterprise-architecture-review` (after Martin Fowler, *Patterns of Enterprise
  Application Architecture*): rules on every entry point, transactions and races,
  responsibility layers.
- `api-design-code-review` (after Jasmin Blanchette, *The Little Manual of API Design*):
  the seven-step finding quality gate (shortened), state ownership, doubtful surface.

## MIT

- nielsmadan/skills, `review-architecture` and `review-interfaces`: the structural smells
  table (adapted), lens boundaries, project architecture over generic best practice.
  MIT License (from the repository).
- mattpocock/skills, `codebase-design`: the deletion test for pass-through layers.
  Copyright Matt Pocock, MIT License (from the repository).
- luoling8192/software-design-philosophy-skill (`SKILL.md`): the red flags list in
  `optional/red-flags.md` (adapted). Copyright (c) 2026 luoling8192, MIT License.

MIT notice for adapted text: Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files, to deal in the
Software without restriction, subject to including the copyright notice and this
permission notice in all copies or substantial portions of the Software. The software is
provided "as is", without warranty of any kind.

## Apache-2.0 and CC BY 4.0

- rkarbowiak/aip-skill (Apache-2.0): the finding shape that cites the rule and its strength
  (must or should), ending with what is right, and the eval format in `evals.md` (prompt,
  graders, near-miss negatives).
- Google API Improvement Proposals (aip.dev), CC BY 4.0, through the naming-and-resources
  rules. Attribution: "API Improvement Proposals" by Google, https://aip.dev, licensed under
  CC BY 4.0. Changes were made.

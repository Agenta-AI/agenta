# Snippets Design Docs

Status: draft  
Last updated: 2026-02-11

## Purpose

This folder contains iterative design docs for the `poc/snippets-using-legacy-apps` work.  
The branch uses older naming and entities in several places; these docs focus on intent and direction rather than strict legacy naming fidelity.

## Documents

- `PRD.md`: product goals, user problems, requirements, and success criteria.
- `RFC.md`: technical contract, including snippet embed format, dereferencing, and resolver behavior.
- `PR.md`: draft pull request narrative/checklist for implementation review.

## Where To Find Snippet Format

- Canonical format and resolver contract: `RFC.md` -> `Snippet Format (Normative for This Branch)`

## Scope

- Define how "snippets" should behave as first-class artifacts.
- Preserve backward compatibility with legacy "application" terms and flows where needed.
- Capture unresolved decisions to drive follow-up iterations.

## Open Questions

- Should "snippet" eventually replace "application" in all user-visible surfaces, or remain an alias?
- Do we want a hard migration timeline away from legacy entities, or long-term dual support?
- Which compatibility guarantees are required for existing API clients and SDK users?

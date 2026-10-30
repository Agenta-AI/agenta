# Report template

## Evidence gate

Before you report a finding, answer privately:

1. What concept, caller or change is affected?
2. What evidence shows it: the exact names, files, lines, or spec sections? What part is
   interpretation?
3. Is it new in the target, made worse by it, or pre-existing and untouched?
4. Does the fix reduce total cost after migration and compatibility costs?
5. Is it more than a preference, and does its severity match its cost?

Drop a finding that fails 1 or 2. Move a finding with missing evidence to "Questions". If
one cause produces several symptoms, report the cause once and list the places.

## Categories

- **Defects**: a traceable wrong result (a caller does the wrong thing because of a name, a
  rule that a path bypasses).
- **Design findings**: a concrete cost (two names, two meanings, a broken pattern, a missing
  owner level), with the places it touches.
- **Questions**: risks with missing evidence. Questions do not affect the rating.

## Output format

Write the report in plain English, in exactly this shape:

```markdown
# Naming review

Base: <base sha, or "design" for a design target>
Head: <head sha, or "<design path> at <commit or date>" for a design target>

## Findings

### 1. <one-line title>
- Category: Defect | Design finding
- Severity: High | Medium | Low
- Rule: <the rule it breaks, with its source, for example "one concept, one name
  (naming-rules.md 1), must">
- Where: <file>:<line>, or the spec file and heading (more locations if needed)
- Evidence: <the exact names or text, side by side>
- What is wrong: <the cost: who guesses wrong, which change touches which places>
- Smallest fix: <rename, map in one place, or record an exception; show the names>

(more findings, most important first; write "No findings." if there are none)

## Questions

<risks with missing evidence; optional>

## What to keep

<names and patterns that already follow the rules; a clean review says so>

Rating: Low | Medium | High
```

Severity Low means a suggestion the owner may decline. The last line must be
`Rating: <value>` with nothing after it, so a script can read it.

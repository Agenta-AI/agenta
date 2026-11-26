# Long report format (optional)

Load when the caller wants a full standalone report instead of the lens format. Omit empty
sections and do not paste the checklist.

```markdown
# <Target> naming and architecture review

## Result
<one or two lines: the rating and the most important fix>

## Scope
<what was read, at which commit or date; what was not read>

## Context
<a short working model: modules, what each owns, the names each uses>

## Defects
<numbered, in the finding format of report-template.md>

## Design findings
<numbered, in the same format>

## Risks and limits
<questions with missing evidence; what this review did not check>

## Next steps
- What the reviewer did: <...>
- What the owner decides: <...>

## What to keep
<...>

Rating: Low | Medium | High
```

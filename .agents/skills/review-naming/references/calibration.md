# Calibration

These cases help you hold back as much as they help you detect. The first group is made up, and
the second comes from patterns in Agenta. Read them before a review when you are unsure whether
a pattern is a finding.

## Must not be findings

1. **A plain update.** A route takes a new color for a tag, confirms the caller may edit, and
   saves the value. Only that route writes the field. Expected: no finding about a missing domain
   layer, repository or factory.
2. **One word in two areas with a clear handover.** The auth code uses `Account` for a login. The
   finance code uses `Account` for a ledger. They pass ids through one translation function, and
   neither one writes the other's data. Expected: no finding. Look only at the translation.
3. **Storage already guards the rule.** Two callers read first, but a unique index or a conditional
   update settles who wins. Expected: no race finding unless another reachable path gets around
   the guard. You may still ask whether the index is named and shaped like its siblings.
4. **A rule nobody asked for.** You would like a different product rule, but no requirement or
   contract states it. Expected: a question at most.
5. **Our convention over a generic one.** The spec uses `created_at`, `slug`, `name`,
   `Windowing`. Expected: no finding. AIP's `create_time`, `display_name` and `page_token`
   are overridden by `project-conventions.md`.
6. **Slug unique per owner.** A slug is an address, unique within one owner's list.
   Expected: no finding for "the same slug exists in two projects".
7. **A thin service method with a purpose.** The method confirms the caller owns the row and then
   calls the DAO with the same arguments. Expected: no finding about forwarding, because the
   ownership check is real work.

## Must be findings

1. **A unit that changes without notice.** An outside service reports seconds, our field holds
   milliseconds, and the code assigns one to the other unchanged. Expected: a defect. Show both
   contracts.
2. **A getter with a side effect.** `get_quota()` also resets a stored counter. Expected: a defect.
   Picking a better name does not solve it.
3. **Two names for one concept on new surface.** A new column, DTO field and route parameter
   name one concept three ways. Expected: a design finding (Medium), with the per-layer row
   as evidence.
4. **A shipped name spread to new surface.** A table keeps a shipped column under an old
   name (a recorded exception), and the target adds a new index and a new reference field
   for the same concept, again under the old name, while sibling tables use the term.
   Expected: a design finding. The exception covers the shipped column, not the new surface.

## When evidence is missing

If you can't read the writer, the schema or the caller, name what you couldn't read and put the
point under Questions. Don't state that it is a fault, and don't state that it is safe.

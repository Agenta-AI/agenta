# Calibration

Use these cases to check your restraint as much as your detection. The first group is
synthetic; the second comes from Agenta patterns. Read them before a review when you are
unsure whether a pattern is a finding.

## Must not be findings

1. **Simple data maintenance.** A short handler validates a label, checks permission and
   stores it. One write path, no richer rules. Expected: no finding for the lack of a domain
   layer, repository or factory.
2. **The same word in two contexts.** Billing uses `Customer` for a legal payer; support
   uses `Customer` for a person with a ticket. They exchange ids through an explicit mapping
   and neither writes the other's state. Expected: no finding. Inspect the mapping only.
3. **An invariant already protected by storage.** Two callers check first, but the write is
   a conditional update or a unique index decides. Expected: no race finding without another
   reachable bypass. The naming side (is the index named and shaped like its siblings) may
   still apply.
4. **A rule the domain does not state.** The reviewer would prefer a different product rule,
   but no requirement or contract asks for it. Expected: at most a question.
5. **Our convention over a generic one.** The spec uses `created_at`, `slug`, `name`,
   `Windowing`. Expected: no finding. AIP's `create_time`, `display_name` and `page_token`
   are overridden by `project-conventions.md`.
6. **Slug unique per owner.** A slug is an address, unique within one owner's list.
   Expected: no finding for "the same slug exists in two projects".
7. **A forwarding method that earns its place.** A service method checks that the caller
   owns the row, then calls the DAO with the same arguments. Expected: no pass-through
   finding; it adds authorization.

## Must be findings

1. **A unit lost at a boundary.** A provider sends cents; the local contract uses dollars;
   the adapter copies the number. Expected: a defect, with the two contracts as evidence.
2. **A query that mutates.** `calculate_total()` subtracts a discount from stored prices.
   Expected: a defect; a rename alone does not fix it.
3. **Two names for one concept on new surface.** A new column, DTO field and route parameter
   name one concept three ways. Expected: a design finding (Medium), with the per-layer row
   as evidence.

4. **A shipped name spread to new surface.** A table keeps a shipped column under an old
   name (a recorded exception), and the target adds a new index and a new reference field
   for the same concept, again under the old name, while sibling tables use the term.
   Expected: a design finding. The exception covers the shipped column, not the new surface.

## When evidence is missing

If you cannot read the writer, the schema or the caller, say what is missing and put the
point under Questions. Do not claim a fault or claim that it is safe.

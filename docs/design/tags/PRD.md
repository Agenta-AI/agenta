# PRD: Tags (Draft)

## 1. Problem Statement

Users need a consistent way to organize information across entities.
Current workflows rely too heavily on naming conventions and manual search, which becomes slow and unreliable at scale.

## 2. Product Goals

- Let users create and assign tags easily while working in context.
- Enable fast tag-based discovery through autocomplete and filtering.
- Provide a unified tag index that supports query, filtering, paging/windowing, and version-aware reads.
- Set a foundation for future saved views built from tag combinations.

## 3. Non-Goals (v1)

- Hierarchical tags.
- Tag-based permissions model changes.
- Automatic tag generation/suggestion.
- Full saved-views productization (targeted for later phases).

## 4. Users and Core Use Cases

- **Primary users**: Team members who create, triage, evaluate, and monitor entities.
- **Core use cases**:
  - Add tags during normal workflows without leaving current screens.
  - Find entities quickly via tag autocomplete and tag filters.
  - Reuse common tag sets to keep organization consistent.

## 5. Scope

### In Scope (v1)

- Tag CRUD behavior.
- Assign/unassign tags on supported entities.
- Global tag index/table that can be queried independently of any single entity.
- Autocomplete UX backed by query endpoints.
- Tag-based filtering on list/search experiences.
- Basic management surfaces for viewing and maintaining tags.

### Planned Next (Post-v1)

- Saved Views for tags (saved combinations/conditions over tags).
- Saved Views scope model (user, project, workspace, organization).
- Shared and reusable view definitions across teams.

### Out of Scope (v1)

- Hierarchical/tag taxonomy management.
- Cross-tenant sharing behavior changes.
- Advanced analytics and recommendations.

## 6. UX Requirements

- Add and remove tags directly from details and list views.
- Show autocomplete suggestions as user types.
- Support "complete list" discovery mode in addition to prefix autocomplete.
- Keep interactions keyboard-friendly and low-friction.
- Show tags consistently (chip/badge treatment) across surfaces.

## 7. Functional Requirements

1. System supports tag creation, update, and deletion with auditability.
2. Tag assignment can happen from entity workflows and should passively populate/maintain the global tag index.
3. Tag query endpoint returns tags with standard filtering and windowing/pagination semantics.
4. Tag query endpoint supports version-aware reads (versioning semantics to be finalized).
5. Autocomplete can operate globally or scoped by entity kind (final behavior TBD).
6. Entity list/search endpoints support filtering by one or more tags.
7. Tag naming uniqueness and normalization rules are consistently enforced.

## 8. Saved Views Vision (Future)

Saved Views are named, persisted tag-based searches/filters that users can reopen and share.
They should support:

- Logical combinations of tags and operators (query-like behavior).
- Scope ownership (user/project/workspace/organization).
- Metadata such as name, description, creator, timestamps, and version.
- Cross-entity conditions where applicable.

This capability is intentionally future-facing but is a core reason to design tags around robust querying.

## 9. Success Metrics

- Percentage of active users applying tags weekly.
- Percentage of entities with at least one tag.
- Tag-filter usage rate in list/search screens.
- Autocomplete usage and acceptance rate.
- Time-to-find improvements for tagged entities.

## 10. Risks

- Noisy or duplicative tags without governance guidance.
- Performance regressions if tag query/index paths are under-indexed.
- Ambiguity around global vs entity-kind scoped autocomplete behavior.
- Saved-views model complexity if scope and sharing rules are not defined early.

## 11. Open Questions

1. Should autocomplete default to global tags, entity-kind tags, or a hybrid?
2. What are the versioning guarantees for the tag query endpoint?
3. What are the required filters/windowing parameters for tags API parity with other query endpoints?
4. What is the initial maximum tag count per entity?
5. Which saved-view scopes ship first: user, project, workspace, or organization?
6. Should Saved Views support cross-entity conditions in the first release of that feature?
7. Do we require soft delete for tags and Saved Views from day one?

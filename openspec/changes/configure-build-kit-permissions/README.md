# Build kit permissions

Direction approved by Mahmoud, 2026-09-24. Implementation is under review.

Make every playground build kit tool run without asking by default, and let the person choose Allow, Ask or Deactivate per tool in the Advanced drawer, using the integration permission drawer's layout.

## Read in this order

1. [Proposal](proposal.md): why, what changes, impact.
2. [Behavior specification](specs/playground-build-kit-permissions/spec.md): permissions, persistence, migration and confirmation behavior.
3. [Design](design.md): current code, decisions, risks, confirmed decisions and persistence contract.
4. [Tasks](tasks.md): implementation and verification checklist.

## Continue in the repository

These files live in `openspec/changes/configure-build-kit-permissions/` in `Agenta-AI/agenta`. Implementation starts from `main` at `2f9cf635`.

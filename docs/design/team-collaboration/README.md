# Team collaboration

This workspace defines the first three increments of Agenta's team collaboration model. Read the
documents in this order:

1. [Visual walkthrough](./walkthrough.html) explains the research, product direction, and three
   RFCs as an interactive step-through presentation.
2. [PRD](./prd.md) explains the user problem, product boundaries, release sequence, and measures.
3. [Authorization consistency RFC](./rfc-0-authorization-consistency.md) defines the security
   foundation and current credential semantics.
4. [Session audiences RFC](./rfc-1-session-audiences.md) separates an early **My sessions** filter
   from server-enforced privacy.
5. [Session sharing RFC](./rfc-2-session-sharing.md) adds named access, Project access, revocation,
   and owner lifecycle.
6. [Research](./research.md) contains the Competitor A, Competitor B, Competitor C, and Agenta comparison and the
   provisional Kano analysis.
7. [Status](./status.md) records progress and unresolved product decisions.

## Terms

- **Workspace:** The effective people boundary today. Workspace members are mirrored into its
  Projects.
- **Project:** The resource namespace and current permission-evaluation scope.
- **Session access record:** The stable ownership and audience policy for one session. It remains
  available while session-derived records or traces exist.
- **Audience:** Who may discover and access a session: personal, Project, or named people.
- **Grant:** Explicit access for one Workspace member to one session.
- **View:** Read a session and its authorized derived data.
- **Join:** View and continue a session. Join also requires an execution identity and credential
  policy.

## Design rule

Start with session-specific storage and one shared authorization service. Do not build a generic
resource ACL framework until a second resource needs the same contract. UI filtering may ship
before server enforcement, but it must never be described as privacy.

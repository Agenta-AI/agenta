# RFC 2: Session sharing

## Scope

This RFC adds named read access and Project sharing after RFC 1 enforcement is complete. It does not
add Join, groups, public links, or administrator break-glass access.

## Contract

The owner can:

- Keep a session personal.
- Share it with named Workspace members as **Can view**.
- Share it with all Project members.
- Revoke named or Project access.

**Specific people** is a computed label: a personal session with one or more active grants. The
stored audience remains only `personal | project`.

## Data model

```text
session_grants
  id
  project_id
  session_id
  grantee_user_id
  created_at / created_by_id
  deleted_at / deleted_by_id
```

One active grant exists per session and user. There is no role field because the first release has
one grant type: View. The grantee must have active Project membership and `view_sessions`.

Do not create one grant per Project member. Do not create a generic resource grant table until a
second resource needs the contract.

## Effective access

```text
can_view = active Project membership
           AND view_sessions
           AND custody_is_active
           AND (is_owner OR audience_is_project OR has_active_grant)
```

A grant narrows which resource instance the member can read. It does not grant a missing tenant or
resource-type capability.

## Operations

Use session-nested operations:

- Retrieve audience and People with access.
- Change audience between personal and Project.
- Grant one member View access.
- Revoke one member.

Grant and revoke operations are idempotent. Switching to Project revokes named grants. Switching to
personal also revokes named grants. This prevents hidden access from returning after later audience
changes.

Audience and grant mutations run in one transaction with compare-and-swap on
`session_access.revision`. A stale mutation returns conflict with the current access state.

## Policy

Add one Workspace-scoped policy:

```text
session_sharing_policy
  named_sharing_enabled boolean
  project_sharing_enabled boolean
```

The Workspace Owner/Admin changes the policy. Both values default to enabled for continuity with
Project sharing, but named sharing remains unavailable until this RFC ships. The controls are
prospective: disabling them blocks new grants and personal-to-Project transitions but does not
silently revoke existing access. Access-reducing operations always remain available. Policy changes
are audited through the same outbox.

Administrator content inspection and public/external sharing are not policy fields yet because the
features do not exist.

## UI

The session header shows:

- **Only you**
- **Specific people**
- **Project members**

The share panel includes the audience selector, Workspace-member search, People with access, and
revoke. People with access is an authorization list, not presence.

The UI offers **Can view** only. It does not expose a disabled Join role.

## Member and owner departure

The RFC 0 offboarding transaction revokes grants for the departing member, freezes personal
sessions they own, clears their ownership authority from Project sessions, increments affected
revisions, and closes streams. A Project session remains Project-visible. There is no automatic
transfer and no access widening. Re-adding the user does not restore old ownership or grants.

## Audit persistence

Grant and audience mutations write an audit outbox row in the same database transaction. The worker
can fan out to the existing event pipeline and EE Audit UI. The outbox is the durable record because
the existing capped Redis event stream can drop events.

Events contain actor, session ID, affected user, old/new audience or grant state, timestamp, and
result. They contain no transcript, tool arguments, file content, or credentials.

## Revocation

After revoke:

- New reads fail immediately at application authorization.
- Access revision changes close or invalidate event streams.
- New downloads, exports, and signed URLs fail.
- Previously downloaded content cannot be recalled.
- Previously issued signed URLs remain valid until their documented short expiry unless storage
  revocation is added.

The UI states that revoke prevents future access but cannot erase copies already received.

## Verification

- Grant and revoke affect one session only.
- Project sharing does not materialize member grants.
- Audience transitions and grant cleanup are atomic.
- Stale share-panel mutations cannot restore access.
- Policy-disabled access-expanding mutations fail server-side; revoke and other access reductions
  remain available.
- Member removal revokes grants.
- Owner departure never widens access.
- Audit outbox records survive event-worker failure and contain no session content.

## Deferred work

- Join and shared execution.
- Groups and SCIM-backed grants.
- Ownership transfer and administrator recovery.
- Public, guest, and expiring links.
- Agent and Workflow sharing.
- Live presence and comments.

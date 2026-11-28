# Team collaboration foundation PRD

## Problem

Agenta mirrors Workspace members into its Projects. Project roles control resource types, so a
member with `view_sessions` can read every session in the Project. The UI does not show this
audience, and users cannot start personal work and later share it.

This model fits shared traces, evaluations, testsets, and operational runs. It is unclear for
interactive Agent sessions, which look like personal conversations. Competitor A explicitly starts
ordinary conversations private, Competitor C isolates Personal Space chats, and Competitor B documents
deliberate chat sharing while leaving the unshared default implicit.

Existing authorization also has inconsistencies that affect this work:

- Project mutations lack role checks.
- Generic role assignment can grant the reserved Owner role.
- Member removal does not revoke personal API keys immediately.
- Organization security APIs enforce membership while the UI is owner-only.
- Viewer can retrieve decrypted secrets and execute services despite being described as read-only.

## Outcome

Users can organize sessions they created, see who can access a session, start personal or shared
work, and share one personal session without exposing unrelated sessions. Existing operational
collaboration remains Project-wide.

The work has three tracks:

1. **Authorization consistency:** Fix current security and capability contradictions before adding
   new access paths.
2. **Session audiences:** Add a correct **My sessions** filter, then enforce personal and Project
   access through one stable session access record.
3. **Session sharing:** Add named read access and revocation. Continuing another person's session
   is separate future work because it needs an execution identity and credential policy.

The Kano classifications in the research are hypotheses. Product validation must compare LLMOps
teams with general knowledge-work teams before Agenta changes session defaults.

## Users

- **Agent user:** Starts and reads interactive sessions.
- **Builder:** Creates Agents, prompts, workflows, tools, and credentials.
- **Reviewer:** Reads operational sessions, traces, and evaluations.
- **Workspace administrator:** Manages members and Project settings.
- **Security administrator:** Sets identity, credential, and sharing policy.

## Experience

### My sessions

The Sessions page offers **My sessions** and **Project sessions**. The backend filters by human
origin and creator before pagination. **My sessions** is an organization view, not privacy. Current
rows show **Project members** as their effective audience.

### Personal and Project sessions

A session starts from an explicit context:

- A personal entry point creates **Only you** access.
- A Project entry point creates **Project members** access.
- Triggered and operational sessions remain **Project members**.

Existing sessions remain Project-visible after migration. The UI always shows the effective
audience.

**Only you** does not ship until list, direct read, records, turns, interactions, files, mounts,
traces, and event-stream access all enforce the same audience.

### Named sharing

The owner can share a personal session with named Workspace members as **Can view**. The share
panel lists people with access and supports revoke. It does not imply live presence.

Project sharing changes the audience to **Project members**. Returning to personal access revokes
named grants so old access cannot silently return.

## Requirements

### Authorization consistency

- Every Project mutation has a backend capability check and matching UI gate.
- Organization ownership transfer updates Organization, Workspace, and Project roles atomically.
- Generic role assignment cannot grant Owner or modify the caller's own role.
- Member removal revokes personal API keys and future runtime-credential refresh.
- Organization domain and SSO APIs follow one explicit owner policy and never return stored client
  secrets.
- Viewer cannot reveal stored secrets.
- The product separately decides Viewer billing visibility and billable execution. These decisions
  do not block the session audience data model.
- Personal API keys remain user-delegated Project credentials. Durable service accounts are a
  separate design.

### Session audiences

- **My sessions** is filtered server-side by manual origin and creator before count and pagination.
- Historical creator attribution is separate from current ownership.
- Existing and automation sessions migrate to Project audience.
- One stable access record exists before session-derived data is written.
- Every derived object has a trusted path to `(project_id, session_id)`.
- Missing or inconsistent access relationships fail closed after migration.
- Private-session traces inherit session access. Unrelated operational traces remain Project-wide.
- Deleting runtime state cannot delete the access record while derived data remains.

### Session sharing

- The owner can grant and revoke named View access.
- The owner can switch between personal and Project access.
- Audience changes and grant changes are atomic.
- Removing a member revokes their grants.
- Owner departure never widens access. Ownerless private sessions freeze until a later recovery
  policy is approved.
- Sharing changes produce non-content audit records.
- A Workspace-level policy can disable named or Project sharing.

## Non-goals

- Agent, Workflow, prompt, evaluation, or testset sharing.
- Groups, SCIM grants, public links, external guests, or expiring links.
- Join access, shared execution, or shared credentials.
- Administrator break-glass content access or ownership transfer for private sessions.
- Live presence, comments, reactions, or simultaneous editing.
- A generic polymorphic ACL framework.
- A four-permission secret redesign in this project. Secret metadata/use/reveal remains a separate
  follow-up after immediate plaintext exposures are closed.

## Sequence

| Release | Outcome | Claim |
| --- | --- | --- |
| Security fixes | Close current Project, ownership, member-key, SSO-secret, and Viewer-secret issues | Existing authorization is consistent enough to extend |
| My sessions | Correct server-filtered creator view and **Project members** labels | Organization only, no privacy |
| Audience shadow mode | Create/backfill access records as Project and verify relationship coverage | No behavior change |
| Personal sessions | Enforce personal/Project access across all surfaces | **Only you** is valid |
| Named read sharing | Grant, revoke, people list, policy, and audit | Read sharing is valid |

Viewer billing/execution semantics and a broader secret-capability model can run as separate work.
They should not expand the critical path for session read privacy.

## Measures

- Adoption of **My sessions** and continued use of **Project sessions**.
- Share of sessions started from personal and Project entry points.
- Named share and revoke completion rates.
- Recipient open rate.
- Zero unauthorized reads through list, direct ID, trace, file, mount, or event-stream tests.
- Removed-member personal keys fail within the documented revocation bound.
- No decline in triggered and operational session discovery.
- Reports of unexpectedly visible or unexpectedly missing sessions.

## Decisions

1. Confirm a dedicated `manage_projects` capability for Project mutations.
2. Confirm Organization security remains owner-only in the first fix.
3. Confirm personal API keys die with Project membership.
4. Confirm Viewer loses plaintext secret access immediately.
5. Decide session defaults by entry point after **My sessions** usage research.
6. Confirm named sharing starts View-only.
7. Confirm ownerless private sessions freeze instead of widening or transferring automatically.

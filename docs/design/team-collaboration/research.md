# Team collaboration research: Competitor A, Competitor B, Competitor C, and Agenta

**Research date:** 2026-08-12  
**Scope:** Team structure, conversations and sessions, sharing, visibility, roles, permissions,
ownership, provisioning, governance, and collaborative work on agents and workflows.

## Summary

Competitor A, Competitor B, and Competitor C all distinguish personal work from deliberately shared work. They use
different names and permission models. Competitor A explicitly starts ordinary Conversations private.
Competitor C isolates Personal Space and direct-share chats. Competitor B documents deliberate chat sharing
but leaves the unshared default implicit. Their common product contract is:

1. A conversation outside a shared team context can remain personal until the user shares it.
2. A team context makes its resources visible to its members.
3. Sharing an agent or workflow is separate from sharing conversations created with it.
4. Resource access can distinguish use, view, and edit capabilities.
5. Enterprise administration adds groups, provisioning, audit, retention, and policy controls.

Agenta currently follows a different contract. Workspace membership is the effective people
boundary because Workspace members are mirrored into its Projects. A Project is the resource and
permission-evaluation scope. A member with `view_sessions` can see every session in the Project.
The same Project-wide rule applies to agents, prompts, workflows, evaluations, testsets, and
traces. Roles determine what a member can do, but there are no private resources, conversation
participants, direct grants, groups, or share links.

This makes Agenta strong for shared LLM engineering work but weak for the personal-to-team
collaboration loop used by general agent platforms:

- **Strong:** organization and Project structure, invitations, six domain-specific default roles,
  Project-wide assets, annotations, versioned configuration snapshots, and enterprise audit/SSO
  controls.
- **Partial:** ownership and offboarding, environment-configured EE roles, audit export,
  provisioning, and clear documentation of the actual Workspace layer.
- **Missing:** private sessions, conversation sharing, participants and mentions, resource-level
  access, groups, use-only agent access, public or guest links, and explicit admin-content policy.

The leading product hypothesis is not a generic sharing button. It is a clear two-context model:

- **A user can start a personal session and share it explicitly.**
- **Project resources remain shared by default.**

Whether every human-started session should default to personal or inherit its entry-point context
requires validation with LLMOps and general knowledge-work users. The required product property is
an explicit audience, not one universal default.

## Method and limitations

This report uses official product documentation, help centers, API references, pricing pages, and
the current Agenta codebase. It does not infer a feature from marketing copy when the operational
documentation does not define its behavior.

The Kano classification is a product hypothesis, not the result of a customer Kano survey. It
estimates how a company adopting one of these platforms is likely to react to the presence or
absence of each capability. The final section gives a survey format for validating it.

The three vendors' Trust Centers were not readable through the available text tools. They returned
script shells or gated content. This prevented inspection of detailed control evidence but did not
block the product-feature comparison. Several official pages also conflict with newer pages. Those
conflicts are called out below.

## Competitive models

### Competitor A

#### Team structure

Competitor A's main administrative boundary is a **Workspace**. It contains members, groups, agents,
conversations, data Spaces, and Pods. The public documentation does not define a higher-level
organization that centrally owns multiple Workspaces.

Competitor A uses two team-context concepts:

- A **Space** controls access to data. Open Spaces are available to the Workspace; Restricted
  Spaces are available only to selected members or provisioned groups. Agent availability is
  constrained by access to the data Spaces the Agent uses.
- A **Pod** is a shared work area for Conversations, Tasks, Files, and Frames. Open Pods are
  discoverable and joinable by Workspace members. Restricted Pods are visible only to invited
  members.

Sources: Spaces management (competitor docs),
Pods overview (competitor docs).

#### Conversations and sharing

Competitor A's current collaboration guide says ordinary Conversations are private by default. The creator
can share a live Conversation link with Workspace colleagues. A colleague joins the same
Conversation, sees its existing history, and can reply. A participant can also mention a colleague;
after confirmation, that person becomes a participant and receives access to the full history.

Access is constrained by the Agents and Restricted Spaces used in the Conversation. A link does
not bypass those permissions. Workspace administrators can see usage metadata but are not granted
private Conversation content merely because they are administrators.

Pod Conversations use the opposite default. Every Pod member can see and contribute to every
Conversation in the Pod. Pod Conversations are automatically indexed and made available to Agents
as shared context.

Sources: Collaboration (competitor docs),
Pod Conversations (competitor docs).

Competitor A's API still exposes `participants_only` and `workspace_members` URL access modes. An older
changelog entry describes private-by-default URLs as an Admin setting. The current guide presents
privacy as the default, but the migration and legacy Workspace behavior are not documented.

Sources: Update a Conversation (competitor docs),
private-by-default changelog (competitor docs).

#### Roles and shared agents

Competitor A's current Workspace roles are **Admin**, **Manager**, and **Member**. Workspace permissions
can be granted to groups for operations such as creating or publishing Agents and Skills, viewing
audit logs, billing, provisioning, and external Frame sharing. Group grants are additive.

Pods separately use **Editor** and **Member** roles. Editors manage Pod membership, roles,
visibility, and settings. Members work with Conversations, Tasks, and Files.

Published Agents are visible to Workspace members who can access their underlying data. An
unpublished Agent is visible only to its Editors. Multiple Editors can maintain an Agent. An Admin
can inspect any Agent in view-only mode and explicitly become an Editor before changing it.

Sources: Workspace governance (competitor docs),
Pod roles (competitor docs),
create an Agent (competitor docs),
Agent management (competitor docs).

Competitor A is migrating from an older **Member / Builder / Admin** model to the current
**Member / Manager / Admin** model with granular group permissions. Some operational pages still
use the older roles.

#### Administration

Competitor A supports manual invitations, SAML SSO, and Enterprise SCIM user and group provisioning.
Enterprise Audit Logs can be searched, exported as CSV, or streamed to a SIEM. Workspace analytics
and exports contain usage metadata, not message content. Enterprise advertises custom retention,
but its public documentation does not define the available periods or covered data classes.

Sources: SSO (competitor docs),
SCIM (competitor docs),
Audit Logs (competitor docs),
Workspace analytics (competitor docs),
pricing (competitor docs).

### Competitor B

#### Team structure

Competitor B's administrative boundary is a **Workspace**. A Workspace contains users, roles, groups,
products, security configuration, billing, and retention policy. The public documentation does not
define a user-facing organization layer above it.

**Projects** are shared contexts containing chats, files, and custom instructions. **Folders** and
**Knowledge bases** are separately shareable library resources. Groups can be public or private and
have their own Member, Editor, and Admin roles.

Sources: Workspace settings (competitor docs),
Projects (competitor docs),
Folders (competitor docs),
Knowledge bases (competitor docs).

#### Conversations and sharing

Ordinary chat sharing creates a Workspace-only link. Anyone in that Workspace who has the link can
read the complete conversation, later messages, and attachment names. The owner can revoke the
link. Administrators can disable chat sharing for the Workspace.

The documentation strongly implies that ordinary chats are private before sharing, but it does not
state this as an explicit normative rule. It also does not define whether Workspace Admins can read
unshared chats.

Sources: Chat sharing (competitor docs),
shared chats (competitor docs),
Workspace capabilities (competitor docs).

A shared Project grants all Project members access to every current and future chat, file, and
instruction in that Project. The creator of each chat remains its owner and is the only person who
can edit, rename, or delete it. Project **Owners** and **Editors** can manage context and sharing;
Project **Users** can read all Project content and add or remove their own chats.

Source: Projects (competitor docs).

Sharing an Agent does not expose its users' chats. A user can deliberately attach a complete Agent
conversation to feedback, in which case the Agent creator receives access. Competitor B Support access
is also explicit, revocable, and expires after 72 hours.

Sources: Agent configuration (competitor docs),
Agent analytics and feedback (competitor docs),
Support sharing (competitor docs).

#### Roles and shared agents

Workspace roles are **Admin**, **Editor**, and **Member**. Admins can customize permissions for
creating and sharing Agents, Workflows, Folders, Knowledge bases, Skills, templates, Projects, and
prompts. Object roles are independent from the Workspace role.

Agents can be private, shared with selected users or groups, or shared Workspace-wide. Sharing can
grant use or edit access. Only Workspace Admins can transfer ownership. If an owner leaves, the
Agent remains usable but becomes unassigned and cannot be edited until an Admin assigns a new
owner. A Governance add-on can make sharing Admin-managed.

Sources: Permission recommendations (competitor docs),
Agent configuration (competitor docs),
ownership transfer (competitor docs),
unassigned Agents (competitor docs),
Admin-managed sharing (competitor docs).

#### Administration

Competitor B supports manual invitations, allowed-domain joining, a User Management API, SAML, and
SCIM user/group synchronization. Admins can invalidate active sessions. Audit logs retain 90 days
of actor, entity, action, IP, and before/after metadata. Usage exports cover up to 12 months but do
not document full chat transcripts. Chat retention can be 7 days, 1 month, 3 months, 12 months, or
forever and is based on inactivity.

Sources: User invitations (competitor docs),
SAML (competitor docs),
SCIM (competitor docs),
session management (competitor docs),
Audit Logs API (competitor docs),
usage exports (competitor docs),
retention (competitor docs).

### Competitor C

#### Team structure

Competitor C has the clearest personal/team split. An **Organization** contains each user's private
**Personal Space** and one or more shared **Teams**. A resource can be moved from a Personal Space
into a Team. Team resources cannot be fully restricted from Team members.

Teams contain Agents, Workbooks and Workflows, Skills, custom operators, and Team Connectors.
Nested Teams are not documented.

Source: Organizations and Teams (competitor docs).

#### Conversations and sharing

For a Personal Agent, directly shared users see only their own chats. The Personal Agent's creator
does not automatically see those users' chats. For a Team Agent, Team members with Viewer or higher
access can see every chat. Organization Admins can see all chats in the Organization.

Individual chat sessions can be shared as read-only. A viewer can read the session but cannot send
messages. Hosted Agent pages preserve the same distinction between Team-wide conversation
visibility and isolated chats for directly shared users.

Sources: shared Agent chat visibility (competitor docs),
Personal Agent visibility (competitor docs),
Share permissions (competitor docs),
Hosted Pages (competitor docs).

This model gives administrators broader message-content visibility than Competitor A documents and than
Competitor B publicly defines. It is a meaningful policy difference, not only an implementation detail.

#### Resource access

Competitor C uses item-level roles:

| Role | Capability |
| --- | --- |
| Owner | Full control, sharing, deletion, and copying |
| Editor | View, edit, delete, share, and copy |
| Viewer | Inspect configuration and sharing and make a copy; cannot edit |
| Use Only | Invoke an Agent or Skill without seeing instructions, tools, files, or internals |

General Access can be **Restricted**, **Team**, **Organization**, or **Anyone with link**. Direct
user grants can override a broader general-access role. Agents and Skills support Editor, Viewer,
and Use Only. Workflows support Editor and Viewer; a Workflow Viewer cannot run it. Chat Sessions
support Viewer only.

Source: Share permissions (competitor docs).

The current docs say Team members receive Viewer access by default, but an older help article and
one sentence on the Teams page say all members can edit. Viewer-by-default is the newer and more
specific rule, but this remains an official documentation conflict.

#### Roles and administration

Organization roles are additive. Built-in Organization roles include **Admin**, **Manager**,
**Member**, **Security**, **Developer**, and **Analytics**. Teams separately use **Team Admin** and
**Team Member**. Enterprise Custom Roles can restrict apps, tools, models, sharing, resource
modification, Team creation, credentials, and usage limits.

Admins and Managers can invite members. Invitations can pre-assign roles and Team memberships.
Competitor C also supports CSV invitations, domain joining, SAML just-in-time creation, and Enterprise
SCIM provisioning into Teams and Custom Roles.

Sources: Organization roles (competitor docs),
Custom Roles (competitor docs),
Organizations and Teams (competitor docs),
SAML and SCIM (competitor docs).

Enterprise Audit Logging covers identity, credentials, membership, sharing, agents, workflows,
files, runs, and SCIM events. Retention depends on the contract. Enterprise exports can include
Team resources and, optionally, all Personal Spaces. Standard chats are described as permanent;
Incognito chats are not saved and their files are deleted after 24 hours. Custom retention is
advertised but not publicly specified.

Sources: Audit Logging (competitor docs),
data export (competitor docs),
Agents and Incognito (competitor docs),
pricing (competitor docs).

## Cross-platform comparison

| Area | Competitor A | Competitor B | Competitor C | Agenta today |
| --- | --- | --- | --- | --- |
| People/membership boundary | Workspace | Workspace | Organization | Workspace in practice |
| Resource scope below that boundary | Space and Pod | Project and Library resources | Team and Personal Space | Project; members are mirrored from Workspace |
| Personal area | Ordinary private Conversations | Ordinary chats appear private | Explicit Personal Space | None inside a shared Workspace |
| Selectable shared team context | Pod | Project | Team | None; Project membership is not independently selectable |
| Ordinary conversation default | Private per current guide | Private is implied, not explicit | Isolated by Personal Space/direct user | Project-visible |
| Conversation link | Live, joinable by eligible Workspace colleagues | Workspace-only read link | Read-only session link | None |
| Multi-person conversation | Participants, replies, mentions | Not documented for ordinary chat | Shared session is read-only | Any permitted member can run/edit the shared session, but no participant model |
| Shared-context conversations | Every Pod member can read and contribute | Every Project member can read all chats; only creator edits own chat | Team viewers can see all Agent chats | Every Project viewer can read all sessions |
| Agent visibility | Unpublished Editors; published eligible Workspace members | Private, users, groups, or Workspace | Restricted, Team, Organization, or public | Project-wide according to Project role |
| Agent access roles | Editors and users, constrained by data access | Use and edit grants; owner lifecycle | Owner, Editor, Viewer, Use Only | Project role controls all resources of that type |
| Groups | Manual and SCIM groups | Public/private groups | No generic sharing group documented; SCIM maps users to Teams and Custom Roles | None |
| Object ACLs | Agents, Skills, Pods, Spaces | Agents, Projects, Folders, Knowledge bases, templates | General Access plus direct item grants | None |
| Ownership transfer/offboarding | Not clearly documented for Agents | Admin transfer; unassigned Agent state | Explicit owner transfer; forced offboarding unclear | Organization ownership only; creator metadata is not a resource ACL |
| SSO | Yes | Yes | Enterprise | EE |
| SCIM | Enterprise users and groups | Users and groups | Enterprise Teams and roles | No customer-facing SCIM flow found |
| Audit | Enterprise export and SIEM stream | 90-day Audit Log API | Enterprise, contractual retention | EE project-scoped UI; no export |
| Retention controls | Enterprise, details unpublished | Explicit chat periods | Enterprise, details unpublished | EE retention/metering exists; no collaboration-specific UI found |
| Execution identity and credentials | Caller permissions constrain Agent and data access | User connections by default; selected/shared service connections supported | Personal, Team, and Agent-owned connectors | Project vault and user-bound API keys; no resource-level Use grant |
| Agent/workflow history | Multiple Agent Editors; version semantics not clear in reviewed docs | Draft/publish Agent versions and Governance history | Agent versions and Workflow checkpoints | Configuration revisions with lineage, author, and commit message |
| Real-time co-editing | Not documented | Not documented | Not documented | Not documented |

## Agenta's current model

### Data and authorization model

The implemented hierarchy is:

```text
User
└── Organization
    └── Workspace
        └── Project
            └── Agents, workflows, sessions, traces, evaluations, and other resources
```

Organizations have an owner. Organization, Workspace, and Project memberships each store a role.
Workspace members are mirrored into the Projects in that Workspace. The runtime permission check
ultimately resolves the Project membership role.

References:

- `api/oss/src/models/db_models.py:18-45,67-98,126-293`
- `api/oss/src/services/db_manager.py:907-944,1423-1510,1530-1675`
- `api/oss/src/core/access/permissions/service.py:172-353`

Agenta ships six default roles: **Owner**, **Admin**, **Developer**, **Editor**, **Annotator**, and
**Viewer**. The default permissions form a cumulative ladder. EE operators can add or overlay roles
through `AGENTA_ACCESS_ROLES` and `AGENTA_ACCESS_ROLES_OVERLAY`, but there is no customer-facing
role builder. The defaults are more domain-specific than the competitors' basic Workspace roles:

- Viewer reads Project resources, including sessions, traces, prompts, evaluations, testsets,
  secrets, and billing.
- Annotator adds evaluation, annotation, trace, tool, and trigger mutation capabilities.
- Editor adds editing and execution for applications, workflows, sessions, testsets, evaluators,
  tools, mounts, and related resources.
- Developer adds API keys, environment deployment, and audit-event access.
- Admin adds Workspace and member management.
- Owner receives every permission and Organization-owner bypass.

References:

- `api/oss/src/core/access/permissions/types.py:4-35,61-258`
- `api/ee/src/core/access/permissions/role_overrides.py:1-10,65-161,168-283`

The central limitation is that these are Project-wide roles, not object roles. Creator fields are
audit metadata. They do not make a session, Agent, prompt, or workflow private. A member with a
resource's edit permission can change resources created by other members.

Sessions demonstrate the difference most clearly. Every member with `view_sessions` can list and
read every Project session. `edit_sessions` controls rename, archive, and deletion;
`run_sessions` controls execution. Session queries do not have an access-owner or participant
filter.

References:

- `api/oss/src/apis/fastapi/sessions/router.py:380-645,1678-1833`
- `api/oss/src/core/sessions/dtos.py:39-75`
- `api/oss/src/dbs/postgres/sessions/streams/dbes.py:23-83`

This Project-wide scope is deliberate in the recent Sessions UX and mobile work:

- `docs/design/session-ux-interface-review.md:37-45`
- `docs/design/agenta-mobile/design.md:7-15,31-41,151-174`

The same authorization pattern applies to workflows, applications, evaluators, testsets,
evaluations, annotations, and traces. There is no implemented resource ACL, personal visibility,
public link token, selected-user grant, guest role, or cross-Project sharing model.

### UI model

The current Settings UI supports:

- Organization creation, switching, rename, ownership transfer, and deletion.
- Project creation, switching, rename, default selection, and deletion.
- A searchable member table.
- One-person email invitations, resend, remove, and invitation status.
- Assignment from the effective role catalog when RBAC is entitled.
- EE verified domains and OIDC SSO.
- An EE Audit Log table with filtering and details.

References:

- `web/oss/src/components/pages/settings/Organization/General.tsx:219-543`
- `web/oss/src/components/pages/settings/Projects/index.tsx:31-381`
- `web/oss/src/components/pages/settings/WorkspaceManage/WorkspaceManage.tsx:60-363`
- `web/oss/src/components/pages/settings/WorkspaceManage/Modals/InviteUsersModal.tsx:19-230`
- `web/oss/src/components/pages/settings/Organization/index.tsx:649-958`
- `web/ee/src/components/pages/settings/AuditLog/components/AuditLogTable.tsx:75-270`

The UI does not provide:

- A private/shared state on a session or resource.
- A Share dialog for sessions, Agents, prompts, workflows, or evaluations.
- A participant list, human mentions, access requests, or collaboration notifications.
- Group management.
- Per-resource use/view/edit roles.
- A custom-role editor.
- Project-specific membership management.
- Guest or public access.
- Ownership and offboarding management for resources.

### Existing strengths to preserve

Agenta should not copy the competitors' consumer-chat model across every resource. Several current
capabilities fit collaborative LLM engineering better than a personal-agent model:

- Project-wide traces and evaluations make production debugging and quality work visible to the
  team.
- The Annotator role gives a focused evaluation and trace-review path.
- Agents, prompts, workflows, evaluators, testsets, and environments use versioned configuration
  snapshots with author, timestamp, lineage, and commit messages. Configuration payloads are
  append-only; metadata and lifecycle state can still change.
- Trace and evaluation annotations already support attributed notes, even though they are not
  threaded comments.
- The permission vocabulary is granular enough to support richer roles once scope and resource
  grants are added.

References:

- `api/oss/src/dbs/postgres/git/dbas.py:18-70`
- `api/oss/src/apis/fastapi/workflows/router.py:213-451`
- `api/oss/src/core/annotations/service.py:433-455`
- `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceSidePanel/TraceAnnotations/index.tsx:79-122,236-266`

### Model and enforcement risks

These issues should be resolved before adding more sharing paths:

1. Project create, update, and delete routes do not consistently enforce role permissions. The
   corresponding UI also exposes these actions without role gating.
2. Member removal requires the exact Admin role instead of a capability permission, limiting
   future custom roles.
3. EE Organization security endpoints generally validate membership while the UI presents them as
   owner-only.
4. Workspace terminology and the implemented hierarchy are not clear in customer documentation.
   The current guide documents `Organization -> Project` while the model includes Workspace.
5. The default Viewer role includes `view_secret`, `view_billing`, and `run_service`. This conflicts
   with the customer-facing description of Viewer as read-only. Vault reads return decrypted secret
   data rather than a metadata-only response.

References:

- `api/oss/src/routers/projects_router.py:198-331`
- `web/oss/src/components/pages/settings/Projects/index.tsx:68-124,195-266`
- `api/oss/src/routers/workspace_router.py:221-248`
- `api/ee/src/apis/fastapi/organizations/router.py:42-48,86-116,168-188,256-279`
- `docs/docs/administration/access-control/01-organizations.mdx:9-20`
- `api/oss/src/core/access/permissions/types.py:178-204`
- `api/oss/src/apis/fastapi/vault/router.py:124-181`
- `api/oss/src/core/secrets/dtos.py:256-279`

## Kano analysis

### Interpretation

- **Must-be:** Absence causes distrust or blocks company adoption. Presence is expected rather than
  differentiating.
- **Performance:** More coverage or control produces proportionally more satisfaction.
- **Attractive:** Unexpected capability that can differentiate the product. Its absence does not
  normally block adoption.
- **Indifferent for now:** Low influence on the buying or daily-use decision for this product
  category.
- **Reverse risk:** A capability or default that can reduce satisfaction for part of the market.

### Must-be features

| Feature expectation | Competitive signal | Agenta model | Agenta UI | Position |
| --- | --- | --- | --- | --- |
| Company container and member invitations | All three | Implemented | Implemented | At parity |
| Predictable roles and server-side enforcement | All three | Granular defaults, but known enforcement and Viewer-secret inconsistencies | Role selection is clear but action gating is uneven | Partial |
| Clear visibility contract | Competitors separate personal and shared work | Workspace membership implies Project access; not surfaced as a visibility choice | No visibility indicator | Behind |
| A personal/private conversation option | Explicit in Competitor A and Competitor C; strongly implied in Competitor B | Absent | Absent | Provisional Must-be for general agent-chat adoption; validate for LLMOps |
| Explicit sharing and revocation | All three support deliberate sharing | Absent | Absent | Provisional Must-be gap |
| Agent/workflow sharing separate from chat history | All three separate these concepts | Agent and sessions share one Project boundary | No separate controls | Behind |
| Safe offboarding and ownership continuity | Strong in Competitor B; partial/unclear elsewhere | Organization ownership exists; resource ownership does not | No resource reassignment UI | Behind |
| Stable shared team context | Pods, Projects, and Teams with selectable membership | Project-wide resources, but audience is inherited from Workspace | Strong Project navigation and shared lists | Partial |
| Enterprise identity controls | SSO and SCIM are common | SSO/domain support; no customer-facing SCIM found | EE SSO/domain UI | Partial |
| Auditability | Enterprise capability across competitors | EE project events | Filterable UI, no export | Partial |

The leading Must-be hypothesis is the absence of an explicit personal-versus-shared audience. A
Project organizes resources but does not provide the selectable membership boundary of a Competitor A Pod,
Competitor B Project, or Competitor C Team. A user cannot do private work, share one conversation, or
understand who can read it without reasoning about inherited Workspace membership and a broad role.
Customer research must validate whether this blocks adoption in Agenta's LLMOps segment.

### Performance features

| Feature | Why satisfaction scales | Agenta position |
| --- | --- | --- |
| Direct sharing with users and groups | Supports least privilege without creating another Project | Missing |
| Separate use, view, edit, and manage grants | Lets companies expose an Agent without exposing its prompt, tools, or credentials | Global role permissions exist, but no per-resource grants or Use Only mode |
| Groups and identity-provider mapping | Reduces administration as companies grow | Missing |
| Shared-context controls | Open/restricted Pods, Projects, and Teams let users choose collaboration scope | Project exists; no restricted subspace or personal space |
| Conversation collaboration | Competitor A supports joining, replying, and mentions | Missing participant and mention model |
| Ownership transfer and orphan handling | Prevents resources becoming unmaintainable after offboarding | Missing for resources |
| Admin-managed sharing and public-sharing policy | Gives security teams a policy layer over user sharing | Missing |
| Retention and content-access policy | Companies need to know whether Admins can read chats and how long content remains | No collaboration-specific policy or UI found |
| Audit export and SIEM streaming | Needed for security operations at scale | UI exists, export is disabled |
| Bulk and automatic provisioning | Manual invites do not scale | Single-user invite; no customer-facing SCIM flow found |
| Discoverability and access requests | Helps users find team Agents without over-sharing them | Missing |

Agenta's strongest Performance feature is versioned engineering collaboration. Immutable revisions,
lineage, attribution, and commit messages are more appropriate for prompts and evaluators than a
generic last-write-wins editor. This should remain a first-class collaboration mechanism.

### Attractive features

| Feature | Competitive example | Agenta opportunity |
| --- | --- | --- |
| Team memory from shared conversations | Competitor A automatically indexes Pod Conversations for Agents | Let a Project or explicit shared space opt selected sessions into reusable Agent context |
| Human mentions that grant access safely | Competitor A confirms access before adding a mentioned colleague | Add a participant through mention without weakening the whole Project |
| Use Only Agent access | Competitor C hides instructions, tools, files, and internals | Map invocation access separately from workflow/config visibility |
| Admin-reviewed Agent publishing | Competitor B Governance can approve, flag, or disable Agents | Build on Agenta revisions and environments with approval policy |
| Incognito sessions | Competitor C does not persist Incognito chats | Useful for sensitive one-off work if retention semantics are explicit |
| Access requests with in-product approval | Competitor C Inbox and Slack approval | Useful after restricted Agents and groups exist |
| Shareable output surfaces independent of internals | Competitor C Interfaces and artifacts | Publish an invocation UI or result without exposing Agent configuration or Project access |

These features should follow, not precede, the visibility and grant model. Otherwise each one adds a
new special-case authorization path.

### Indifferent for now

| Feature | Rationale |
| --- | --- |
| Live cursors and simultaneous co-editing | None of the three competitors clearly documents this. Agenta's revision model is a better current fit for prompt and evaluator work. |
| Generic comments on every resource | Attributed annotations and commit messages cover higher-value domain workflows. Threaded comments can wait for a demonstrated workflow. |
| Social reactions, profiles, and team feeds | No evidence that these drive selection of the compared platforms. |
| Nested team hierarchies | None of the reviewed documentation makes this a baseline capability. Groups and restricted spaces solve the nearer problem. |

### Reverse risks

| Default or feature | Risk |
| --- | --- |
| Every Project member can read every interactive session | Users may put sensitive personal or exploratory content into what looks like a personal chat surface. |
| Organization Admins can read all chats without an explicit policy | Competitor C documents this, but Competitor A explicitly does not. Buyers will have different legal and cultural requirements. The policy must be explicit and configurable rather than accidental. |
| Team resources default to edit access | Competitor C's conflicting documentation illustrates the danger. Shared should not silently mean editable. |
| Public links before policy controls | Public sharing can block enterprise adoption if Admins cannot disable it, audit it, or set expiration. |
| One role controlling unrelated resource instances | Least privilege becomes impossible and teams create extra Projects as a workaround. |
| Copying private-chat semantics to traces and evaluations | This would weaken Agenta's existing team debugging and evaluation model. Operational evidence should remain Project-shared by default. |

## Recommended product direction

### 1. Define visibility by resource intent

Offer two explicit starting contexts. Validate which context each UI entry point should default to:

| Resource class | Default |
| --- | --- |
| Session started from a personal entry point | Private to the creator |
| Session started inside an explicitly shared context | Shared with that context |
| Triggered or operational sessions | Project-visible |
| Operational traces, evaluation runs/results, testsets, environments | Project-visible |
| Traces derived from a personal session | Inherit the session audience or redact session content |
| Agent, prompt, workflow, evaluator drafts | Project-visible initially; add restricted access when resource grants ship |

The UI should always show the effective audience, such as **Only you**, **3 people**, or
**Project members**.

### 2. Add one access model, not per-feature sharing flags

A shared access contract should cover Sessions, Agents, Workflows, and later other resources:

- **General access:** Restricted, Project, and eventually Public link.
- **Principals:** User and Group.
- **Resource roles:** Use, View, Edit, Manage.
- **Ownership:** One accountable owner with transfer and offboarding behavior.
- **Policy:** Whether public sharing, external users, or Admin content access is allowed.

Workspace or Organization membership should establish tenant eligibility. The resource grant should
then determine instance-level Use, View, Edit, or Manage access. Project general access can grant a
default resource role to all Project members. Today's broad Project roles cannot remain a hard
ceiling because that would require Project-wide Editor access before one Agent could receive an
Editor grant. Organization policy should remain able to deny sensitive actions such as deployment,
credential management, public sharing, or ownership transfer.

Use access also needs an execution contract. It must define whose credential executes each tool,
whose downstream data permissions apply, who pays for usage, and what configuration or source
metadata the user can inspect. Competitor A, Competitor B, and Competitor C make different choices here.

### 3. Ship the personal-to-team session loop

The minimum coherent session collaboration flow is:

1. A session started from a personal entry point is **Only you**. A session started in a shared
   context displays and inherits that audience.
2. Share with named Project members or switch to **Project members**.
3. A named recipient can view according to the grant. Join is enabled only after the execution
   identity, credential, downstream authorization, and cost contract is enforced.
4. Participants can see the audience and leave the session.
5. The owner can revoke access.
6. Restricted Agent/config access is checked before a recipient joins.
7. Admin content access and retention behavior are explicit.

A read-only link alone would improve demos but would not close the collaboration gap. Competitor A's joinable
Conversation demonstrates the stronger team workflow.

### 4. Add groups and resource roles

Groups should be Workspace-scoped and usable in both Project membership and resource grants. Start
with manual groups, then add SCIM synchronization. For Agents, separate:

- **Use:** invoke without seeing configuration.
- **View:** inspect configuration and history.
- **Edit:** change and commit revisions.
- **Manage:** sharing, ownership, archive, and policy-sensitive actions.

This addresses the most important capability represented by both Competitor B and Competitor C without
discarding Agenta's existing six Project roles.

For **Use**, define execution identity, credential selection, source authorization, and cost
attribution as part of the same contract. Do not expose an invocation role before these decisions
are enforced server-side.

### 5. Complete governance with the core model

Each ACL-bearing phase must include owner-departure behavior, grant cleanup, and a minimum
reassignment path. Add share-event audit records and Admin policy controls with the first grants.
Audit export and advanced reassignment UI can follow. Public links, external guests, and published
interfaces should come only after these controls exist.

### 6. Defer low-signal collaboration features

Do not prioritize live co-editing, generic comments, reactions, or activity feeds before explicit
session audiences, sharing, groups, and object roles. The compared products do not establish live
co-editing as a Must-be feature, and Agenta already has a stronger revision-oriented mechanism for
engineering artifacts.

## Suggested sequence

| Phase | Outcome | Kano impact |
| --- | --- | --- |
| 0. Authorization consistency | Fix Project mutation checks, capability-based member removal, Organization security enforcement, and the Viewer secret/service decision; document the real hierarchy | Must-be foundation |
| 1. Session audiences | Personal and shared contexts, effective-audience API, audience-aware queries, and UI labels; validate entry-point defaults | Closes the visibility Must-be gap |
| 2. Session sharing | Named view grants, Project-wide mode, revoke, participant list, owner-departure behavior, grant audit events, and initial Admin sharing policy; add join only with execution controls | Completes the read-sharing loop |
| 3. Resource grants | Shared user/group/role model for Agents and Workflows; ownership lifecycle; execution-identity and credential contract for Use access | Improves Performance features |
| 4. Groups and provisioning | Manual groups, SCIM mapping, bulk onboarding, and automated grant cleanup | Enterprise Performance |
| 5. Governance | Advanced sharing policy, audit export/SIEM, retention, and Admin-content policy | Enterprise Must-be/Performance |
| 6. Differentiators | Shared-session memory, mentions, approvals, access requests, and publishable interfaces | Attractive |

## How to validate the Kano hypothesis

Survey at least three personas separately: daily Agent users, Agent/workflow builders, and IT or
security administrators. For each feature, ask the standard paired questions:

1. **Functional:** How would you feel if this feature were present?
2. **Dysfunctional:** How would you feel if this feature were absent?

Use the standard answers: *I like it*, *I expect it*, *I am neutral*, *I can tolerate it*, and
*I dislike it*.

Test these concepts first:

- Human-started sessions are private by default.
- A session can be shared with people, a group, or the Project.
- A recipient can join and continue the same session.
- An Agent can be used without exposing its instructions and tools.
- Groups can receive access to Agents and Projects.
- Admins can or cannot read private sessions, according to company policy.
- Shared Project conversations can become reusable Agent context.
- Admins can review, flag, or disable an Agent; separately test whether changes should require
  approval before deployment.

Segment the results by regulated versus non-regulated companies and by LLMOps versus general
knowledge-work use. Those segments are likely to classify Admin access, public links, retention,
and private-by-default behavior differently.

## Documentation gaps encountered

- Competitor A's current and legacy role pages disagree because the Builder-to-Manager migration is still
  reflected inconsistently. Its conversation API also retains two access modes while the current
  guide states private by default.
- Competitor B does not explicitly define the default visibility of an ordinary unshared chat or
  whether an Admin can inspect it. Its Folder pages conflict on Admin access.
- Competitor C's docs conflict on whether Team members receive Viewer or Editor by default. They do not
  define run-link authorization or forced ownership transfer during offboarding.
- None of the three clearly documents real-time multi-user editing of Agents or Workflows.
- Detailed Trust Center controls for all three were inaccessible through the available page tools.

# A — Multi-org OSS + access controls: assessment

Status: ASSESSMENT (no edits applied).

Goal: OSS supports multiple organizations, and the four access env vars
(`AGENTA_ACCESS_ALLOWED_DOMAINS`, `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS`,
`AGENTA_ACCESS_BLOCKED_DOMAINS`, `AGENTA_ACCESS_BLOCKED_EMAILS`) work in OSS the same
way they work in EE.

## Current state

The env vars are already **parsed** in shared code (`AccessConfig`,
`api/oss/src/utils/env.py:85`), so OSS reads them — it just never enforces them.
Enforcement is gated behind `is_ee()` in exactly two places:

| Var | Enforced where | OSS gate |
| --- | --- | --- |
| allowed/blocked domains, blocked emails | `is_auth_info_blocked()` — `api/oss/src/core/auth/helper.py:136` | early-returns `False` when `not is_ee()` |
| allowed owner emails | `can_create_organization()` — `api/ee/src/services/commoners.py:50` | lives in EE; OSS has no org-creation path at all |

Single-org is enforced in OSS through six mechanisms:

1. **No membership tables.** `OrganizationMemberDB` / `WorkspaceMemberDB` /
   `ProjectMemberDB` exist only in `api/ee/src/models/db_models.py`.
   `get_user_organizations()` (`api/oss/src/services/db_manager.py:906`) joins the
   membership table in EE and returns `[]` in OSS. OSS user↔org linkage is implicit
   (the one org, plus `owner_id`).
2. **Singleton bootstrap.** First signup creates the org via
   `INSERT … ON CONFLICT (slug) DO NOTHING` against the deterministic slug
   `oss-default` (`OSS_SINGLETON_ORG_SLUG`, `api/oss/src/services/db_manager.py:361`,
   used in `create_organization` at :676 and in the signup override
   `api/oss/src/core/auth/supertokens/overrides.py:206`).
3. **Singleton reads.** `get_oss_organization()` returns `organizations[0]`
   (`db_manager.py:353`); `get_default_workspace_id_oss()` filters by the singleton
   slug (`db_manager.py:618`).
4. **Invite-only second user.** Non-first signups must hold an invitation to the
   singleton org (`overrides.py:240`, `check_if_user_invitation_exists`).
5. **Admin API block.** `OssMultiOrgNotSupportedError` rejects any explicit
   org/workspace/project/membership in admin account creation
   (`api/oss/src/core/accounts/service.py:1058`).
6. **No org-creation endpoint.** `POST /organizations/` exists only in
   `api/ee/src/routers/organization_router.py:380`.

EE-only behaviors that hang off multi-org but should **stay EE**: subscriptions/trials
on org creation, verified domains + auto-join, per-org auth policies
(`enforce_domain_policies` and `check_organization_access` in
`api/oss/src/core/auth/service.py` already early-return in OSS).

## Changes needed

### 1. Move membership tables OSS-ward — for belonging, not authz (prerequisite, overlaps goal B)

**What:** Move `OrganizationMemberDB`, `WorkspaceMemberDB`, `ProjectMemberDB` from
`api/ee/src/models/db_models.py` into the OSS models, plus an OSS core migration
creating the three tables. EE keeps importing them (re-export from the old path
during transition).

**Why:** Multi-org needs a persistent answer to "which orgs does user X belong to."
Today OSS derives belonging implicitly: `organizations.owner_id` plus used,
project-scoped `InvitationDB` rows — derivable only because there is exactly one
org. With N orgs that breaks (invitations are project-scoped, deletable, and not a
membership record). This is also the single biggest OSS/EE schema divergence, so
doing it first directly serves goal B (OSS schema ⊂ EE schema).

**Scope — no RBAC in OSS:** the tables are belonging records, `(user_id, scope_id,
role)` with a plain role slug; none of the RBAC machinery lives in the schema. The
permissions service (`api/ee/src/core/access/permissions/*`) stays EE. OSS writes
only `RequiredRole` slugs (`owner`/`admin`/`viewer`) and keeps its current coarse
authorization checks; the `role` column exists for schema parity and so an OSS→EE
upgrade needs zero data transformation.

**How:** New OSS migration creates the tables; a data migration backfills membership
rows for existing OSS deployments (owner → `owner`; every user with a used invitation
→ member of the `oss-default` org/workspace/project, role carried over from the
invitation's `role` column). Flip the OSS branch of `get_user_organizations()`
(`db_manager.py:934`) to the same membership join EE uses — the `is_ee()` fork there
disappears entirely.

### 2. OSS org-creation path

**What:** Un-singleton `create_organization()` and expose `POST /organizations/` in OSS.

**Why:** There is no way to mint a second org in OSS today (mechanisms 2, 5, 6).

**How:**

- `db_manager.create_organization()`: drop the `not is_ee()` ON CONFLICT branch;
  generate unique slugs (keep `oss-default` as the legacy slug of the bootstrap org,
  no special meaning afterwards).
- Move the org-creation orchestration (`create_organization_for_user`,
  `can_create_organization` from `api/ee/src/services/commoners.py`) into OSS shared
  code; EE wraps it to add subscription/trial setup. This follows the established
  pattern: EE is additive over OSS.
- Mount the create endpoint in the OSS organization router (mirror
  `api/ee/src/routers/organization_router.py:380`, minus billing).
- Lift the admin-API block (`accounts/service.py:1058`) to accept explicit
  org/workspace/project/memberships like EE does.

### 3. Signup flow

**What:** Replace the OSS first-user-bootstrap + invite-only flow in
`overrides.py:206-250` with the EE-shaped flow: on signup, create a personal org if
`can_create_organization(email)` allows it; otherwise the user signs in org-less or
via invitation.

**Why:** The current flow hard-codes "one org, everyone else is invited into it."

**How:** Converge on EE's `create_accounts`/commoners flow
(`api/ee/src/services/commoners.py:181-206` is the template). The
`is_first_user_signup()` special case disappears; the invitation path stays for
joining someone else's org.

### 4. Enforce the access vars in OSS

**What/How:**

- Domains/blocked emails: delete the `if not is_ee(): return False` early-exit in
  `is_auth_info_blocked()` (`helper.py:136`). That's the whole change — parsing,
  normalization, and the subdomain matcher are already shared. (Note the PostHog
  fallback for blocklists also activates for OSS deployments with PostHog enabled.)
- `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS`: comes for free once `can_create_organization`
  moves to OSS (change 2) and is called from both signup (change 3) and the create
  endpoint.

**Why this is safe to share verbatim:** semantics should be identical in both editions
per goal B's "where OSS and EE overlap, everything is 100% identical."

### 5. Sweep remaining singleton assumptions

**What:** Audit and fix callers of `get_oss_organization()`,
`get_default_workspace_id_oss()`, and any `organizations[0]` pattern; they must resolve
org/workspace through the requesting user's memberships instead.

**Why:** After change 1 these helpers are wrong the moment a second org exists.

**How:** Grep-driven; most call sites are in `db_manager.py`, the auth service, and
the accounts service. Frontend: the org switcher and any `is_ee()`-gated multi-org UI
in `web/` need the OSS gate relaxed — separate, smaller workstream.

## File-level inventory

### API — files/code moved EE → OSS

| What | From | To / notes |
| --- | --- | --- |
| `OrganizationMemberDB`, `WorkspaceMemberDB`, `ProjectMemberDB` | `api/ee/src/models/db_models.py:12,45,82` | `api/oss/src/models/db_models.py`, next to `OrganizationDB`/`WorkspaceDB`/`ProjectDB`. `role` is a plain string defaulting to `viewer`; the only EE-flavored column is `project_members.is_demo` (nullable boolean, cloud demo projects) — it moves with the class, harmless in OSS. EE file re-exports from the OSS path during transition. |
| `can_create_organization()` | `api/ee/src/services/commoners.py:50` | OSS shared code (e.g. a new `api/oss/src/services/commoners.py`). Pure env-var check, zero EE dependencies. |
| Core of `create_organization_for_signup()` / `create_organization_for_user()` | `api/ee/src/services/commoners.py:266,327` | OSS; EE keeps thin wrappers that add subscription/trial setup and entitlement checks on top of the moved core. |
| `create_organization()` (org + owner membership + default workspace + default project + memberships) | `api/ee/src/services/db_manager_ee.py:1060` | Becomes the OSS create path, replacing the ON CONFLICT singleton branch in `api/oss/src/services/db_manager.py:640`. |
| Membership writers `add_user_to_organization` / `add_user_to_workspace` / `add_user_to_project`, and `add_user_to_workspace_and_org` (invitation accept path) | `api/ee/src/services/db_manager_ee.py:1739,1767,1803,824` | OSS `db_manager` (or the new commoners module). |
| `POST /organizations/` endpoint | `api/ee/src/routers/organization_router.py:384` | Mirrored into `api/oss/src/routers/organization_router.py` (file exists; today only `GET /`, `GET /{id}`, and the invite endpoints), minus entitlement/RBAC checks — `RequiredRole` only. |

Scope note on the router: the EE router also has `update_organization` (:157),
`create_workspace` (:236), `transfer_organization_ownership` (:325), and
`delete_organization` (:433). The web sidebar exposes rename/delete/transfer to org
owners, so OSS needs at least update + delete + transfer mirrored too (same
pattern: strip entitlements/RBAC, keep owner checks).

### API — files modified in OSS

`api/oss/src/services/db_manager.py` (the singleton core):

- `get_user_organizations()` :906 — OSS branch flips from `return []` to the same
  membership join EE uses; the `is_ee()` fork disappears.
- `create_organization()` :640 — drop the ON CONFLICT singleton branch; unique slugs.
- Deleted or rewritten: `is_first_user_signup()` :342, `get_oss_organization()` :353,
  `OSS_SINGLETON_ORG_SLUG` :361, `get_or_bootstrap_oss_organization()` :364,
  `setup_oss_organization_for_first_user()` :388, `_assign_user_to_organization_oss()`
  :547, `get_default_workspace_id_oss()` :595.
- `create_accounts()` :507 — converge OSS branch on the commoners flow.

Elsewhere:

- `api/oss/src/core/auth/supertokens/overrides.py:172-272` — `_create_account()`:
  replace first-user bootstrap + invite-only check with per-user org creation
  (change 3).
- `api/oss/src/core/auth/helper.py:136` — delete the `is_ee()` early-exit (change 4).
- `api/oss/src/core/accounts/service.py:1058`, `errors.py:111`,
  `apis/fastapi/accounts/router.py:80` — lift the multi-org block; delete
  `OssMultiOrgNotSupportedError` and its handler.
- `api/oss/src/middlewares/auth.py` — caller of `get_default_workspace_id_oss()`;
  resolve workspace through the requesting user's memberships.
- `api/oss/src/routers/organization_router.py` — `list_organizations()` :60 drops its
  `is_ee()` fork; `fetch_organization_details()` :110 reads memberships; mount
  create/update/delete/transfer.
- Migrations: new core migration in
  `api/oss/databases/postgres/migrations/core/versions/` creating the three tables,
  plus a backfill in `.../core/data_migrations/` (owner + used-invitation users →
  membership rows). The OSS and EE chains are independent (each edition's runner
  migrates only its own chain), so this is a plain CREATE in the OSS chain; the EE
  chain already has its own equivalents
  (`e14e8689cd03_created_project_members_table…`, `1c2d3e4f5a6b_workspaces_migration…`).
- `api/oss/src/utils/env.py` — **no change**. `AccessConfig` already parses all four
  vars; `allowed_owner_emails` (:101) also accepts the legacy aliases
  `AGENTA_ACCESS_ORG_CREATION_ALLOWLIST` and `AGENTA_ORG_CREATION_ALLOWLIST` (:104-105).

### Schema delta — verified against live DB dumps

`diff_core.txt` / `diff_tracing.txt` (in this folder) diff schema dumps of the OSS vs
EE databases and confirm the plan above:

- **Tracing DB: zero delta.** Only the database name differs — nothing in tracing is
  touched by this work.
- **Membership tables match the model move exactly.** EE has `organization_members`
  (`role` NOT NULL default `'viewer'`), `workspace_members`, `project_members`
  (includes nullable `is_demo`); all three carry `updated_by_id`. The new OSS
  migration must reproduce these shapes verbatim (PKs on `id`, user/scope FKs with
  CASCADE on the scope side) so an OSS→EE upgrade sees identical tables.
- **The rest of the diff splits into three buckets**, all handled by the
  [schema parity plan](#schema-parity-plan-two-steps) below:
  - EE-only tables that stay EE (additive, allowed by goal B): `meters`
    (+ `meters_type` enum), `subscriptions` (billing), `organization_domains`
    (domain verification), `organization_providers` (org-level SSO).
  - Legacy nullable `organization_id`/`workspace_id` columns + FKs on ~13 EE tables
    (`app_db`, `app_variants`, `bases`, `deployments`, `docker_images`,
    `environments`, `environments_revisions`, `testsets`, the evaluation tables) that
    OSS never had — pre-`project_id` leftovers. No column fixes here: these tables
    are dead and get dropped outright (parity step 2).
  - **Reverse drift** (violates strict OSS ⊂ EE at the constraint level): OSS has
    constraints EE lacks — `api_keys.created_by_id`/`project_id` are nullable in OSS
    but NOT NULL in EE, and the FK/unique sets on `api_keys` and `projects` differ
    (`api_keys_created_by_id_fkey`, duplicate `fk_projects_organization_id`,
    `uq_projects_id`, FK naming). Fixed in parity step 1.

### API — files modified in EE

- `api/ee/src/models/db_models.py` — delete the three membership classes; re-export
  from the OSS path so existing EE imports keep working.
- `api/ee/src/services/commoners.py` — `create_organization_for_signup` /
  `create_organization_for_user` slim down to subscription/entitlement wrappers over
  the moved OSS core; `can_create_organization` becomes an import.
- `api/ee/src/services/db_manager_ee.py` — delete the moved functions; import
  membership models from OSS.
- `api/ee/src/routers/organization_router.py` — import the create path from its new
  OSS location (:46 today); keeps its RBAC/entitlement gates unchanged.

### Web — no moves, gate relaxation only

The multi-org UI already lives in `web/oss` and is shared by both editions: org
switcher, create-org modal, org state atoms (`web/oss/src/state/org/`), invitation
flows, and the organization API client (`web/oss/services/organization/api/`). EE-ness
is runtime gating via `isEE()` (`web/oss/src/lib/helpers/isEE.ts`, reads
`NEXT_PUBLIC_AGENTA_LICENSE`). So nothing moves; a handful of gates relax:

- `web/oss/src/components/Sidebar/components/ListOfOrgs.tsx` — the whole OSS surface:
  `organizationSelectionEnabled = isEE()` default (:70) → enabled; "New Organization"
  menu item gated on `isEE()` (:233); owner submenu (rename/delete/transfer) gated on
  `isEE()` (:189); label hard-codes "Agenta" instead of "Organization" in OSS (:101).
- Stays gated: the Organization settings tab (`canShowOrganization = isEE()` in
  `web/oss/src/components/Sidebar/SettingsSidebar.tsx:44` and
  `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx:62`) — its
  content is domain verification + org-level SSO, which remain EE features.
- No change needed: org state/selectors, `WorkspaceManage.tsx` + `InviteUsersModal.tsx`
  (their RBAC role column/selector is separately `isEE()`-gated and stays so),
  `useWorkspacePermissions` (`canInviteMembers` is already permissive in OSS).

## Schema parity plan (two steps)

Goal-B follow-through on the dumps above: after both steps, the OSS core schema is
**identical** to the EE core schema minus exactly four EE-only tables (`meters` +
`meters_type` enum, `subscriptions`, `organization_domains`,
`organization_providers`); the membership tables become shared (change 1); tracing
is already identical. The OSS and EE alembic chains are independent — each edition's
runner migrates only its own chain — so every fix below is a plain migration in the
chain whose DB carries the drift; nothing needs cross-chain guards.

The canonical shape for shared tables is the live SQLAlchemy model
(`api/oss/src/models/db_models.py`), which both editions load; today each DB
violates it differently.

### Step 1 — drift fixes on kept tables

OSS core chain (one migration):

- `api_keys.project_id` — SET NOT NULL (model declares it; EE already has it).
  Backfill or delete rows with NULL `project_id` first (pre-project-scoping keys).
- `projects` — drop the duplicate org FK `fk_projects_organization_id`
  (ON DELETE SET NULL); keep `projects_organization_id_fkey` (CASCADE — matches EE
  and the model). Rename `fk_projects_workspace_id` → `projects_workspace_id_fkey`
  (same definition as EE's; name-only change). Drop `uq_projects_id`
  (UNIQUE on `id`, redundant with the primary key) and its index.
- Membership tables — created identical to EE, **including
  `project_members.is_demo`** (nullable boolean; kept in OSS for parity even though
  only cloud demo projects set it). Covered by change 1; listed here because it is
  part of the parity outcome.

EE core chain (one migration):

- `api_keys.created_by_id` — DROP NOT NULL, and add the missing
  `api_keys_created_by_id_fkey` FK → `users(id)` ON DELETE SET NULL (model shape;
  OSS already has both). NULL out references to deleted users before validating
  (or add the FK NOT VALID, clean, then VALIDATE).

Both chains, same migration content (model alignment, not OSS/EE drift — both DBs
are equal here but diverge from the model):

- `projects.organization_id` / `projects.workspace_id` — SET NOT NULL, and align the
  workspace FK to ON DELETE CASCADE; the model declares NOT NULL + CASCADE, both DBs
  have nullable + SET NULL. Backfill NULL scopes first (OSS: the singleton
  org/workspace; EE: resolve via the project's members). Alternatively relax the
  model — but NOT NULL is the shape multi-org wants, so fix the DBs.

Accepted cosmetic divergence (no action): `api_keys` physical column order differs
between the two DBs; Postgres cannot reorder columns without a table rewrite, and
nothing reads positionally.

### Step 2 — drop legacy tables

The legacy app-centric ecosystem is dead code: the old routers are already deleted
(`api/oss/src/routers/` holds only account routers — api_key, organization,
projects, user_profile, workspace), and the legacy model classes are referenced only
by the `models/db/models.py` re-export shim and `models/converters.py`. The extra
`organization_id`/`workspace_id` columns, `deployments.cloud_map_service_id`, and
`auto_evaluator_configs.app_id` that EE carries all sit on these tables — the drop
is their parity fix.

Tables to drop (20, identical migration in each chain, `DROP TABLE IF EXISTS …
CASCADE`, children before parents):

| Group | Tables |
| --- | --- |
| Apps/variants | `app_db`, `app_variants`, `app_variant_revisions`, `bases` |
| Deploy/infra | `deployments`, `docker_images`, `templates` |
| Old environments | `environments`, `environments_revisions` |
| Old testsets | `testsets` (superseded by `testset_artifacts`/`_revisions`/`_variants`) |
| Old auto-eval | `auto_evaluations`, `auto_evaluation_scenarios`, `auto_evaluation_aggregated_results`, `auto_evaluation_scenario_results`, `auto_evaluation_evaluator_configs`, `auto_evaluator_configs` |
| Old human-eval | `human_evaluations`, `human_evaluations_scenarios`, `human_evaluation_variants` |
| Misc | `ids_mapping` (Mongo→Postgres migration artifact) |

Pre-drop verification: the old→new data migrations (testsets → testset artifacts,
old evaluations → `evaluation_runs`/`evaluation_scenarios`) ran earlier in each
chain; EE cloud should archive the tables before the drop lands.

Code cleanup in the same PR:

- Delete the dead classes from `api/oss/src/models/db_models.py`: `AppDB`,
  `DeploymentDB`, `VariantBaseDB`, `AppVariantDB`, `AppVariantRevisionsDB`,
  `AppEnvironmentDB`, `AppEnvironmentRevisionDB`, `TestsetDB`, `EvaluatorConfigDB`,
  `IDsMappingDB`, `EvaluationDB`, `EvaluationScenarioDB`,
  `EvaluationAggregatedResultDB`, `EvaluationScenarioResultDB`,
  `EvaluationEvaluatorConfigDB`.
- Trim the `models/db/models.py` re-export shim (drops `AppDB`, `EvaluationDB`,
  `DeploymentDB`, `EvaluationScenarioDB` from both edition branches) and the dead
  converter functions in `models/converters.py`.
- Leave `deprecated_models.py` / `deprecated_transfer_models.py` scaffolding that
  historical data migrations import — deleting it breaks replaying old chains.

## Documentation impact

Hand-written docs only (`docs/docs/**`); generated API reference and Fern clients
excluded.

Pages to edit:

| Page | Change |
| --- | --- |
| `docs/docs/self-host/guides/06-restrict-organization-creation.mdx` | Biggest rewrite. Documents the legacy `AGENTA_ORG_CREATION_ALLOWLIST` name; rewrite around the canonical `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS` (legacy aliases still parsed), and state it now applies to OSS too. Natural home for "managing organizations in self-hosted" content (open signup vs. allowlist, inviting users). |
| `docs/docs/self-host/03-upgrading.mdx` | Pre-upgrade callout for the Decision-1 posture flip: OSS goes invite-only → open signup; operators must set `AGENTA_ACCESS_*` before upgrading to keep a closed instance. |
| `docs/docs/self-host/02-configuration.mdx` | Already lists all four `AGENTA_ACCESS_*` vars (:48 area); mark them as applying to OSS and EE, link the restriction guide. |
| `docs/docs/self-host/01-quick-start.mdx` | First-signup wording: first user no longer "claims the instance"; note open signup + how to restrict. |
| `docs/docs/self-host/04-dynamic-access-controls.mdx` | Clarify split: plans/roles/throttles are EE-only; the four access env vars now work in both editions. |
| `docs/docs/misc/01-opensource.mdx` | Feature-comparison table: add multiple organizations as available in OSS; RBAC / SSO / domain verification stay EE-only. |
| `docs/docs/administration/access-control/01-organizations.mdx` | Currently cloud-framed with no OSS mention; add a note that multi-org now applies to self-hosted OSS, with RBAC/domain-verification still plan-gated. |
| `docs/docs/administration/access-control/02-sso.mdx`, `03-rbac.mdx`, `04-domain-verification.mdx` | Verify only — these features stay Business/Enterprise; wording likely needs no change. |

Checked and unaffected: `self-host/guides/01-05` (deploy remotely, SSL, Kubernetes,
Railway, SSO config — SSO stays EE), `self-host/infrastructure/*`, `self-host/99-faq.mdx`,
`administration/security/*`, `concepts/`, `getting-started/`,
`administration/access-control/05-platform-administration-api.mdx` (already written
multi-org-shaped; the OSS block it would have hit is being removed).

No new page strictly required: the rewritten guide 06 covers org management +
access-control patterns for self-hosters; add a separate how-to only if it outgrows
that page.

## Decisions (resolved)

1. **Adopt EE semantics.** Allowlist unset ⇒ anyone who signs up gets their own org;
   identical behavior in both editions. Consequence: existing OSS deployments flip
   from invite-only to open signup on upgrade — call this out loudly in the release
   notes so operators set `AGENTA_ACCESS_ALLOWED_DOMAINS`/`ALLOWED_OWNER_EMAILS`
   (or the block lists) before upgrading. No OSS-only fallback posture.
2. **OSS gets no billing, no entitlements, no permissions** beyond the trivial
   built-in role checks (`RequiredRole`: owner/admin/viewer). Subscriptions, trials,
   entitlement gating, and the permissions service stay EE-only; OSS org creation is
   the bare core path and EE wraps it with billing setup. Implementation note: verify
   no shared code path assumes "org ⇒ subscription row" when running in OSS (the
   entitlement checks already no-op there).

## Sequencing

1. Membership tables + backfill (change 1) + drift fixes on kept tables (parity
   step 1) — schema work, do together with goal B.
2. Shared org-creation core + signup flow (changes 2, 3).
3. Access-var enforcement (change 4) — tiny; the domain/email part is shippable
   independently even before multi-org.
4. Singleton-assumption sweep + frontend (change 5).
5. Drop legacy tables (parity step 2) — independent of multi-org; shippable any
   time after the pre-drop archive/verification, one migration per chain.

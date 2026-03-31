# SQL Checks for RBAC Cleanup

This file collects PostgreSQL queries you can run in pgAdmin to inspect current data before and after the RBAC cleanup.

Relevant tables in this repo:

- `organization_members`
- `workspace_members`
- `project_members`
- `project_invitations`
- `api_keys`
- `subscriptions`
- `organizations`
- `workspaces`
- `projects`
- `users`

Important note about entitlements:

- plan data is stored in `subscriptions.plan`
- runtime entitlements such as RBAC are derived in code from the plan, not from a dedicated database table
- use plan-crossed queries here as a proxy for entitlement analysis, then verify runtime behavior separately

## 1. Basic role counts by table

```sql
select 'workspace_members' as table_name, role, count(*) as row_count
from workspace_members
group by role

union all

select 'project_members' as table_name, role, count(*) as row_count
from project_members
group by role

union all

select 'project_invitations' as table_name, role, count(*) as row_count
from project_invitations
group by role

order by table_name, role;
```

## 2. Distinct role values that currently exist

```sql
select 'workspace_members' as table_name, role
from workspace_members
group by role

union

select 'project_members' as table_name, role
from project_members
group by role

union

select 'project_invitations' as table_name, role
from project_invitations
group by role

order by table_name, role;
```

## 3. Old-role counts that must be migrated

```sql
select table_name, role, row_count
from (
    select 'workspace_members' as table_name, role, count(*) as row_count
    from workspace_members
    group by role

    union all

    select 'project_members' as table_name, role, count(*) as row_count
    from project_members
    group by role

    union all

    select 'project_invitations' as table_name, role, count(*) as row_count
    from project_invitations
    group by role
) x
where role in ('viewer', 'editor', 'workspace_admin', 'deployment_manager', 'analyst', 'evaluator', 'auditor')
order by table_name, role;
```

## 4. New-role counts after migration

```sql
select table_name, role, row_count
from (
    select 'workspace_members' as table_name, role, count(*) as row_count
    from workspace_members
    group by role

    union all

    select 'project_members' as table_name, role, count(*) as row_count
    from project_members
    group by role

    union all

    select 'project_invitations' as table_name, role, count(*) as row_count
    from project_invitations
    group by role
) x
where role in ('owner', 'admin', 'manager', 'developer', 'annotator', 'viewer')
order by table_name, role;
```

## 5. Organizations, workspaces, and projects with role counts

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    w.id as workspace_id,
    w.name as workspace_name,
    pm.project_id,
    p.project_name,
    pm.role,
    count(*) as member_count
from project_members pm
join projects p on p.id = pm.project_id
join workspaces w on w.id = p.workspace_id
join organizations o on o.id = p.organization_id
group by
    o.id, o.name,
    w.id, w.name,
    pm.project_id, p.project_name,
    pm.role
order by organization_name, workspace_name, project_name, pm.role;
```

## 6. Workspace-member role counts by workspace

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    w.id as workspace_id,
    w.name as workspace_name,
    wm.role,
    count(*) as member_count
from workspace_members wm
join workspaces w on w.id = wm.workspace_id
join organizations o on o.id = w.organization_id
group by
    o.id, o.name,
    w.id, w.name,
    wm.role
order by organization_name, workspace_name, wm.role;
```

## 7. Invitation role counts by project

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    w.id as workspace_id,
    w.name as workspace_name,
    p.id as project_id,
    p.project_name,
    pi.role,
    count(*) as invitation_count
from project_invitations pi
join projects p on p.id = pi.project_id
join workspaces w on w.id = p.workspace_id
join organizations o on o.id = p.organization_id
group by
    o.id, o.name,
    w.id, w.name,
    p.id, p.project_name,
    pi.role
order by organization_name, workspace_name, project_name, pi.role;
```

## 8. Workspace/project role mismatches for the same user

This checks the mirrored-membership assumption.

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    w.id as workspace_id,
    w.name as workspace_name,
    p.id as project_id,
    p.project_name,
    u.id as user_id,
    u.email,
    wm.role as workspace_role,
    pm.role as project_role
from workspace_members wm
join workspaces w on w.id = wm.workspace_id
join organizations o on o.id = w.organization_id
join projects p on p.workspace_id = w.id
join project_members pm
    on pm.project_id = p.id
   and pm.user_id = wm.user_id
join users u on u.id = wm.user_id
where coalesce(wm.role, '') <> coalesce(pm.role, '')
order by organization_name, workspace_name, project_name, email;
```

## 9. Users missing mirrored project memberships

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    w.id as workspace_id,
    w.name as workspace_name,
    p.id as project_id,
    p.project_name,
    u.id as user_id,
    u.email,
    wm.role as workspace_role
from workspace_members wm
join workspaces w on w.id = wm.workspace_id
join organizations o on o.id = w.organization_id
join projects p on p.workspace_id = w.id
join users u on u.id = wm.user_id
left join project_members pm
    on pm.project_id = p.id
   and pm.user_id = wm.user_id
where pm.id is null
order by organization_name, workspace_name, project_name, email;
```

## 10. Subscription plan counts by organization

```sql
select
    s.plan,
    s.active,
    count(*) as organization_count
from subscriptions s
group by s.plan, s.active
order by s.plan, s.active desc;
```

## 11. Organizations with plan attached

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    s.plan,
    s.active,
    s.customer_id,
    s.subscription_id
from organizations o
left join subscriptions s on s.organization_id = o.id
order by o.name;
```

## 12. Role counts crossed by subscription plan

Project memberships are the best place to cross current effective role data with organization plan.

```sql
select
    coalesce(s.plan, 'no_subscription') as plan,
    coalesce(pm.role, 'no_role') as role,
    count(*) as row_count
from project_members pm
join projects p on p.id = pm.project_id
left join subscriptions s on s.organization_id = p.organization_id
group by coalesce(s.plan, 'no_subscription'), coalesce(pm.role, 'no_role')
order by plan, role;
```

## 13. Workspace role counts crossed by subscription plan

```sql
select
    coalesce(s.plan, 'no_subscription') as plan,
    coalesce(wm.role, 'no_role') as role,
    count(*) as row_count
from workspace_members wm
join workspaces w on w.id = wm.workspace_id
left join subscriptions s on s.organization_id = w.organization_id
group by coalesce(s.plan, 'no_subscription'), coalesce(wm.role, 'no_role')
order by plan, role;
```

## 14. API key counts by current project role

This shows how many keys are currently owned by users in each project role.

```sql
select
    pm.role,
    count(*) as api_key_count
from api_keys ak
join project_members pm
    on pm.project_id = ak.project_id
   and pm.user_id = ak.created_by_id
group by pm.role
order by pm.role;
```

## 15. API keys that should be deleted by the migration

These are the keys owned by users whose role maps to post-migration disallowed roles `developer`, `annotator`, or `viewer`.

```sql
select
    ak.id as api_key_id,
    ak.prefix,
    ak.project_id,
    p.project_name,
    o.id as organization_id,
    o.name as organization_name,
    u.id as user_id,
    u.email,
    pm.role as current_project_role,
    s.plan,
    s.active,
    ak.created_at
from api_keys ak
join projects p on p.id = ak.project_id
join organizations o on o.id = p.organization_id
left join subscriptions s on s.organization_id = o.id
left join users u on u.id = ak.created_by_id
left join project_members pm
    on pm.project_id = ak.project_id
   and pm.user_id = ak.created_by_id
where pm.role in ('viewer', 'analyst', 'evaluator', 'auditor', 'developer', 'annotator')
order by organization_name, project_name, email, ak.created_at;
```

## 16. API keys by plan and role

Useful when you want to understand how many keys are attached to roles that will lose access, grouped by subscription plan.

```sql
select
    coalesce(s.plan, 'no_subscription') as plan,
    coalesce(pm.role, 'no_role') as role,
    count(*) as api_key_count
from api_keys ak
join projects p on p.id = ak.project_id
left join subscriptions s on s.organization_id = p.organization_id
left join project_members pm
    on pm.project_id = ak.project_id
   and pm.user_id = ak.created_by_id
group by coalesce(s.plan, 'no_subscription'), coalesce(pm.role, 'no_role')
order by plan, role;
```

## 17. Organizations with RBAC-relevant plan proxy

This is only a plan-level proxy. Runtime RBAC enablement is derived from entitlements in code.

```sql
select
    o.id as organization_id,
    o.name as organization_name,
    s.plan,
    s.active,
    case
        when s.plan is null then 'unknown_from_db'
        when s.plan = 'cloud_v0_business' then 'likely_rbac_capable'
        when s.plan = 'self_hosted_enterprise' then 'likely_rbac_capable'
        else 'check_code_entitlements'
    end as rbac_proxy
from organizations o
left join subscriptions s on s.organization_id = o.id
order by o.name;
```

## 18. Post-migration validation: only canonical roles remain

```sql
select table_name, role, row_count
from (
    select 'workspace_members' as table_name, role, count(*) as row_count
    from workspace_members
    group by role

    union all

    select 'project_members' as table_name, role, count(*) as row_count
    from project_members
    group by role

    union all

    select 'project_invitations' as table_name, role, count(*) as row_count
    from project_invitations
    group by role
) x
where role not in ('owner', 'admin', 'manager', 'developer', 'annotator', 'viewer')
order by table_name, role;
```

## 19. Post-migration validation: no API keys owned by disallowed roles

```sql
select
    pm.role,
    count(*) as api_key_count
from api_keys ak
join project_members pm
    on pm.project_id = ak.project_id
   and pm.user_id = ak.created_by_id
where pm.role in ('developer', 'annotator', 'viewer')
group by pm.role
order by pm.role;
```

## 20. Quick spot-check by email

Replace the email value when investigating one user.

```sql
select
    u.email,
    o.name as organization_name,
    w.name as workspace_name,
    p.project_name,
    wm.role as workspace_role,
    pm.role as project_role,
    s.plan,
    s.active,
    count(ak.id) as api_key_count
from users u
left join workspace_members wm on wm.user_id = u.id
left join workspaces w on w.id = wm.workspace_id
left join project_members pm on pm.user_id = u.id
left join projects p on p.id = pm.project_id
left join organizations o on o.id = coalesce(p.organization_id, w.organization_id)
left join subscriptions s on s.organization_id = o.id
left join api_keys ak
    on ak.created_by_id = u.id
   and ak.project_id = p.id
where u.email = 'replace-me@example.com'
group by
    u.email,
    o.name,
    w.name,
    p.project_name,
    wm.role,
    pm.role,
    s.plan,
    s.active
order by organization_name, workspace_name, project_name;
```


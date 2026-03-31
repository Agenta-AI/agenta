# Organization Migration Specification

## DEPRECATED: Personal Organizations Removed

> **Important:** This document describes a migration that introduced personal organizations. **Personal organizations have been removed from the system.** All organizations are now collaborative by default.

---

## Current Behavior (Post-Removal)

### What Changed

The `is_personal` flag has been completely removed from the codebase:

- **Backend:** Removed from all models, services, routers, and migrations
- **Frontend:** Removed `isPersonalOrg` helper, priority logic, and UI elements
- **Database:** Migration sets `is_personal = false` on any existing orgs (for cleanup)

### Current Organization Model

All organizations are now **collaborative**:

| Aspect | Behavior |
|--------|----------|
| Members | One or more members allowed |
| Invitations | Always allowed |
| Security settings | Always accessible |
| Auto-created on signup | Yes, with username as org name |

### Signup Flow

1. User signs up with any auth method
2. System auto-creates a collaborative organization
3. Organization name = username (from email)
4. User can immediately invite teammates

### No Personal Organization Concept

- No `is_personal` flag in `organizations.flags`
- No personal org priority in workspace selection
- No "personal" tag in UI
- No restrictions on invitations for any org type

---

## Historical Context

The personal organization concept was introduced to provide users with a private sandbox. However, it created friction:

- Users couldn't invite teammates to their first org
- Users ended up with two orgs (personal + team) which was confusing
- Different behavior from main/prod

The decision was made to remove personal organizations entirely and match the simpler main/prod behavior where all organizations are collaborative from the start.

---

## Migration for Existing Data

If any existing organizations have `is_personal = true` in their flags:

```sql
UPDATE organizations
SET flags = flags - 'is_personal'
WHERE flags->>'is_personal' = 'true';
```

Or alternatively, set to false:

```sql
UPDATE organizations
SET flags = jsonb_set(flags, '{is_personal}', 'false')
WHERE flags->>'is_personal' = 'true';
```

This is handled automatically by the `a9f3e8b7c5d1_clean_up_organizations.py` migration.

---

## Related Changes

### Files Modified

**Backend:**
- `api/oss/src/models/shared_models.py` - Removed `is_personal` from `OrganizationFlags`
- `api/ee/src/models/api/organization_models.py` - Removed `is_personal` from `CreateOrganization`
- `api/ee/src/services/commoners.py` - Removed personal org creation logic
- `api/ee/src/services/db_manager_ee.py` - Removed `is_personal` handling

**Frontend:**
- `web/oss/src/state/org/selectors/org.ts` - Removed `isPersonalOrg` function and priority logic
- `web/oss/src/components/Sidebar/components/ListOfOrgs.tsx` - Removed personal tag
- `web/oss/src/components/pages/settings/WorkspaceManage/WorkspaceManage.tsx` - Removed personal org empty state

### Workspace Selection Logic

Previously:
1. Prioritize personal org
2. Fall back to last-used workspace
3. Fall back to first owned org

Now:
1. Use last-used workspace if valid
2. Fall back to first owned non-demo org
3. Fall back to first non-demo org

---

## Summary

- Personal organizations have been **removed**
- All organizations are **collaborative** by default
- Users can **invite teammates immediately** after signup
- No special handling or UI for personal vs collaborative orgs
- Simpler, more intuitive user experience

---

End of document.

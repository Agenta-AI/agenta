# Organization Migration Specification

## Introducing Personal and Collaborative Organizations

This document is a **complete and authoritative migration specification** for introducing **personal** and **collaborative** organizations via the `is_personal` flag in `organizations.flags`.

---

## 1. Scope of This Migration

This migration introduces:
- A new organization classification: `personal` vs `collaborative`
- The `is_personal` flag in `organizations.flags` JSONB
- Deterministic rules to migrate all existing data

This migration **does not** introduce:
- Multiple owners per organization
- RBAC changes
- Invitation logic changes
- Domain verification
- SSO
- Policy enforcement

---

## 2. Definitions

### 2.1 Organization Classification

Each organization is classified via `flags.is_personal`:

| Type | `is_personal` | Description |
|------|---------------|-------------|
| Personal | `true` | Single-user sandbox |
| Collaborative | `false` | Multi-user, governance-capable |

---

### 2.2 Personal Organization

A **personal organization** represents an individual user.

**Invariants**
- Exactly **one member**
- That member is the **owner**
- No invitations allowed
- Cannot be deleted
- Cannot change ownership
- Security settings hidden in UI

**Canonical flags**
```json
{
  "is_personal": true
}
```

There must be **exactly one personal organization per user** (EE only).

---

### 2.3 Collaborative Organization

A **collaborative organization** represents shared ownership and collaboration.

**Invariants**
- One or more members
- Exactly **one owner**
- Invitations allowed
- Full governance capabilities

**Canonical flags**
```json
{
  "is_personal": false
}
```

---

## 3. Pre-Migration Guarantees

The system currently guarantees:

- Every organization has **exactly one owner**
- No self-deleted users exist
- Every user exists in the database intentionally
- Users may belong to zero, one, or multiple organizations
- Users may own exactly one organization

These guarantees are relied upon.

---

## 4. Schema

The `is_personal` flag is stored in the `organizations.flags` JSONB column:

```sql
-- organizations.flags contains:
{
  "is_personal": true/false,
  "is_demo": false,
  "allow_email": true,
  "allow_social": true,
  "allow_sso": false,
  "allow_root": false,
  "domains_only": false,
  "auto_join": false
}
```

---

## 5. Data Migration — Enterprise / Commercial Edition (EE)

EE supports **multiple organizations per deployment** and **personal organizations**.

### 5.1 Step 1 — Classify Existing Organizations

For each organization:

- If `member_count > 1`
  → Set `flags.is_personal = false`

- If `member_count == 1`
  → Mark as **personal-candidate**

Ownership remains unchanged.

---

### 5.2 Step 2 — Resolve Personal Organizations per User

For each user:

#### Case A — User owns a single-member organization
- That organization becomes their **personal organization**
- Set `flags.is_personal = true`

#### Case B — User owns an organization that is now collaborative
- That organization remains collaborative
- User may now have **no personal organization**

#### Case C — User has no organizations at all
- This is treated as missing data
- A new personal organization **must be created**

---

### 5.3 Step 3 — Create Missing Personal Organizations

For any user **without** a personal organization after Step 2:

- Create a new organization
- Assign user as owner
- Assign user as sole member
- Set flags:

```json
{
  "is_personal": true,
  "is_demo": false,
  "allow_email": true,
  "allow_social": true,
  "allow_sso": false,
  "allow_root": false,
  "domains_only": false,
  "auto_join": false
}
```

This guarantees:
> Exactly one personal organization per user.

---

### 5.4 Step 4 — Normalize Collaborative Organizations

For **all** organizations with `flags.is_personal = false`:

- Preserve existing name
- Preserve members and owner
- Ensure all required flags exist with defaults

---

## 6. Ownership Rules (Explicit)

- Every organization has **exactly one owner**
- This migration does **not** introduce multiple owners
- Ownership transfer is expected to be handled later via a dedicated endpoint

---

## 7. Data Migration — OSS Edition

OSS has **strict constraints**.

### 7.1 Allowed State

- Exactly **one organization** exists

### 7.2 Migration Logic

#### Case A — Exactly one organization exists
- Migration proceeds
- That organization becomes collaborative:

```json
{
  "is_personal": false
}
```

- **No personal organizations are created**
- OSS explicitly does **not** support personal organizations

#### Case B — More than one organization exists
- Migration **must fail**
- No partial migration
- Deployment must be corrected manually

This fail-fast behavior is intentional.

---

## 8. Post-Migration Guarantees

### EE

- Every user has **exactly one personal organization**
- Users may belong to zero or more collaborative organizations
- All organizations have a valid `is_personal` flag
- No ambiguity exists

### OSS

- Exactly one organization exists
- That organization is collaborative (`is_personal = false`)
- No personal organizations exist

---

## 9. UI Behavior

When `is_personal = true`:
- Security settings section is hidden
- Verified Domains tab is hidden
- SSO Providers tab is hidden
- Access Controls section is hidden
- Invitations are disabled

---

## 10. Operational Notes

- Migration may be run online or offline (deployment decision)
- Logic must be **deterministic**
- Any violation of OSS invariants must abort the migration
- EE migration must never drop or merge organizations

---

## 11. Summary

After migration:

- Organization classification is explicit via `flags.is_personal`
- Personal organizations are canonical and enforced (EE only)
- Collaborative organizations are preserved
- Ownership remains single-user
- Future features can safely build on this model

---

End of document.

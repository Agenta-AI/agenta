# Organization Flags Reference

This document defines the canonical default values for all organization flags in the system.

## Flag Definitions

### Identity Flags
- **`is_demo`**: `false` - Marks the organization as a demo organization
- **`is_personal`**: `false` - Marks the organization as a personal organization (single-user)

### Authentication Method Flags
- **`allow_email`**: `true` - Allow email/password or email/OTP authentication
- **`allow_social`**: `true` - Allow social authentication (Google, GitHub, etc.)
- **`allow_sso`**: `true` - Allow SSO/OIDC authentication

### Access Control Flags
- **`allow_root`**: `true` - Allow organization owner to bypass authentication restrictions
- **`domains_only`**: `false` - Restrict access to verified email domains only
- **`auto_join`**: `false` - Allow users with verified email domains to automatically join the organization (when `true`)

## Default Behavior

### When flags is `null` or missing
All flags default to their specified default values above.

### When flags is partially populated
- Flags explicitly set to `null` use the default value
- Flags with non-null values use those values
- Missing flags use the default value

### Example
```json
{
  "flags": {
    "is_demo": true,
    "is_personal": false
    // All other flags default as specified above
  }
}
```
This would result in:
- `is_demo`: `true` (explicit)
- `is_personal`: `false` (explicit)
- `allow_email`: `true` (default)
- `allow_social`: `true` (default)
- `allow_sso`: `true` (default)
- `allow_root`: `true` (default)
- `domains_only`: `false` (default)
- `auto_join`: `false` (default)

## Implementation Notes

### Backend
- Auth service uses `.get(key, default_value)` pattern for all flags
- See: `api/oss/src/core/auth/service.py`

### Frontend
- UI components use `?? default_value` pattern for all flags
- See: `web/oss/src/components/pages/settings/Organization/index.tsx`

### Safety Mechanisms
- If all authentication methods are disabled (`allow_email`, `allow_social`, `allow_sso` all `false`), the system automatically enables `allow_root` to prevent complete lockout
- A confirmation dialog warns users when attempting to disable all auth methods

## Related Files

### Backend
- `api/ee/src/models/api/organization_models.py` - API models
- `api/oss/src/core/auth/service.py` - Authentication service with flag logic
- `api/ee/src/services/db_manager_ee.py` - Organization update logic with validation
- `api/ee/src/routers/organization_router.py` - Organization API endpoints

### Frontend
- `web/oss/src/components/pages/settings/Organization/index.tsx` - Organization settings UI
- `web/oss/src/services/organization/api/index.ts` - API client functions
- `web/oss/src/lib/Types.ts` - TypeScript type definitions

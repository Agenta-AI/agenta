## Why

Invite emails open the old app. `api/oss/src/services/organization_service.py:139-145` builds `<web_url>/auth?token=...`, `isTokenBearingAuthLink` keeps that link on the old sign-in, and the person accepts on the old `/workspaces/accept` page. `/m` is the main app, and it drops every invite value except `email` during sign-in.

## What Changes

- The API builds the invite link with `/m/auth`.
- The `/m` sign-in keeps the invite in browser storage through password, one-time code, social and SSO sign-in.
- `/m` gets an accept screen at `/m/invite`, with the outcomes of the old page.
- The person lands in the invited project.
- A new invited person answers the onboarding questions only, then opens the invited project.
- The desktop gate forwards an old invite link to `/m/auth` with its query. Password reset links stay where they are.
- The mobile gate does not send an invite away from `/m` for a Classic mode user.
- `/m` Members settings shows the invite link when the deployment has no email service.

## Capabilities

### New Capabilities

- `mobile-invites`: joining an organization from an emailed invite link in `/m`.

### Modified Capabilities

None. No existing spec covers invites.

## Impact

- `api/oss/src/services/organization_service.py`: link path only. No API contract change.
- `web/packages/agenta-shared/src/utils/mobileGate/index.ts` and its tests.
- `web/mobile/src/features/invite/` (new), `web/mobile/src/pages/invite/index.tsx` (new), `SignInScreen.tsx`, `ContextResolver.tsx`, `features/onboarding/*`.
- `docs/design/onboarding-revamp/questions-and-survey-parity.md`: the old form no longer sends `survey sent` for invites.
- No change to `web/oss` or `web/ee`, which are abandoned.

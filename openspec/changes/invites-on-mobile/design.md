## Context

All references are to `release/v0.127.3`. The full evidence is in the research note kept with the run.

Today, an invited person takes this path:

1. The email link is `<web_url>/auth?token&email&organization_id&workspace_id&project_id` (`organization_service.py:139-145`). The invite lasts 7 days (`:202`).
2. `isDesktopOnlyLink` holds the link on the old app for every kind of user (`mobileGate/index.ts:343`).
3. The old sign-in sends a new person to `/workspaces/accept?survey=true` and an existing person to `/workspaces/accept` (`web/oss/src/hooks/usePostAuthRedirect.ts:129-157`).
4. The old accept page posts to the accept endpoint through `acceptWorkspaceInvite` (`web/packages/agenta-entities/src/organization/workspaceApi.ts:122-154`). On the cloud edition a new person then sees the `/post-signup` form, which sends `survey sent` (`web/ee/src/components/PostSignupForm/PostSignupForm.tsx:245`).

On `/m` today:

- `useSignInFlow` offers an `onInvite` callback for exactly this purpose (`web/packages/agenta-auth-ui/src/useSignInFlow.ts:157-163`), and `SignInScreen.tsx:49-56` does not pass it.
- `useAuthSuccess` always goes to `/`, and a signed-in visit to `/auth` also goes to `/` (`features/app/authRoute.ts:19-27`).
- `/` is `ContextResolver`, which forwards to a project home. It shows "No projects found." when the person has no project (`ContextResolver.tsx:98-103`).
- A new account gets a pending onboarding mark. Home dismisses the mark when the project has agents, and otherwise starts the full flow (`onboardingPending.ts:70-82`).
- The website `?template=` value already survives sign-in through localStorage with a 30 minute window (`lib/context.ts:29-70`).

Password reset links are `<web_url>/auth/reset-password?token=...&tenantId=public` (`api/oss/src/core/auth/supertokens/config.py:70-73`). They carry `token` and never `organization_id`. `/m` has no reset screen.

## Goals / Non-Goals

Goals:

- A new person and an existing person both join through `/m` from the emailed link, with every sign-in method.
- A signed-in person with a different email sees the old page's mismatch message and can switch account.
- An invite link already in an inbox keeps working.

Non-goals:

- Showing the invite link in `/m` Members settings when email is off (`MembersTab.tsx:90-93`). It is a separate follow-up.
- Removing the old `/workspaces/accept` page. Nothing emails that URL (`organization_service.py` is the only link producer).
- Fixing the API text and check order listed as side bugs in the research note.

## Decisions

### Where the accept screen lives

| Option | Trade-off |
| --- | --- |
| **`/m/invite`** | Outside `/auth`, so `authRedirectTarget` leaves a signed-in person there. |
| `/m/auth/accept` | `isAuthRoute` would send a signed-in person to `/`, and `authRoute.ts` would need an exception. |
| `/m/workspaces/accept` | Same path as the old page, but workspaces are being removed. |

### How the invite survives sign-in

| Option | Trade-off |
| --- | --- |
| **localStorage with a 30 minute window, written through `onInvite`** | The same shape as `?template=`. It survives a provider redirect. The token is removed on every final outcome. |
| Carry the values in the OAuth state | It needs changes to the SuperTokens call and does nothing for password sign-in. |
| A cookie | Sent to the server on every request, which a one-time token does not need. |

A person who takes longer than 30 minutes opens the link again, because the link lasts 7 days.

### Who sends the person to the accept screen

| Option | Trade-off |
| --- | --- |
| **`ContextResolver`, before it resolves a project** | All sign-in paths and the signed-in visit end at `/`, so there is one reader. It also covers a person with no project yet. |
| `useAuthSuccess` plus `OidcCallbackScreen` plus `authRoute` | Three places to keep in step. |

### What the desktop gate tests

| Option | Trade-off |
| --- | --- |
| **An invite link is an `/auth` link with both `token` and `organization_id`** | Reset links have no `organization_id`, so they keep today's route. |
| Any `/auth?token=` | It would move reset links to `/m`, which has no reset screen. |

The forward runs before the opt-out and Classic mode checks, and it keeps the query. `decideMobileGate` lets `/invite` and an invite link on `/auth` pass, because `desktopRouteFor` would drop the token.

### Onboarding for a new invited person (Mahmoud chose questions only)

| Option | Trade-off |
| --- | --- |
| **Questions only, then the invited project** | Keeps today's survey event. Needs a small path in onboarding. |
| No questions | The least work. PostHog loses these answers. |
| Leave `/m` as it is | No work. A viewer in an empty project gets steps written for an owner. |

The accept screen adds an invited mark next to the pending mark and opens onboarding directly, so Home does not change. The onboarding host then shows only the question steps, sends the same events, ends onboarding after the last question, and opens the project home. It also skips seeding tool connections, because that belongs to setting up a new organization.

### Wording

Every string comes from the old page, so nothing is invented. `/m` cannot import `web/oss`, so the strings are copied into `features/invite/`.

## Risks / Trade-offs

- A token sits in localStorage for up to 30 minutes. The old app also stores it there, with no window.
- A shared browser: a second person who signs in within the window reaches the accept screen, and the API answers with the mismatch code. They see the error card, and "Go back to your workspaces" clears the invite.
- A Helm install with the old web app turned off has no page for an old `/auth` link (`hosting/kubernetes/helm/tests/test_web_mobile.py:157`). The API change fixes new links, and old links expire within 7 days.
- A Classic mode person who reloads `/m/` while the invite is pending goes to the old app. The next visit to the link finishes it.

## Migration

No data migration. Deploy order does not matter, because the old app forwards old links and the old app still exists for anything already in progress. Rollback restores the old link path, and any `/m/auth` invite link sent in the meantime still signs in, but it does not accept until the person opens a new invite.

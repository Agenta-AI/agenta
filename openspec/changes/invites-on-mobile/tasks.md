## 1. API

- [ ] 1.1 Build the link with `/m/auth` in `send_invitation_email`, with a unit test on the URL.

## 2. Gates (can run in parallel with 1)

- [ ] 2.1 Add `isInviteLink` in `mobileGate/index.ts`, and exclude it from `isTokenBearingAuthLink`.
- [ ] 2.2 Forward invite links in `decideDesktopGate` before the opt-out and Classic mode checks, keeping the query.
- [ ] 2.3 Pass invite links and `/invite` in `decideMobileGate`.
- [ ] 2.4 Extend `mobileGate.test.ts` and `proxy.test.ts`, including the password reset link.

## 3. Sign-in to accept screen

- [ ] 3.1 Add `features/invite/pendingInvite.ts` (remember, read, forget, with a 30 minute window) and unit tests.
- [ ] 3.2 Pass `onInvite` in `SignInScreen.tsx`.
- [ ] 3.3 Send `ContextResolver` to `/invite` when an invite is kept, before the "No projects found." state, with a test.

## 4. Accept screen

- [ ] 4.1 Add `pages/invite/index.tsx` and `features/invite/InviteAcceptScreen.tsx`, with the card in `states/`.
- [ ] 4.2 Add a pure outcome mapper for the API error codes and strings, with unit tests.
- [ ] 4.3 Refresh organizations and projects, write the last context, and open the project.
- [ ] 4.4 Keep the invite on "Sign in with a different account", and clear it on "Go back to your workspaces".

## 5. Onboarding for invited people

- [ ] 5.1 Add the invited mark in `onboardingPending.ts`, and have the accept screen set it for a pending account.
- [ ] 5.2 Show only question steps in `OnboardingFlowHost`, finish after the last one, and skip seeding tool connections.
- [ ] 5.3 Add unit tests, including `survey sent` for the invited path.

## 6. Docs and QA

- [ ] 6.1 Update `docs/design/onboarding-revamp/questions-and-survey-parity.md`.
- [ ] 6.2 Run live QA on the local stack: a new user and an existing user join through `/m`, a mismatch, an old link, a reset link.

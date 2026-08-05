# Self-serve account deletion

Planning workspace for letting users delete their own Agenta account from Settings,
without asking support to do it for them.

## Why this exists

Users regularly ask us on chat to delete their accounts. Today an admin has to run the
deletion by hand. We want a self-serve button in Settings that removes the account
cleanly across every system that holds the user's data: our database, SuperTokens,
Stripe, and Loops.

## The short version

A logged-in user opens Settings, confirms by typing their email, and clicks delete. The
backend cancels their Stripe subscription, deletes their SuperTokens login, hard-deletes
their user and the organizations they solely own, and removes them from Loops. The
frontend then signs them out. Scope for v1 is cloud and self-hosted EE. OSS singleton
instances do not get the button.

## Files in this folder

| File | What it holds |
| --- | --- |
| [context.md](context.md) | Why the work exists, goals, non-goals, the demand behind it |
| [research.md](research.md) | What the codebase already has, with exact file paths and line numbers |
| [plan.md](plan.md) | The proposed design and the phased implementation plan |
| [decisions.md](decisions.md) | Open design decisions with a recommendation for each |
| [status.md](status.md) | Source of truth for current progress and next steps |

## Start here

Read [context.md](context.md) for the goal, then [decisions.md](decisions.md) for the
choices that need sign-off, then [plan.md](plan.md) for how to build it. [research.md](research.md)
is the reference for every existing function we reuse.

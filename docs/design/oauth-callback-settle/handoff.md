# Handoff: make the OAuth callback settle on failure, not just success

**Read [`plan.md`](./plan.md) in this folder first, in full.** It has the root cause, the call-site
table, the exact line numbers, and two wrong theories that were already chased down and killed. Do
not re-derive the diagnosis.

This file is the how. That file is the why.

## One-paragraph context

`_oauth_card()` renders the popup page the provider redirects to after an OAuth grant. Its
`agenta_url` parameter is what enables the page to post `tools:oauth:complete` back to the opener,
show a "Return to Agenta" button, and auto-close. Five of six call sites — every failure path —
never pass it. So a failed authorization leaves a dead popup and an opener that never settles, and
the in-chat flow eventually reports the wrong reason (`"cancelled"`) to the agent.

## Before you touch anything

1. **Work on a branch that contains PR #5915** (the QueryClient host fix), or you cannot trust any
   result on `/m`. Package-layer invalidations there hit an orphan client without it, so a perfectly
   correct callback will still look broken. Check with:
   ```bash
   grep -q getHostQueryClient web/packages/agenta-entity-ui/src/gatewayTool/hooks/useReconnectToolConnection.ts \
     && echo "fix present" || echo "MISSING — rebase onto #5915 first"
   ```
2. **Reproduce the bug before fixing it.** Bring up the EE dev stack (`hosting/AGENTS.md`), open
   Settings → Tools, start a connect flow, and click **Deny** on the provider consent screen. You
   should see an error card with no buttons that never closes, and a row that never settles. If you
   cannot reproduce this, stop and find out why before writing code — the premise is wrong.

## The work

Three work packages, in `plan.md` under "Work plan". WP1 is the fix; WP2 and WP3 make the failure
legible instead of merely settled. WP1 is independently shippable and worth landing on its own if
WP2/WP3 grow.

Two decisions already taken, so you do not have to relitigate them:

- **Default `agenta_url` inside `_oauth_card()`** rather than threading it through six call sites.
  Five of six authors already forgot it; a parameter that exists only to be passed everywhere is a
  parameter that will be forgotten again. Argue for the explicit version only if the default is
  genuinely wrong for some caller.
- **A payload with no `success` key must keep meaning "completed, re-read the server."** Older
  frontends will run against a newer API. Do not make the key required.

## Verifying it

A green test suite proves very little here — the failure path has no coverage today, and the bug is
in a hand-written HTML template driven by a Python default. Drive it.

- **Failure path**: deny consent. The card should now close itself, and the opener should settle
  with the row updated and no page reload.
- **Success path is the regression risk.** It is the only path exercised today, so re-run a real
  successful connect and a real reconnect and confirm neither changed.
- **In-chat flow** (`useConnectFlow`): after WP3, a denied grant must report a failure with the
  provider's message, and only an actually-closed window should report `"cancelled"`. Those two
  cases must stay distinguishable.

Prove "settled without a reload" the way the query-client sweep did — stamp the page before the
mutation and assert the stamp survived:

```js
window.__mark = "x"          // before
window.__mark                // after the UI settles; if it survived, no reload happened
```

A screenshot cannot show the absence of a reload. The stamp can.

## Gotchas that will cost you an hour each

- **Turbopack caches package barrels.** After editing anything under `web/packages/**`, a recompile
  is not enough — the dev container keeps serving the old module graph and reports errors that the
  source no longer has. `docker restart agenta-ee-dev-web-mobile-1` and wait for `Ready in`.
- **Backend changes need the API container restarted**, and `_oauth_card` output is only visible in
  the popup — read it with "View Source" on the popup, not the main window.
- **Grep `api/` and `services/`, not just `web/`.** The one wrong turn already made in this
  investigation was concluding "nothing sends this message" from a frontend-only grep.
- **Check for `-report-only` before blaming a COOP header.** The second wrong turn.
- **This repo may be in GitButler workspace mode, and lanes get rebased under you.** Before any
  push, re-verify the branch still contains only your files:
  `git diff --name-only <base>..<branch>`. A stack rebase mid-session silently rewrote every SHA
  during the query-client work and made an untouched file appear as a reversal.

## Landing it

- Branch off the same base the related work uses, and set the PR base to match — a wrong base turns
  the diff into the whole stack.
- API changes: run `ruff format` then `ruff check --fix` in `api/`. Frontend: `pnpm lint-fix` in
  `web/`. Both must be clean.
- Title `fix(api): ...` or `fix(frontend): ...` per the area you touched; if you have an issue id,
  prefix it. The `write-pr-description` skill has the format.
- Say plainly in the PR which paths were driven live and which were only reasoned about. The
  failure path is the point of the change, so if you did not deny a real consent screen, say so.

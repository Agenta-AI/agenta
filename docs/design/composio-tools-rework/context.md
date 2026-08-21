# Context

## What this is about

Agenta lets a user give an agent real-world tools, like sending a Slack message or
reading a GitHub issue. We run those tools through Composio, an outside service that
stores each user's app logins and makes the calls for us. This document explains what
hurts today and what we want instead.

## How it works today

The user picks actions one at a time in the drawer. Each pick adds one entry to the
agent's setup, for example "Composio, GitHub, GET_AN_ISSUE, github-main". Our backend
(the Agenta API, not the runner) does the next part. At the start of every run, before
the model produces a word, it asks Composio to look up every action, one call each, with
no reuse. Then it sends every action's full description to the model, on every turn.

## The problems this causes

- **One broken tool kills the whole agent.** If one action can no longer be looked up,
  the whole agent fails to start, and the error names no tool. (#5173)
- **The lookup and the run disagree.** Our lookup and our run step use different versions
  of the app's action list. So the lookup can offer an action that the run step then
  cannot find, and the user gets a "not found" error. (#5174)
- **One huge result breaks the chat.** A tool result can reach the model with almost no
  limit. One GitHub call once returned about 241,000 tokens and broke the session. (#5341)
- **A missing key looks like a broken feature.** If Composio is not set up, the user gets
  a bare "not found" error that gives no hint about the real cause. (#5407)
- **A single app means about a hundred entries.** GitHub has around a hundred actions. So
  the agent's setup swells to a hundred entries, and the model sees a hundred
  descriptions every turn. That is slow, costly, and makes the model pick worse.

These are not five separate bugs. They come from one choice: we treat each action as a
fixed tool that we look up one by one.

The first four bugs are now fixed and shipped, as small separate changes to the current
system: the result cap (#5341, PR #5811), the clear "not set up" error (#5407, PR #5812),
the broken-tool fix (#5173, PR #5813), and the version pin (#5174, PR #5814). Those fixes
patch today's system. The redesign below removes the root cause, so the last problem (a
hundred entries) also goes away.

## What we want instead

The setup names the app and the connection once, plus which actions are allowed. When the
agent runs, our backend gives the model two small tools: a search tool and a run tool.
The model searches for the action it needs, then runs it, in the same turn. The heavy
one-by-one lookup goes away. The design doc explains this in full.

## Goals

- Name an app once, not one entry per action.
- Remove the all-or-nothing failure and the version mismatch by design.
- Stop huge results from flooding the model.
- Keep our safety controls: permissions, tracing, and a size cap stay on our side.
- Keep the Composio key on our servers, never in the sandbox where the model runs.
- Keep fast agent restarts working (do not throw away a warm sandbox for no reason).

## Not in the first version

- Making Pi use this over MCP. Pi loads tools its own way today; we do not change that now.
- Limiting how fast we call Composio per customer.
- Asking the user before one specific action (only asking before any action is in scope).
- Tracking cost per call.
- A second tool provider besides Composio. The design leaves room for one, but we prove
  Composio first.

## A fact that shaped the design

The Composio key is powerful. It can reach every workspace's connections, not just one.
We tested this against the live key. There is no weaker key that does only what we need.
So the key must stay on our servers and never enter the sandbox. Our design keeps it
there.

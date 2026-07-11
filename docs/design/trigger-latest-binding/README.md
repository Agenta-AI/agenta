# Trigger "Latest" binding

A trigger is a schedule (cron) or a subscription (a provider event). When it fires, it
runs a workflow. This project lets a user bind a trigger to "the latest revision of a
variant" from the UI, and makes the UI display that binding honestly.

The surprise: the backend already supports Latest. Almost all the work is frontend.

## How the trigger endpoints behave today

You create a trigger with `POST /api/triggers/schedules/` or
`POST /api/triggers/subscriptions/`. The request carries `data.references`, a small
object that names what to run. The endpoint validates the references and stores them
exactly as you sent them. It does not rewrite them.

The decision about which revision runs happens at fire time, not at save time. On every
fire, the dispatcher rebuilds the run request from the stored references, and the
workflow service resolves a revision from them:

| References you store                          | What runs at each fire                                  | Name     |
|-----------------------------------------------|---------------------------------------------------------|----------|
| `{application_revision: {id}}`                | that exact revision, every time                         | Pinned   |
| `{application_variant: {id}}`, no revision    | the variant's newest revision, looked up fresh each fire | Latest   |
| `{environment: {slug}}`                       | whatever is deployed to that environment right now      | Deployed |

## How to get "latest" from the backend

Leave the revision out. That is the entire configuration. If the stored references name
a variant but no revision, the workflow service resolves the variant's head revision at
fire time, and it does that again on every fire. Commit a new revision, and the next
fire runs it. There is no flag, no marker, no extra field.

Two details matter:

- The resolution lives in `_ensure_request_revision`
  (`api/oss/src/core/workflows/service.py`). It writes the resolved revision into that
  one run request only. It never writes back to the trigger.
- Reference keys come in three prefixes: `application_*`, `workflow_*`, and
  `evaluator_*`. The backend treats them the same. The UI writes `application_variant`;
  agent-created triggers write `workflow_variant`. Both mean the same thing.

## What is broken

The frontend does not know Latest exists. Three symptoms:

1. **You cannot choose it.** The "Which version runs?" control offers two modes: pick
   an exact revision (Pinned) or pick an environment (Deployed). There is no way to say
   "follow the variant".
2. **The UI renders a Latest trigger as broken.** On edit, the drawer stuffs the
   variant id into a revision field. The revision lookup fails, so the drawer shows an
   empty, required "Select workflow revision" field and blocks saving. The settings
   list shows the same trigger as a raw id or "-".
3. **The frontend never reads the `workflow_*` keys.** Agent-created triggers store
   `workflow_variant`, so they hit both problems above every time.

We first tried to patch this in the backend. PR #5103 made the endpoints pin the
variant's head revision into the stored references at save time, so the frontend would
always find a revision key it knew how to read. That traded a correct binding for a
wrong one: the trigger stopped following new commits. Mahmoud closed that PR on
2026-07-09. The pin commit still sits on the local lane
`fix/trigger-revision-default-head`; Phase A of the plan removes it.

## What we will build

Frontend, the real work:

1. **A third option in the version control.** The "Which version runs?" rail becomes
   `Latest | Pinned | Deployed`. Picking Latest shows a variant picker (workflow, then
   variant, no revision level). On save, the drawer submits
   `{application: {id}, application_variant: {id}}` with no revision. That is exactly
   the shape the backend already reads as "follow latest".
2. **One shared reader for stored references.** A small pure function classifies any
   stored references into a mode: a revision key means Pinned, a variant key with no
   revision means Latest, an environment key means Deployed. It checks all three
   prefixes. Both drawers and both settings tables use it. This fixes edit (the drawer
   opens in the right mode and shows the current value) and the list (each trigger
   shows its workflow name plus a tag: Latest, v3, or @production).

Backend, cleanup only: remove the pin from the closed PR's lane. Keep its one good
piece: the subscription endpoints now return 422 instead of 500 when a reference does
not resolve.

SDK wording: the op catalog tells agents that a schedule "binds at creation time and
does not follow later commits". Once the pin is gone, that is backwards. Fix the
descriptions so agents draw the right conclusion about their own triggers.

## What it looks like when done

- You create a schedule, choose Latest, pick a variant, and save. You commit a new
  revision. The next fire runs the new revision.
- The settings page shows the workflow name with a Latest tag, not a raw id.
- You reopen the trigger. The drawer opens in Latest mode with your variant selected.
  Renaming the trigger and saving does not touch the binding.
- An agent creates a schedule through the `create_schedule` op (variant only). It
  renders and edits exactly like the one you made by hand.

## Read the rest in this order

1. [context.md](context.md): goals, non-goals, and each design decision with its
   trade-offs and open questions.
2. [plan.md](plan.md): implementation phases A to F with exact files.
3. [research.md](research.md): the verified code findings behind every claim, with
   `file:line` citations.
4. [status.md](status.md): current state and the questions waiting on Mahmoud.

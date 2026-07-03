# Context: validate the invoke request instead of silently defaulting

## The symptom

A caller sends a malformed request to the agent service invoke endpoint
(`POST {host}/services/agent/v0/invoke`). The endpoint does not tell the caller the request
is malformed. It silently runs a seeded default agent (`pi_core` / `gpt-5.5`), and then that
default 500s a few steps later because `gpt-5.5` needs a provider prefix. The caller sees a
late, confusing 500. Nothing points back at the real cause: the request was shaped wrong.

Two malformed shapes both hit this trap:

- **References only, no revision.** The caller passes `references` (for example an
  `application_revision` ref) and expects the service to fetch and run the committed config.
  It does not. The service runs the seeded default and 500s.
- **A revision nested one level too shallow.** The caller passes
  `data.revision = <revision.data>` (the bare revision fields), when the resolver requires the
  double-nested `data.revision = {"data": <revision.data>}`. The wrong nesting is ignored, the
  seeded default runs, and it 500s.

Both are the same failure from the caller's point of view: I sent config, the run ignored it,
and I got an opaque 500 with the wrong model in the trace.

## Why this cost the lab time

The agent-creation lab drives the low-level service endpoint directly (it does not go through
the product API). During the lab, guessing the right invoke shape was slow and expensive
because a wrong guess did not fail loudly. It returned a 200-then-500 with a default config in
the resolved trace, which looks like a runtime bug in the agent rather than a bad request. The
operator had to reverse-engineer the exact nesting from the resolver source to find the one
working shape. A single clear 4xx at the boundary would have replaced that whole investigation.

## Why validation is the right lens

An earlier framing called this a "self-hydration" gap: the service should fetch the reference
itself the way completion and chat do. That fix is real and worth doing (see the sibling
finding on the seeded-default hydration gate), but it is not the frame the user wants for this
project. The user's frame is simpler and more durable:

> This is a validation problem. The endpoint should check the request up front and, when the
> request cannot resolve to a config, return a clear error that names the valid ways to call
> the application.

Under that frame there are exactly two valid ways to invoke — there is no legitimate empty or
default intent, so the caller either gives a config or specifies a revision:

1. **Provide configuration inline** (`data.parameters = {"agent": {...}}`).
2. **Provide a revision**: either a complete revision nested correctly (`data.revision = {"data":
   ...}`), or a resolvable reference the service can fetch a specific committed config from.

And a key rule inside option 2: a bare `application` reference is not enough. An application
holds many variants and revisions, so `application` alone cannot pin one config. A resolvable
reference needs at least a variant, an environment, or a revision. The endpoint validates that
too.

The goal: a caller that sends the data the wrong way gets a precise error that explains the
right way, instead of a silent default followed by a late 500.

## Goals

- Turn a malformed invoke into a clear 400 at the boundary, before any run starts.
- Make the error name the two valid call shapes and, for references, name the missing
  identity (variant, environment, or revision).
- Validate that a supplied revision is nested correctly.
- Keep the behavior consistent across the agent, completion, and chat services where the
  contract is shared.

## Non-goals

- **Not OpenAPI.** The decision to keep the services' OpenAPI off stands (a bare `Optional[dict]`
  parameters field renders as an opaque, misleading schema; `/inspect` is the live contract).
  See the superseded `harden-invoke` decision.
- **Not blanket `extra="forbid"` on the whole envelope.** The user rejected locking the request
  shape down wholesale. Validation should fail loud with a good message on the load-bearing
  fields (is there a resolvable target, is a supplied revision nested right), not reject every
  unknown field.
- **Not a rewrite of reference resolution.** This project validates the request shape at the
  boundary. Whether the service also self-hydrates a bare reference (the seeded-default gate) is
  tracked as related work and can land alongside, but the validation is the primary deliverable.

## Relationship to earlier notes

This project supersedes and merges the earlier `harden-invoke` decision and the `silent-fallback`
and `invoke-contract` threads under
`docs/design/agent-workflows/scratch/console/builder-kit/`. Those converged on "add strict
validation with clear errors, keep OpenAPI off." This workspace is the durable home for that
conclusion, reframed around request validation and the two valid call shapes.

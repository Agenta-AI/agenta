# Agent multi-modality

Give agent workflows real multi-modal input — images, audio, and documents that the
**model actually perceives** and the **agent can operate on** — and make every file a user
shares a durable, findable record.

Today the agent lane is text-only at the model. Attachments are plumbed all the way from the
composer to the runner and then dropped one line before the harness: image/audio bytes never
reach the model. The prompt (non-agent) lane, by contrast, is genuinely multi-modal. This
project closes that gap.

## Read in this order

1. **[context.md](context.md)** — the current state, verified against code. What is wired,
   where exactly it breaks, and the constraints the design must respect (ACP is an external
   standard we cannot bend; the mounts substrate we build on).
2. **[proposal.md](proposal.md)** — the design and every interaction diagram: the wire-reference
   model, the two-object (immutable original + mutable working copy) storage model, capability
   gating on ACP `promptCapabilities`, and the phased plan.

## The one-paragraph version

The wire stops carrying base64. A shared file is uploaded once to a **session-scoped
attachments mount** and referenced by a small handle in the message. Two objects come out of
that: an **immutable original** (never in the agent's writable tree — the source of truth for
"find what I shared", for download, and for what the model sees) and a **mutable working copy**
the runner materializes into the agent's `cwd` (so tools can read, transform, or edit it —
whatever the conversation calls for, without ever destroying the original). At prompt time the
runner reads the original and emits standard ACP `image` / `audio` / document blocks — the
seam that is hard-coded to a single text block today. Capability is gated on the ACP
`promptCapabilities` the runner currently ignores, surfaced to the composer so unsupported
modalities are refused honestly instead of silently dropped.

## Status

Design. Not started. Every fork in the design is resolved against verified code — see the
decision log in [proposal.md](proposal.md#decision-log).

# Lesson: entries the durable cwd cannot represent, and why QA could not see one

Date: 2026-08-03. Occasion: issue #5692 (AGE-4063), found in real use after v0.108.0 shipped —
a Codex agent running on a personal ChatGPT subscription worked for exactly one turn per session
and failed on every turn after that. The product fix ships separately; this note is about the
shape of the bug and the shape of the QA that missed it.

## The class of bug

The agent's working directory is durable because it is a geesefs mount over S3. Object storage is
not a filesystem: some entries have no representation in it. When one is written into the durable
cwd, it survives only as long as the live mount does. On the next unmount/remount it comes back
as something else — for a symlink, a **0-byte object**.

We already knew this and had designed around it twice:

- **SQLite write-ahead logging** is unsupported on geesefs, so `CODEX_SQLITE_HOME` is redirected
  onto container-local disk, in both managed and subscription modes.
- **Hard links** are unsupported for the same reason and were pre-empted the same way.

The third instance was a **symlink**: the Codex subscription path points the run's Codex home at
the operator's mounted login by symlinking `<cwd>/.codex/auth.json` into the durable cwd. The
symlink persisted to the store as a 0-byte object, and the "create only when absent" guard read
that 0-byte file as "the link is already there" — so it was never rebuilt. Every later turn read
an empty credential file and reported it as an authentication failure.

The generalisation worth keeping: **the durable cwd is object storage wearing a filesystem's
clothes.** Anything placed in it that is not plain file bytes is a candidate for this failure, and
the failure is invisible for as long as the mount stays up.

## Why our QA shape could not see it

Two independent blind spots, both structural rather than accidental.

**Single-turn coverage.** The pre-merge QA for the subscription path was four checks, all green,
all one request each. The failure only exists on turn two — after the working directory has made a
round trip through the object store. No number of single-turn checks reaches it.

**Warm-only resumes.** The release gate did have a multi-turn journey, but it ran three quick turns
against a live daemon on a live mount, where geesefs serves the symlink correctly. The gate could
not distinguish "the directory is durable" from "the directory is still mounted".

A third, smaller gap made the first two invisible: the gate had a cell **labelled** as the Codex
subscription path that actually ran the **Pi** harness with an OpenAI-compatible subscription
provider. Pi never loads codex-acp and never assembles a `.codex` home, so the code that broke had
no coverage at all — while the matrix read as if it did. A supported, documented configuration can
be missing from a matrix that appears to contain it.

## What changed in the gate

Continuity is now a real dimension rather than a single journey, using the tier vocabulary the
approvals QA already established in `warm-approvals-qa.md`:

- **`warm`** — same daemon, same live mount.
- **`cold1`** — the pooled session is evicted and rebuilt while the runner stays alive. The client
  forces this the way a user would: changing the agent's instructions changes the config
  fingerprint, the runner evicts, and the rebuild unmounts and remounts the durable cwd. That is
  the store round trip.
- **`cold2`** — the runner replica is replaced (an operator hook that SIGKILLs it, then waits out
  the session-owner TTL). Expected results differ per sandbox: a local sandbox correctly refuses,
  a remote one resumes cold.

All three run in every cell — Codex, Claude and Pi, across the credential modes — and the matrix
gained a genuine Codex-subscription cell (the codex harness with `runtime_provided` credentials),
plus a codex-on-Daytona cell so a completed cold 2 is observable at all. The mislabelled cell now
says what it actually is.

Two things make a green result mean something:

- **The store must be in play.** With no object store configured the runner degrades silently to
  an ephemeral directory and every turn still looks fine, so the journeys resolve the session's
  durable mount through the API first and refuse to pass without one (`--require-store` turns that
  refusal into a failure).
- **The evidence is store-side.** The client reads the token the agent wrote straight out of the
  store, and writes a file into the store that the agent must then read back — content that cannot
  reach the agent unless that turn's working directory really resolves to the store. Results also
  list any 0-byte objects found in the durable cwd, which is exactly the fingerprint this bug left
  behind.

The general rule is recorded as lesson #16 in the release gate's `LESSONS.md`: a warm multi-turn
test cannot see anything the object store cannot represent, and a continuity result from a
storeless deployment is not durability coverage.

**Status:** the new journeys have not yet been executed against a live stack. The next release run
is their first exercise.

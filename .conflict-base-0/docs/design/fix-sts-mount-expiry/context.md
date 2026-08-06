# Context: why agent mounts break with "Permission denied"

## What the user experiences

An agent conversation works normally for a while. Then, mid-conversation, every file
operation under the agent's durable folders starts failing with "Permission denied".
The agent cannot read or write `agent-files/` or its working directory. The outage
lasts minutes, then clears on its own when the runner happens to rebuild the
environment.

On the OSS deployment on 2026-07-25 we counted 16 such denial windows in one day. The
longest lasted 14 minutes 10 seconds. Writers interrupted mid-operation left stale
`.git/index.lock` and `.git/config.lock` files behind, which then wedged the
following turns even after the mount recovered.

The durable per-agent volume is hit hardest because it is long-lived and shared
across sessions. The per-session scratch directory is re-signed at every turn
boundary and mostly dodges the window.

## Why it happens

Agent mounts are geesefs FUSE mounts of an object-store prefix. The runner asks the
API to mint temporary, prefix-scoped store credentials (STS credentials), then starts
a geesefs daemon with those credentials as static environment variables. Nothing ever
refreshes them.

Three defects combine into the observed outages. The full evidence is in
[research.md](research.md); in short:

1. **The credentials expire far earlier than requested.** The API requests a
   3600-second lifetime, but on SeaweedFS the credentials silently die after 900
   seconds. SeaweedFS caps every STS session at the expiry of the web-identity token
   the API authenticates with, and the API mints that token with a fixed 15-minute
   lifetime.
2. **The runner's own expiry bookkeeping drifts.** The session pool records when a
   parked environment's mount credentials expire, and evicts the environment when
   they do. But on every warm turn it overwrites that record with the expiry of a
   freshly signed credential that never reaches the running geesefs daemons. After
   the first warm turn the pool believes the mounts are fresh forever, so an active
   conversation keeps reusing mounts whose real credentials died long ago.
3. **Expired credentials are a silent failure mode.** A dead daemon (hard death)
   returns ENOTCONN, which the runner detects and repairs mid-turn. Expired
   credentials (soft death) leave the daemon alive and every operation returning
   EACCES, which nothing detects.

## Goals

- An agent conversation never sees "Permission denied" from an expired mount
  credential, in either deployment mode: self-hosted OSS with SeaweedFS, or real AWS
  S3 with AWS STS.
- The credential lifetime is configurable through an environment variable so QA can
  shrink it and reproduce the failure quickly.
- The fix stays small: no new daemons, no new wire fields, no credential-refresh
  machinery inside the sandbox.

## Non-goals

- In-place credential refresh for a running geesefs daemon. Research.md enumerates
  the mechanisms; all of them add real machinery, and none is needed once
  credentials outlive every turn.
- Cleaning up stale `.git/*.lock` files left by past outages. Those are a downstream
  symptom; once mounts stop dying mid-write, no new locks are stranded.
- Per-mount `RoleSessionName` (today every mount signs as the constant
  `agenta-store`). That is isolation hygiene, orthogonal to expiry, and deferred.
- Detecting EACCES in the agent's event stream to trigger mid-turn remounts. It is
  false-positive-prone and redundant once credentials outlive every turn; see the
  false-positive analysis in research.md.

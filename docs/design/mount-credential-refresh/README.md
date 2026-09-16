# Mount credential refresh: swap fresh credentials into a running mount

Planning workspace for the long-term fix behind a v0.112.3 release finding. Mount
credentials cannot be renewed inside a running geesefs mount today, so the runner
rebuilds sandboxes at turn boundaries to install fresh ones, and a turn that outlives
its lease loses file access mid-run. This project teaches the mount to pick up fresh
credentials while running, so a run of any length keeps live files and warm sessions
never need a credential-driven rebuild.

Predecessor: [docs/design/fix-sts-mount-expiry/](../fix-sts-mount-expiry/) made the
credential lifetime real and made the runner rebuild before expiry. This project
removes the need to rebuild at all.

## What each file answers

| File | Question it answers |
| --- | --- |
| [context.md](context.md) | What still breaks or costs us today, and why this work exists now. |
| [research.md](research.md) | How credentials enter a mount today, what the pinned geesefs SDK actually supports for refresh (verified against its source), why the push model keeps the security boundary intact, and what happens to in-flight file operations at rotation. |
| [plan.md](plan.md) | The chosen mechanism, the changes per file, the slice order, the test plan, and the live QA plan. |
| [decisions.md](decisions.md) | Every decision this design embeds, its trade-off, and how to back it out. |
| [status.md](status.md) | Where this work stands right now. |

## Domain nouns, one sentence each

- **Runner**: the Node sidecar (`services/runner/`) that executes one agent turn per
  HTTP `/run` request.
- **Sandbox**: the isolated environment a turn runs in; "local" means the runner's own
  container, "remote" means a Daytona cloud sandbox.
- **Turn**: one user-message-to-agent-reply exchange; the runner's unit of work.
- **Session pool**: the runner's in-memory table of live environments parked between
  turns so the next turn continues warm instead of rebuilding.
- **Mount**: a directory in the sandbox whose contents live in the object store; each
  mount is one geesefs daemon holding one set of store credentials.
- **Mount credentials / lease**: the temporary, prefix-scoped S3 key, secret, and
  session token a mount's daemon uses; signed by the API, they expire at a TTL.
- **geesefs**: the FUSE filesystem binary (pinned v0.43.0) that presents an S3 prefix
  as a local directory; it vendors a fork of aws-sdk-go v1 for credentials.
- **credential_process**: an AWS SDK config-file directive that names a command the
  SDK re-runs to obtain credentials whenever the previous ones expire.
- **Lease file**: the JSON file, written by the runner, that the credential_process
  command reads; rewriting it is how fresh credentials reach a running daemon.
- **Refresher**: the runner-side loop that re-signs leases before they expire and
  rewrites the lease files, locally by direct write, remotely by pushing into the
  sandbox.
- **Installed lease / credential epoch**: the session pool's record of when the
  credentials actually installed in an environment's daemons expire; today it drives
  evict-before-expiry, after this project it advances on every refresh.
- **STS**: the "Security Token Service" protocol for minting temporary scoped S3
  credentials; both SeaweedFS (bundled store) and AWS implement it.
- **EACCES**: "Permission denied"; what every file operation returns once the store
  answers 403 to an expired lease.
- **ENOTCONN**: "Transport endpoint is not connected"; what the kernel returns when a
  FUSE daemon has died. A different failure, already handled, untouched here.

## Related work

- [docs/design/fix-sts-mount-expiry/](../fix-sts-mount-expiry/): the predecessor.
  Its research.md section 3 is the mechanism catalog this project extends, and its
  decisions.md item 2 is the deferral this project resolves.
- The v0.112.3 patch-release mitigation (shipped separately, on its own lane):
  balances the run deadline (11 h) under the lease TTL (12 h) so no turn can outlive
  its lease. It is a numbers truce, not a fix; this project is the fix.
- The lifecycle migration (`services/runner/src/lifecycle/`): moved the session
  decision logic into `session-coordinator.ts` and introduced live routes that
  reconfigure a running environment instead of rebuilding it. This project adds the
  mount-lease equivalent of that idea.

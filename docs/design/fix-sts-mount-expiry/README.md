# Fix: agent mounts return EACCES after STS credentials expire

Planning workspace for GitHub issue Agenta-AI/agenta#5516. Agent file mounts go
"Permission denied" for many minutes at a time because the temporary store credentials
behind them expire and nothing reacts. This workspace holds the investigation and the
proposed fix.

## What each file answers

| File | Question it answers |
| --- | --- |
| [context.md](context.md) | What breaks for the user today, and why this work exists. |
| [research.md](research.md) | How credentials flow end to end, what actually expires and when, where credentials are installed into mounts, which refresh mechanisms geesefs supports, and why the fix is safe on both SeaweedFS and real AWS. |
| [plan.md](plan.md) | The chosen fix, the exact code changes per file, the test plan, and the live QA plan. |
| [decisions.md](decisions.md) | Every decision the fix embeds, its trade-off, and how to back it out. |
| [status.md](status.md) | Where this work stands right now. |

## Domain nouns, one sentence each

- **Runner**: the Node sidecar (`services/runner/`) that executes one agent turn per
  HTTP `/run` request.
- **Sandbox**: the isolated environment a turn runs in; "local" means the runner's own
  host, "remote" means a Daytona cloud VM.
- **Turn**: one user-message-to-agent-reply exchange; the runner's unit of work.
- **Turn boundary**: the moment between two turns, when the runner decides whether to
  reuse a live environment or build a fresh one.
- **Session pool**: the runner's in-memory table of live environments parked between
  turns so the next turn can continue without a rebuild.
- **Mount**: a directory in the sandbox whose contents live in the object store, so
  files survive sandbox teardown.
- **Durable agent volume**: the per-agent mount (`agent-files/`) shared across all
  sessions of one agent; long-lived by design.
- **Session scratch**: the per-session working directory mount (`cwd`); re-signed at
  every turn boundary.
- **Mount credentials**: the temporary, prefix-scoped S3 key, secret, and session
  token a mount's geesefs daemon holds; they carry an expiry and cannot be renewed
  in place.
- **Installed lease**: the expiry of the credentials a live environment's daemons
  are actually running on, as opposed to the expiry of credentials signed later and
  never given to them.
- **geesefs**: the FUSE filesystem binary that presents an S3 prefix as a local
  directory; each mount is one geesefs daemon process.
- **S3**: the object-storage HTTP protocol; Agenta speaks it to whichever store backs
  the deployment.
- **SeaweedFS**: the S3-compatible store bundled with self-hosted Agenta.
- **STS**: the "Security Token Service" protocol for minting temporary, scoped
  S3 credentials; both SeaweedFS and AWS implement it.
- **EACCES**: the "Permission denied" error code; geesefs returns it for every file
  operation once the store answers 403.
- **ENOTCONN**: the "Transport endpoint is not connected" error code; the kernel
  returns it when a FUSE daemon has died but its mount point is still registered.

## Related work

- `docs/design/mount-file-viewer/`: the mounts file-listing UI; shares the same sign
  endpoints, no credential-lifetime logic.
- Draft PR #5247 and design issue #5215 introduced the durable agent mount this bug
  hits hardest; its design workspace lives on that PR's branch, not on main.

# agentOS as a runner option: evaluation (draft)

Date: 2026-09-23. Status: draft research, not a decision. No code changed.

Sources, pinned:
- agentOS: https://github.com/rivet-dev/agentos at `06db7b15` (2026-09-21). npm `@rivet-dev/agentos-core` 0.2.21. 4,659 stars, 143 open issues.
- Agenta: `Agenta-AI/agenta` main at `abe0a647` (2026-09-23), `services/runner`.

## Outcome

Pi runs on agentOS today, and it is the best-supported agent there (Claude Code and Codex are marked beta). 100 parallel Pi sessions fit on one mid-size server. You do not need a lighter harness: Pi is already the light part. The expensive part today is the container around it, and agentOS replaces that container with a V8 isolate.

The catch is the toolbox. agentOS cannot run arbitrary Linux binaries. `gh`, `uv`, Chromium/Playwright, `ffmpeg`, `poppler` and `tesseract` are not in its registry. Our coworkers use those. So agentOS would be the default tier, with a full sandbox started on demand for heavy work. agentOS supports that pattern natively, through the same `sandbox-agent` library we already use.

Recommendation (low confidence until measured): run a two-day spike, not a migration.

## Terms

- **Harness**: the coding agent program (Pi, Claude Code, Codex).
- **Sandbox**: a full Linux container or microVM (Daytona, E2B).
- **agentOS VM**: not a real VM. A V8 isolate (the JavaScript engine sandbox Chrome uses) plus a virtual kernel written in Rust. The kernel fakes the filesystem, processes and network. Many VMs share one host process (the "sidecar").
- **Host function**: a function in our server code that the agent calls as a shell command (`agentos-<name> <fn> --flag`). It runs outside the VM, so credentials never enter the VM.
- **ACP**: Agent Client Protocol, the protocol both we and agentOS use to talk to harnesses.

## How our runner works today

Observed in code:
- One engine, `services/runner/src/engines/sandbox_agent.ts`, drives every harness over ACP through the `sandbox-agent` library (Rivet's, v0.4.2).
- Two providers: `local` (default) and `daytona` (`src/config/runner-config.ts:12`).
- `local` spawns `sandbox-agent server` on the runner host (`provider.ts:290`). Each session is ordinary processes in the runner container. Separation is by working directory, not a security boundary. The provider rejects restricted network policies it cannot enforce (`provider.ts:173`).
- `daytona` gives one sandbox per session. It carries a lot of machinery: reconnect ladder and parking (`environment/sandbox-lifecycle.ts`), keep-alive pool (`session-pool.ts`), Daytona Secrets to hide keys (`daytona-secret*.ts`), autostop and autodelete settings.
- Durable files: each session's working directory is a geesefs mount of an object-store prefix, one object per file, signed per session (`engines/sandbox_agent/mount.ts`). The web drive reads those objects directly.
- Tools: the Pi extension registers tools and each call POSTs back to Agenta `/tools/call`. Claude gets them through a loopback MCP bridge.

## Question 1: 100 parallel Pi sessions

Observed (agentOS benchmark, their hardware, marginal cost per VM on a shared sidecar): a full Pi session with MCP and mounted filesystem costs about 131 MB RSS. They call this an upper bound. Cold start p50 is 4.8 ms after warm-up.

Estimate (my arithmetic, not measured): 100 sessions x 131 MB is about 13 GB. That fits on one 32 to 64 GB server. Most of the time a Pi session waits on the model API, so CPU is rarely the limit. Idle sessions can also sleep, so 100 open conversations does not mean 100 live VMs.

Per-session content (auth files, contacts, config) works the same way it does now, just in a different place:
- Each VM has its own filesystem. Nothing is shared between VMs.
- Model keys are passed per session through `env`. Better: keep keys on the host and expose tools as host functions.
- Pi skills and extensions are files you write into the VM before the session starts.

Things to tune for Pi (defaults are set for short jobs):
- `jsRuntime.v8HeapLimitMb` defaults to 128. Long Pi conversations may need more.
- `jsRuntime.cpuTimeLimitMs` defaults to 30,000 ms of active CPU.
- `resources.maxBlockingReadMs` defaults to 30,000 ms.

Comparison at 100 concurrent sessions (estimates, list prices):
|  | local today | Daytona today | agentOS |
| --- | --- | --- | --- |
| Isolation between tenants | Weak (same container) | Strong (sandbox) | Medium (V8 isolate + virtual kernel, in security review) |
| Memory | ~100 Node processes plus 100 geesefs mounts, same order as agentOS | 100 x 1 GiB minimum | ~13 GB |
| Cost | One server | ~$6.66/hour if all 100 run (1 vCPU + 1 GiB at $0.0666/h each) | One server |
| Cold start | Process spawn plus mount | Seconds | Milliseconds |
| Tools available | Everything in the runner image | Everything in the snapshot | Registry only |

Interpretation, low confidence: against `local`, agentOS saves little memory. Its gain there is isolation. Against Daytona, it saves most of the cost and the start-up time.

## Question 2: cost, speed, simplification

What would get simpler, if it works:
- Most Daytona lifecycle code: reconnect, parking, autostop, per-sandbox Secrets. It would only run on the heavy path.
- Credential hiding. Host functions keep keys on the host by design, instead of Daytona substituting placeholders.
- The tool path. Our `/tools/call` callback and the MCP loopback bridge could become host functions. Their docs claim this also saves tokens, because the agent can call tools from a script.
- Self-hosting. Isolation without a Daytona account.

What would not get simpler:
- Session continuity, approvals, tracing, keep-alive semantics. Those are ours either way.
- The heavy path still needs a real sandbox, so we keep a Daytona provider.

## Risks and gaps

1. **Toolbox gap.** Registry software only: coreutils, git, ripgrep, jq, curl, sqlite3, duckdb, ssh, vim and similar. No `apt`, no downloaded binaries, no native npm modules (`sharp`, `better-sqlite3`). Python is CPython 3.13 inside the VM; I did not verify which native Python wheels work. Heavy work goes to a mounted sandbox at `/mnt/sandbox`, driven by `agentos-sandbox run-command`.
2. **Durable drive format.** Their S3 mount stores files as 4 MB chunks plus metadata, not one object per file. Our web drive could not read that. We would need a host-directory mount over our existing geesefs mount, or a custom mount plugin. Needs design.
3. **Maturity.** Version 0.2.x, "preview, API subject to change", and the security model page says "beta, still undergoing security review." For a multi-tenant cloud running agent-written code, that matters more than speed.
4. **Shared process.** Many VMs share one sidecar process. Faults inside a VM are contained, but a sidecar crash stops every VM on it.
5. **Harness versions.** agentOS ships Pi 0.80.6 with its own `pi-acp` adapter. We run Pi 0.85.1 with our patches and extension. Their docs support registering a custom agent build, so this is work, not a blocker.
6. **Plaintext state.** Their per-VM SQLite stores session env values and MCP credentials unencrypted.
7. **Benchmarks are theirs**, measured on a desktop i7 against Daytona's minimum size. We should measure our own workload.

## Option space

- A. Do nothing. Keep local plus Daytona.
- B. Add `agentos` as a third provider next to `local` and `daytona`, Pi only, opt-in. Daytona stays for heavy work.
- C. Make agentOS the default, with a Daytona sandbox mounted on demand when the agent needs heavy tools.
- D. Wait for agentOS 1.0 and its security review.

## Proposed spike (two days, needs approval)

1. Embed `@rivet-dev/agentos-core` in the runner on a shared dev host, behind a new provider id.
2. Run Pi 0.85.1 as a custom agent with our Pi extension. Expose two Agenta tools as host functions.
3. Mount a session drive through a host-directory mount over geesefs. Confirm the web drive still reads it.
4. Run 100 concurrent Pi sessions. Record RSS, p95 turn latency and failures.
5. List which of our common agent tasks fail without a full sandbox.

## Addendum: the author's "Pi on Rivet Actors" claim (same day)

This is a different design from agentOS. Pi runs as a library inside our backend process (Node). There is no VM around it. Pi's file and shell tools are replaced by versions that call an external sandbox.

Source: https://github.com/rivet-dev/actors at `037206e5`, `integrations/pi` (Pi 0.87.0).

Observed:
- Benchmark README: 223.0 MiB baseline with one session, 304.3 MiB with 100, so 0.82 MiB per extra session. Their own caveats: one development run, mock model server, one short prompt per session, "No tools or sandbox VMs are used", retained memory not peak.
- `src/runtime.ts:184-188`: without a sandbox, all Pi built-in tools (read, bash, edit, write, grep, find, ls) are removed "so the agent cannot reach the actor host". With a sandbox, `src/sandbox.ts` rebuilds those tools so every file and shell operation goes to the sandbox.
- `src/runtime.ts:130-133`: "One `ModelRuntime` per process. It loads provider catalogs and credentials, which are not per actor." By default every session in the process shares one credential store.
- `src/runtime.ts:166`: a session can pass its own `modelRuntime`. Pi 0.87 `ModelRuntime.create({ credentials })` accepts any `CredentialStore`, and `AuthStorage.inMemory()` exists. So per-session credentials are possible, but not the default.

Interpretation, medium confidence:
- The memory claim is accurate for the harness alone. Real sessions hold longer transcripts and our extension, so expect a few MB each, not hundreds.
- The sandbox does not disappear. Our agents use bash and files on almost every turn, so they still need a sandbox. The saving is that the sandbox no longer has to host Node and Pi, can start lazily, can sleep while the model thinks, and can be smaller or shared per user.
- Per-tenant auth works only if we build a per-session `ModelRuntime` with an in-memory credential store and never put provider keys in the process environment. Pi falls back to environment variables, which every session in the process would share.
- Pi only. Claude Code and Codex are separate programs and cannot run this way.
- Shared-process risks: one crash or memory blow-up stops every session in that process, and one CPU-heavy session slows the others.

## Addendum 2: subscriptions and mounts in the in-process design

Observed in our runner (`abe0a647`):
- Hosted ChatGPT subscription for Pi: the API sends the login with the request; the runner writes it to `auth.json` in the run's agent dir; Pi refreshes and rewrites that file mid-turn; a publisher reconciles the file back to the API on start, on an interval, on recovery and on shutdown (`subscription-login/files.ts`, `publisher.ts`). Rules: never downgrade a token, never log it.
- Mounts: the session cwd (the drive) is a geesefs mount; Pi transcripts (`~/.pi/agent/sessions`) are a second geesefs mount; credential files are excluded from mounts (`mount.ts:142-190`).

Interpretation, medium confidence:
- Pi subscription: works, and gets simpler. Replace the file with a per-session Pi `CredentialStore` seeded from the delivered login; its `modify()` publishes the refreshed pair straight to the API. No file, no file lock, no polling. The never-downgrade and stale-login rules still apply. Sessions of the same user in one process could share one store, which removes refresh races inside that process; across runner replicas the API stays the arbiter.
- Claude Code and Codex subscriptions: unchanged. They are separate programs, so they stay on today's sandbox path.
- Drive mount: stays in the sandbox. File and shell tools run there, so the agent sees the same drive. The catch: almost every turn touches files, so a sandbox is still needed for most sessions. It just no longer runs Pi or Node.
- Transcript mount: goes away. Pi keeps the session in memory; we persist it ourselves (API or object store). Our session-continuity code changes here.
- Needs checking: Pi skills and our extension must load on the runner host, not from the sandbox; our code tools (`tools/code.ts`) run a subprocess on the host today and must move into the sandbox.

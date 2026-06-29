# Add the E2B sandbox (running Pi) — investigation

## Goal (this worktree only)

Make `sandbox="e2b"` a selectable sandbox provider, proven by running the **Pi** harness on
it. One new variable: the sandbox. The harness is held constant at Pi — the most-supported
harness, which already owns all the remote-sandbox asset-prep code (it is the Daytona
reference path). Codex/opencode/Claude on E2B are out of scope (later matrix-fill); they need
the non-Pi remote-bootstrap generalization we are deferring.

## The seam (sandbox axis)

Sandbox selection is a thin provider switch in the Node runner — there is no provider class
hierarchy, just a pattern-match. `sandbox` is a loose string on the wire (no Python enum), so
extending the set is largely runner-side + env config.

```
buildRunPlan: sandboxId = request.sandbox || SANDBOX_AGENT_PROVIDER || "local"   (run-plan.ts:153)
              isDaytona = sandboxId === "daytona"                                  (run-plan.ts:179)
buildSandboxProvider(sandboxId, env, binary, piExtEnv, secrets, perm):            (provider.ts)
   if (sandboxId === "daytona") return daytona({...})
   return local({ env, binaryPath, log })                                          ← fallback
```

## The big finding: `sandbox-agent` already exports an e2b provider

`sandbox-agent@0.4.2` ships `sandbox-agent/e2b` (alongside `local`, `daytona`, docker, vercel,
cloudflare, modal, computesdk, sprites). So the provider runtime exists — E2B is **wiring an
existing export**, not building a provider. The rivet daemon (which carries the harnesses and
the `ensure_installed` auto-install) runs inside the E2B sandbox the same way it does on
Daytona; only the provisioning/lifecycle API differs.

## What is Daytona-shaped today and needs an E2B sibling

The remote-sandbox path has three Daytona-specific pieces. For **Pi on E2B** we replicate the
Pi-relevant ones; we do NOT need to generalize non-Pi bootstrap (that is the deferred matrix-fill).

| Piece | Daytona today | E2B action (Pi-only) |
|---|---|---|
| Provider construction | `daytona({ image, create })` w/ `buildDaytonaCreate` (snapshot, autostop, ephemeral, network fields, envVars) | `e2b({...})` from `sandbox-agent/e2b` with the equivalent create/env + network policy |
| cwd | `defaultDaytonaCwd()` `/home/sandbox/agenta-<hex>` (run-plan.ts:138) | `defaultE2bCwd()` (E2B's user home) |
| Asset-prep (Pi) | `prepareDaytonaPiAssets` (daytona.ts): install `pi`, upload auth/extension/skills/system-prompt | E2B sibling using E2B's fs/process API; reuse `pi-assets.ts` uploaders which take a `sandbox` handle |
| Auth transport | `createCookieFetch` (Daytona preview-proxy cookie) | plain `createAcpFetch` — E2B uses an `E2B_API_KEY` + a per-sandbox host, no preview-proxy cookie jar; the PoC connected with `SandboxAgent.connect({baseUrl})` and no cookie. Confirm at impl. |
| Network policy | `daytonaNetworkFields` → `networkBlockAll`/`networkAllowList` | **E2B exposes NO egress block/allow in the `sandbox-agent/e2b` wrapper** (PoC: E2B egress is open by default; it relied on that for its tunnel). → refuse restricted-network E2B under strict, the way local is gated. |
| Image/snapshot | `rivetdev/sandbox-agent:<tag>-full` + baked `pi` (`build_snapshot.py`) | a **baked E2B template** (daemon + pi), via `E2BProviderOptions.template`. The PoC built one named `agenta-sandbox-agent`. Do what Daytona does. |

## What is held constant (Pi)

- Pi's local + Daytona asset-prep, extension, usage file, system-prompt handling, skills
  materialization — all already exist and are Pi-shaped. We point them at the E2B handle.
- Tool delivery: Pi uses its native extension + the file relay; the relay already works on
  remote (`sandboxRelayHost`). Reuse as-is.
- Tracing: Pi self-instruments via the extension under the propagated traceparent (works
  remote on Daytona today; same on E2B).

## The `sandbox-agent/e2b` provider surface (verified from the installed types)

`e2b(options)` accepts: `create` (passthrough to E2B `SandboxBetaCreateOpts`), `connect`,
`template` (string name or resolver), `agentPort`, `timeoutMs`, `autoPause`. So template
selection, the agent port, and the lifecycle timeout are all first-class — no `as any`
needed (unlike Daytona's create-field cast).

## Resolved (Phase 0 confirmed — `sandbox-agent/e2b` types + the green PoC matrix)

The PoC ran **Pi (and all 4 harnesses) green on E2B** (template `agenta-sandbox-agent`).

1. **Auth/connection — `E2B_API_KEY` + plain `createAcpFetch`** (no preview-proxy cookie). E2B
   gives a per-sandbox host; the PoC connected with `SandboxAgent.connect({baseUrl})`, no cookie
   jar. Confirm at impl, but do NOT port `createCookieFetch`.
2. **Network egress — refuse restricted-network under strict.** Mirror what Daytona does unless
   E2B forces a mandatory new mechanism — and it doesn't: the `sandbox-agent/e2b` wrapper exposes no egress
   block/allow, and E2B is open-egress by default. So mirror the LOCAL gate
   (`LOCAL_NETWORK_UNSUPPORTED_MESSAGE` analogue) — no new mechanism, no silent unenforced boundary.
3. **Template — BAKED, like Daytona** (do what we do now). Build an E2B template carrying
   the daemon + pi (`E2BProviderOptions.template`), the E2B equivalent of `build_snapshot.py`.
   Not runtime auto-install.
4. **Leak backstop — `timeoutMs` + `autoPause`** on the e2b provider. E2B auto-kills a sandbox at
   its timeout; set a non-zero timeout so a process-KILL-leaked E2B sandbox self-reaps, the
   functional equivalent of Daytona's `ephemeral + autoStopInterval`.

## PoC gotchas to carry into the template build

- **E2B template build**: `npx @e2b/cli template create <name> -d e2b.Dockerfile` (v2; `build` is
  wrong for the installed CLI). `install-agent` HANGS in E2B's remote builder at the ACP-adapter
  step — replicate manually with `npm install @agentclientprotocol/<x>-acp` + native binary curl.
  ENV vars do NOT persist across RUN layers in the E2B builder — hardcode paths. `printf '\n'`
  mangled — write launcher scripts via `base64 -d`. Agents under `/root/.local` (USER root);
  run the server as root; cwd `/root/work`.
- **pi needs node ≥ 22.19**: E2B base image ships node 20 → pi-acp crashes at runtime
  (`AcpRpcError: Cannot call write after a stream was destroyed`). Install node 22 (nodesource)
  in the E2B template. Pi-only symptom — but this worktree IS Pi-on-E2B, so it's load-bearing here.

## Files (verified)

- `services/agent/src/engines/sandbox_agent/provider.ts` — `buildSandboxProvider` (add e2b branch) + a `buildE2bCreate` sibling to `buildDaytonaCreate`
- `services/agent/src/engines/sandbox_agent/run-plan.ts` — `sandboxId`/`isDaytona` (add `isE2b` + `defaultE2bCwd`); network/asset gates
- `services/agent/src/engines/sandbox_agent/daytona.ts` — reference for the E2B asset-prep sibling (new `e2b.ts`); `pi-assets.ts` uploaders are reusable
- `services/agent/src/engines/sandbox_agent.ts` — the prepare-assets dispatch (`if (plan.isDaytona) prepareDaytonaPiAssets`) gains an e2b arm
- `api/oss/src/utils/env.py` — add `E2bConfig` (`E2B_API_KEY`, ...) alongside `DaytonaConfig`
- `sdks/python/agenta/sdk/agents/dtos.py` — sandbox stays a loose string; no enum change
- `sandbox-images/e2b/` — new E2B template recipe (follow-up if baking)
- Tests: provider create-object unit (mirror the Daytona create test); local-vs-e2b gate tests

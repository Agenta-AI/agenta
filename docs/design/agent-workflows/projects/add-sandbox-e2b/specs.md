# Add the E2B sandbox (running Pi) — specs

## Scope

In: `sandbox="e2b"` runs the **Pi** harness, using the existing `sandbox-agent/e2b` provider;
a **baked E2B template** (daemon + pi, node 22) like the Daytona snapshot; Pi's existing remote
asset-prep retargeted to the E2B handle; `E2B_API_KEY` config; a `timeoutMs`-based leak
backstop. Out: any non-Pi harness on E2B (deferred — needs the non-Pi remote bootstrap),
restricted-network enforcement on E2B (refused under strict instead).

## Behavior

- A run with `sandbox="e2b"` (or `SANDBOX_AGENT_PROVIDER=e2b`) starts the baked-template E2B
  sandbox (daemon + pi already present), runs Pi there, streams the result, and **always tears the
  sandbox down** on every normal/error/disconnect path (the `finally`), with a `timeoutMs`-based
  self-reap backstop for the process-KILL case (E2B auto-kills at its timeout — the functional
  equivalent of Daytona's `ephemeral + autoStop`).
- Pi authenticates with the resolved provider key (managed `env`) or its uploaded own login
  (`runtime_provided`), exactly as on Daytona — the `shouldUploadOwnLogin` decision is reused.
- The ACP connection uses the plain `createAcpFetch` (E2B has no preview-proxy cookie).
- Pi's extension, forced skills, system prompts, and usage file are provisioned into the E2B
  sandbox; tools run via the file relay (already remote-capable); tracing is Pi-self-instrumented
  under the propagated traceparent.
- A restricted `network` policy on E2B is **refused loud under `strict`** (the `sandbox-agent/e2b`
  wrapper exposes no egress control; no silent unenforced boundary), mirroring the local gate.

## Contracts

- Wire unchanged: `sandbox` is a free string; no golden change required for selection. (Add an
  e2b example fixture only if a new wire field is introduced — none expected.)
- `E2bConfig` in `env.py` exposes `E2B_API_KEY` + the template name var via the shared `env`
  object (never `os.getenv` directly in app code).

## Decisions — LOCKED (see research.md for evidence)

1. **Auth/connection: `E2B_API_KEY` + plain `createAcpFetch`** (no cookie jar).
2. **Restricted network: refuse under strict** (no E2B egress control exists; don't invent one).
3. **Template: BAKED** (daemon + pi + node 22), like the Daytona snapshot — not auto-install.
4. **Leak backstop: `timeoutMs` + `autoPause`** on the e2b provider (E2B auto-kills at timeout).

## Non-goals / invariants preserved

- No harness code changes; Pi is held constant. The only Python change is `E2bConfig`. (The
  baked-template build is a new artifact under `sandbox-images/e2b/`, not app code.)
- The provider stays a thin branch in `buildSandboxProvider`; no provider class hierarchy.
- Teardown + leak backstop parity with Daytona is mandatory — an E2B sandbox must never outlive
  its run (cost/security).
- Restricted boundaries are enforced or refused, never silently accepted.

## Acceptance

- Unit: `buildE2bCreate` produces the expected provider options (env, `template`, `timeoutMs`/
  `autoPause` leak backstop) — mirror the Daytona create-object test; `run-plan` sets `isE2b` and
  an E2B cwd; a restricted-network E2B run under strict is REFUSED with a clear message.
- Integration: a Pi-on-E2B run returns `ok:true` with output + a trace; the sandbox is gone
  after the run (verify via the E2B API); a tool run delivers via the relay.
- Ungated endpoint → both editions per test-account convention.

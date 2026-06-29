# Add the E2B sandbox (running Pi) — tasks

Decisions are LOCKED (see research.md / specs.md); Phase 0 is a quick re-verify.

## Phase 0 — re-verify E2B + provider reality (no app code)
> Reference first: the `vibes/sessions/demo` PoC ran Pi-on-E2B green (template
> `agenta-sandbox-agent`) and documented the template-build + node-22 gotchas. Confirm, reuse.
- [ ] T0.1 Re-confirm `sandbox-agent/e2b` options: `create`, `connect`, `template`, `agentPort`,
      `timeoutMs`, `autoPause` (already read from types — sanity-check at impl).
- [ ] T0.2 Run Pi in a baked E2B template sandbox; confirm `SandboxAgent.connect({baseUrl})` with
      plain `createAcpFetch` (no cookie) and that node ≥ 22.19 is present (pi requirement).

## Phase 1 — baked E2B template (the build artifact)
- [ ] T1.1 `sandbox-images/e2b/` recipe + `e2b.Dockerfile` baking the rivet daemon + pi + node 22,
      mirroring Daytona's `build_snapshot.py`. Apply the PoC gotchas: `npx @e2b/cli template
      create <name> -d e2b.Dockerfile`; manual `npm install @agentclientprotocol/<x>-acp` + native
      binary curl (install-agent hangs in the builder); hardcode paths (env doesn't persist across
      RUN); base64-write launcher scripts; USER root, cwd `/root/work`. Template name → env (T3.1).

## Phase 2 — Node provider
- [ ] T2.1 `provider.ts`: add `buildE2bCreate` (env via the `daytonaEnvVars` equivalent,
      `template` name, `timeoutMs`/`autoPause` leak backstop) + an `e2b({...})` branch in
      `buildSandboxProvider`.
- [ ] T2.2 `run-plan.ts`: add `isE2b`, `defaultE2bCwd()`, and **refuse** restricted-network E2B
      under strict (mirror the `LOCAL_NETWORK_UNSUPPORTED_MESSAGE` gate — no E2B egress control).

## Phase 3 — Pi asset-prep + wiring on E2B
- [ ] T3.1 `api/oss/src/utils/env.py`: add `E2bConfig` (`E2B_API_KEY`, template name) on the
      shared `env` object; wire into `EnvironSettings`.
- [ ] T3.2 New `engines/sandbox_agent/e2b.ts` mirroring the Pi parts of `daytona.ts`
      (`prepareE2bPiAssets`): reuse `pi-assets.ts` uploaders against the E2B handle. pi is baked
      in the template, so no in-sandbox install needed.
- [ ] T3.3 `sandbox_agent.ts`: extend the prepare dispatch (`if (plan.isDaytona) ...`) with an
      e2b arm; use plain `createAcpFetch` (no cookie); verify `inFlightSandboxes` + `finally`
      teardown cover the E2B handle (they operate on the generic handle — confirm).

## Phase 4 — tests & docs
- [ ] T4.1 Unit: `buildE2bCreate` options (template, `timeoutMs`/`autoPause`, env — mirror the
      Daytona create-object test); `run-plan` `isE2b` + cwd; restricted-network E2B under strict
      is REFUSED with a clear message.
- [ ] T4.2 Integration: Pi-on-E2B returns output + trace; sandbox deleted after run (E2B API
      check); relay tool run works. Both editions (ungated convention).
- [ ] T4.3 `documentation/` sandbox doc + comparison table updated with E2B (baked template,
      refuse-restricted-network, `timeoutMs` backstop; deferred: non-Pi harnesses on E2B).

## Verify before merge
- [ ] `ruff format`/`ruff check`; `pnpm test`/`pnpm run typecheck`.
- [ ] Diff scoped vs origin/main; drop findings also on main.
- [ ] Teardown/leak parity with Daytona explicitly verified — no E2B sandbox outlives its run.

# Handoff

This is the entry point for anyone picking up the gateways work without context. Read it first,
then the reading order in `README.md`.

## What the branch is

`feat/add-gateways` (PR #6049) implements the design in this folder: one policy core with two
protocol surfaces, an LLM gateway and an MCP gateway, through which every outbound model call and
every outbound tool call is meant to travel. It carries the domain and storage layers, the shared
policy plane, both data-plane proxies, endpoint CRUD, the MCP OAuth client and consent flow, the
development-only mock provider topology, the SDK and runner changes that route a managed agent run
through the gateway, and the acceptance matrix that proves the mock routes. It was rebased and
squashed onto `main` on 2026-09-12, so it is now a single commit rather than the work-package
series `plan.md` describes.

## The tracking files

| File | What it is for |
| --- | --- |
| `README.md` | The posture, the reading order, and what is in and out of scope. |
| `plan.md` | The work packages, their dependencies, the three checkpoints, the rebase record, and Wave 4. |
| `implementation-status.md` | What is built per namespace, and the verified state as of 2026-09-12. |
| `open-reviews.md` | Active review findings and the closed record. The live backlog. |
| `open-designs.md` | The historical design-finding record. **Not** a backlog; every entry is resolved or won't-fix. |
| `scope-checklist.md` | Every capability either gateway could have, marked with the wave it lands in. |
| `cleanups.md` | The twelve things that become possible only once the gateways run. Never a prerequisite. |
| `qa.md` | The manual dashboard procedure. The complement to the automated matrix, and the only check that exercises the product path. |
| `workstreams/specs-wpN.md` and `workstreams/tasks-wpN.md` | One pair per work package: the target, and the ordered checklist. `workstreams/README.md` holds the file-ownership table and the parallel-work rules. |

The remaining documents are the design itself: `decisions.md`, `architecture.md`, `entities.md`,
`secrets.md`, `policy.md`, `contract.md`, `mcp.md`, `models.md`, `mocks.md`, `libraries.md`,
`notes.md`, `out-of-scope.md`, and `raw/` for the research they grew out of.

## Current state

The branch is mergeable on `main` as of 2026-09-12. Unit suites and the automated acceptance and
integration suites are green, with one exception. The dashboard product path does not work for any
harness.

- **Green.** API gateway acceptance, the mock matrix, API gateway integration, SDK MCP-routing
  acceptance, services gateway-tool integration, and runner gateway-credential acceptance. The
  per-suite counts are in `implementation-status.md`.
- **Red.** The services acceptance suite `test_agent_gateway_route.py` fails its nine Claude
  cells, one per LLM-namespace and MCP-namespace pair. Pi and Codex pass every cell. This is OR23,
  now narrowed to Claude Code.
- **Not working.** The dashboard cannot reach the gateway LLM plane at all, because the AI
  providers page creates a secret and not an endpoint. Open findings: **OR23** (Claude Code native
  MCP), **OR26** (no dashboard path to any gateway LLM route), **OR28** (per-harness preservation
  of the refusal envelope), **OR31** (the dashboard offers harness and route combinations the
  runtime refuses, and Pi has no `MCP servers` row).
- **Closed since.** **OR27** (the resolve route refuses with the shared
  `{code, message, retryable, next_step, details}` envelope and the SDK resolver carries it, so a
  refusal reaches the user as a 422 with a code and a sentence), **OR29** (the edit path
  round-trips `provider_key`; the measured mechanism was that it could not set the field, not
  that it destroyed one, and the closed record says so) and **OR30** (both untyped resolve
  failures are typed 422s).

## How to deploy and test

Run this branch as its own stack. Sharing a stack with other work does not survive a `--build`,
because the shared `agenta-ee-dev-*:latest` tags are what every other stack recreates from.

1. **Its own env file, with its own ports.** Copy the EE development source
   (`hosting/docker-compose/ee/env.ee.dev.example`, or an existing `.env.ee.dev`) to
   `.env.ee.dev.<name>` and change `COMPOSE_PROJECT_NAME`, `TRAEFIK_PORT`, `TRAEFIK_UI_PORT`,
   `POSTGRES_PORT`, the Redis ports, and `AGENTA_WEB_URL` and `AGENTA_API_URL` to match the new
   Traefik port. Env files hold secrets; they are gitignored and stay that way.

2. **Its own image tags.** Write a gitignored
   `hosting/docker-compose/ee/docker-compose.dev.<name>.local.yml` that overrides `image:` for
   every service built from this tree — `api` and the four services that share its image
   (`worker-queues`, `worker-streams`, `cron`, `alembic`), the two mock gateway services, `web`
   and `web-mobile`, `services`, and `runner`, plus the `.api`/`.web`/`.services`/`.runner` build
   anchors. `run.sh` auto-includes `docker-compose.<stage>.*.local.yml` from the edition
   directory, so it needs no flag. The same file is where harness subscription mounts for the QA
   procedure belong.

3. **The two flags.** Set `AGENTA_GATEWAYS_MOCKS_ENABLED=true` and, on a plain-HTTP deployment,
   `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED=true` in the env file. The compose files hardcode the
   first on `api` and the mock services only, and declare the second on `runner` only; the
   `services` container runs the SDK resolver and needs the second too, and the env file is what
   reaches every service.

4. **Host permissions, before the first build.** `chmod o+w web/*/public` and
   `chmod -R o+w web/packages`, or the web containers crash-loop in their entrypoint and pnpm
   fails with `EACCES`.

5. **Deploy.**

   ```bash
   bash hosting/docker-compose/run.sh --ee --dev --env-file .env.ee.dev.<name> --build
   ```

6. **Test.** `--logs` is not optional: without it `test.sh`'s `prepare_log` returns 1 under
   `set -e` and the run aborts after the install step with no test output.

   ```bash
   bash hosting/docker-compose/test.sh --ee --dev --env-file .env.ee.dev.<name> \
     --logs=<file> --api -a --all -- oss/tests/pytest/acceptance/gateways/
   ```

   The other suites follow the same shape with `--api -i`, `--sdk -a`, `--services -a`,
   `--services -i` and `--runner -a`. `implementation-status.md` names the target of each.

7. **Manual QA.** Follow `qa.md`. It now carries the API call that stands in for the missing
   endpoint-creation control, and it names the two defects that gate its MCP step.

## Relationship to PR #6050

PR #6050 is the wallets work, and it stacks on top of this one: metering and billing are among the
six concerns the gateway owns (D12), and the wallet is what prices what the gateway meters.
**The seam between them is not built.** Nothing in this branch records usage, and `plan.md` says
why — WP11 and WP22 ship together with the pricing model, deliberately after the three waves,
because no real traffic passes before C3 and so nothing can be lost by waiting. The wallets side
states its expectations of that seam in `docs/design/wallets-research/v1/seams.md`; read it before
changing anything on the gateway's metering surface, and read it on the wallets branch, since it
does not exist on this one.

## Next steps

Wave 4 in `plan.md`, in this order: OR26 (the dashboard must produce a gateway endpoint), then the
three OR31 surfaces (Pi's missing `MCP servers` row, Claude Code offered on an endpoint it cannot
use, Codex offered a model key its catalogue rejects). All of it is dashboard work now, since the
wave's three runtime findings are closed. OR23 and OR28 run alongside rather than in that
sequence.

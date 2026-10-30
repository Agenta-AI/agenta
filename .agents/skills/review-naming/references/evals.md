# Evals for this skill

For testing the skill only. Do not read this page during a review: it lists expected
findings, and reading it would make the test pass by copying.

## Format

Each eval has:

- **Prompt**: the request and the target (a spec path, a diff, or a page).
- **Should fire**: yes or no. Near-miss negatives must not trigger the lens.
- **Expected findings**: the issues that must appear, by meaning, not by wording.
- **Expected non-findings**: issues that must not appear.
- **Pass**: at least the stated number of expected findings, zero expected non-findings, and
  every finding cites a rule.
- **Runs**: Codex (medium effort, read-only) and Opus. Both must reach the expected
  rating band.

## Golden case 1: accounts spec draft

- Prompt: "Review this spec draft for naming", with a context file of settled decisions. Write
  the draft so that it adds a way to choose which stored account an agent uses, and so that
  it holds the six faults listed below.
- Should fire: yes.
- Expected findings (pass at 5 of 6):
  1. The service concept is `service` on `secrets` and `mcps_endpoints` but
     `integration_key` on `gateway_connections`, and the index shapes differ.
  2. `binding` has two meanings: whose account (`secret.binding`) and the environment
     variable (`sandbox.credentials[].binding`).
  3. `scope: organization` does not mean scope; it says which slug list the slug is in.
  4. `project_default` and `caller_account` mix two naming schemes.
  5. The folder mix: `core/gateway` next to `core/gateways` (and the same in `dbs/postgres`),
     where the spec puts account code.
  6. The default rule covers only user rows (`WHERE user_id IS NOT NULL`), not project and
     organization rows.
- Expected non-findings: `created_at` against `create_time`; slug unique per owner.
- Expected rating: Medium or High.

## Golden case 2: gateway naming

- Prompt: "Review the naming of the gateway modules under `api/oss/src/core/` and
  `api/oss/src/dbs/postgres/`" with a checkout of origin/main.
- Should fire: yes.
- Expected findings: `core/gateway` next to `core/gateways`; `dbs/postgres/gateway` next to
  `dbs/postgres/gateways`; `gateway_connections` owned by the tools path, not the gateway;
  `llms_endpoints` and `mcps_endpoints` break the table pattern; "connection" with three
  meanings.
- Expected rating: Medium (pre-existing code; High only if a target spreads it).

## Near-miss negatives

- "Fix this Alembic migration error: lock timeout on `secrets`." Must not fire.
- "Why does the runner time out on Daytona?" Must not fire.
- "Group these config fields by role." Use design-interfaces, not this lens.

# Plan: build-kit tools cleanup

Status: proposed, 2026-07-03. Not started. Everything below batches into **one PR**
(decided); the slices are ordered commits inside that PR, each independently green
(tests + docs sync per slice), so review reads slice by slice and a late slice can be
dropped without unwinding the early ones.

Blocked on: the three open decisions in [status.md](status.md), and the approval-boundary
coordination below.

## Coordination constraint (read first)

The [approval-boundary](../approval-boundary/) lane is implementing TODAY against
`sdks/python/agenta/sdk/agents/platform/op_catalog.py` (permission model rework:
`needs_approval` deleted, `read_only` consulted by an `allow_reads` policy mode; see
`../approval-boundary/status.md` and `../approval-boundary/plan.md`). Rules for this
project:

1. **Never touch approval semantics.** No changes to `needs_approval`, the permission
   plan, `read_only` handling in the approval path, or the relay gate. New ops
   (`query_spans`, `test_run`) only SET the existing `read_only` hint; they do not change
   what the hint means.
2. **Coordinate before touching `op_catalog.py`.** Post a lease row on
   `docs/design/agent-workflows/scratch/agent-coordination.md` naming the exact edits
   (two op-key renames, plus the `handler` mode if Option C is approved) BEFORE editing.
3. **Sequence after their lane lands, or with the owner's explicit ack.** If their PR is
   still open when this project starts implementation, either wait or stack this lane on
   theirs; never edit the file in parallel on an independent lane.
4. The overlay default list deliberately lives in `overlay.py`, not `op_catalog.py`
   ([research.md](research.md), cut section), specifically to shrink the contended
   surface.

## Slice 0: decisions and verification (no code)

- Mahmoud answers the three open decisions (overlay-scope, test-run-shape,
  spans-stopgap). Recommendations are written; see [status.md](status.md).
- Verify gotcha 1 live (one playground run; confirm which skills the resolved run
  actually carries). Record the result as a builder-agent-reliability finding either way.
- Get the approval-boundary owner's ack on the `op_catalog.py` sequencing.

Exit: decisions recorded in this folder, coordination row posted.

## Slice 1: renames (hard migrate, no aliases)

- `op_catalog.py`: rename the two op keys and their constants; sweep description text
  ("returned by find_triggers").
- Delete the legacy `tools.agenta.find_capabilities` `/tools/call` dispatch
  (`api/oss/src/apis/fastapi/tools/router.py:1141-1207`) and
  `parse_find_capabilities_arguments` / `FIND_CAPABILITIES_OP`
  (`core/tools/discovery.py:45,78`), or rename the constant if deletion turns out to have
  a hidden caller (grep first; research found only the router).
- Docstring/comment sweep: `core/tools/{dtos,service}.py`,
  `apis/fastapi/tools/models.py`, `core/triggers/dtos.py`,
  `sdks/.../agents/tools/models.py:220`.
- Tests: `test_op_catalog.py`, `test_parsing.py`, `test_models.py`, `test_resolver.py`,
  `test_skill_template_catalog.py`, `test_build_kit_overlay.py:188`, FE
  `agentRequest.test.ts` op literals, and the discovery/trigger-discovery API tests if
  they assert op keys.
- Docs sync (same slice): `documentation/tools.md`, the three interface pages +
  `interfaces/README.md` ([research.md](research.md) has exact lines). Regenerate or
  defer the generated-client docstring (cosmetic; note it in the PR).

Exit: full-repo grep for `find_capabilities|find_triggers` returns only design-history
docs (projects/ and scratch/ archives, which stay as-is).

## Slice 2: overlay cut

- Add `DEFAULT_BUILD_KIT_OPS` to `overlay.py` per the approved overlay-scope decision
  (recommended: static core 8 + event 5, minus the seven cut ops; `query_spans` joins in
  slice 3). Validated against `PLATFORM_OPS` keys in the overlay test.
- Rewrite `test_build_kit_overlay.py`'s equality assertions against the explicit list;
  add a test that every cut op still resolves from the catalog (opt-in path stays alive).
- Docs sync: `documentation/tools.md` op table gains the default-overlay marking;
  `documentation/agent-template.md` if it describes overlay contents.

Exit: a fresh playground application response carries exactly the approved list.

## Slice 3: `query_spans` (if approved)

- One catalog entry (`read_only=True`, `POST /api/spans/query`), one overlay-list entry,
  op-catalog tests (key list, method/path table), overlay test update.
- Live check: call it through a playground run against a real trace; confirm the payload
  is model-digestible, add the `fields` projection only if it is not.
- Docs sync: `documentation/tools.md` op table.

Exit: the builder can verify a past run's tool spans end to end.

## Slice 4: skills port

- `agenta_builtins.py`: add the `build-an-agent` `SkillTemplate` + slug; delete the three
  old templates, slugs, and bodies ([skills-port.md](skills-port.md) has the outline and
  the two rules). Persona/preamble per Mahmoud's call on the proposal there.
- `static_catalog.py`: swap the rows; `overlay.py`: the new skill becomes the overlay's
  ONLY skill embed (getting-started leaves the overlay and stays harness-forced;
  review round 1, see [skills-port.md](skills-port.md) "The shape").
- Hard-migrate sweep: search existing revisions/dev data for embeds of the three deleted
  slugs; rewrite or drop them (no aliases, decided 2026-07-03).
- Tests: `test_static_catalog.py`, `test_build_kit_overlay.py` (exactly one skill embed),
  `test_skill_template_catalog.py`.
- Docs sync: `documentation/skills.md` (the skill catalog list, if it names the four),
  and the builder-agent-reliability workspace pointer.

Exit: a fresh playground agent resolves getting-started + the playbook, and no old skill
slug resolves.

## Slice 5: `test_run` (per the approved home; largest slice)

Assuming Option C ([tool-home-options.md](tool-home-options.md)):

1. **Wire**: spec-level `context` next to `callRef` + generic `$ctx` injection in the
   relay's `callRef` branch, plus per-op `timeout_ms` threading. Golden fixtures,
   `protocol.ts`, `wire.py`, and both contract tests move together (runner CLAUDE.md
   rule). This sub-slice is useful standalone and lands first.
2. **Catalog mode**: `PlatformOp.handler` XOR `path` (mirror the existing schema XOR
   validator); resolver emits `callRef=tools.agenta.<op>` + context for handler ops.
   (`op_catalog.py` edit: re-check the coordination board.)
3. **Server handler**: the tools-domain `test_run` handler per
   [api-design.md](api-design.md): resolve revision, apply delta, invoke headless with an
   internally signed token, drain the stream / query spans with retry, digest, verdict.
   Recursion guard (`meta.run_kind="test"` + the run-context flag) and the duration cap.
4. **Overlay + skill**: add `test_run` to the default list; flip the playbook's test step
   from the `query_spans` interim wording to `test_run`.
5. **Tests**: handler unit tests (fake service + fake spans), wire contract tests, an
   op-catalog test for the handler mode, a replay-style integration test if a live run is
   captured (agent-replay-test pattern).
6. Docs sync: `documentation/tools.md` (new section for server-handled ops),
   `interfaces/` pages touched by the wire change, and this workspace's api-design.md
   marked as-built.

Exit: the lab's capstone scenario, run inside: build, `test_run`, read `pass`, schedule.

## Slice 6: final verification + PR

- Full test sweep (`sdks/python`, `api`, runner `pnpm test` + `typecheck`, web unit).
- Live QA on the dev stack: the worked example from
  `../builder-agent-reliability/context.md` (GitHub digest to Slack, twice daily) driven
  end to end through the playground.
- One PR against `big-agents` with the write-pr-description skill; slices as commits.

## Test-and-docs discipline

Every slice carries its own tests and its own docs-sync (keep-docs-in-sync skill); no
slice defers either to slice 6. The interface inventory and the `documentation/` pages
are part of the diff, not a follow-up.

## Risks

- Approval-boundary collision on `op_catalog.py` (managed above; the single biggest
  schedule risk).
- The wire change in slice 5.1 lands in files the runner lane historically owns; check
  the coordination board for runner leases too.
- `query_spans` payload size may need the projection follow-up (slice 3 live check).
- The skills-port delivery claim (gotcha 1) needs live verification before we lean on it
  in the PR description.

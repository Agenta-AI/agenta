# Skills port: one ordered playbook replaces the three authoring skills

Status: proposal, 2026-07-03; revised 2026-07-04 after review round 1 (the overlay now
carries ONE skill, see "The shape"). Ports the proven outside playbook (the
agent-creation-lab repo's `kit/BUILD-AGENT.md`) into the inside skill set.

## Why one skill instead of four

The lab's kit won with ONE ordered `SKILL.md` playbook: read the ask, decide from a
table, discover only what the ask needs, stop on missing connections, build, test, report.
The inside guidance is split across four cross-referencing skills
(`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`): `agenta-getting-started`
(forced baseline), `build-your-first-app` (the map), `discover-and-wire-tools` (the
discovery loop), `set-up-triggers` (cron/events). The tools-review already recommends the
consolidation (part 1, "Port two load-bearing outside ideas").

Research added a stronger reason: **three of the four skills are probably never
delivered.** The overlay embeds only getting-started
(`api/oss/src/apis/fastapi/applications/overlay.py:69-78`), the forced set holds only
getting-started (`agenta_builtins.py:320`), and nothing else references the other three
slugs (evidence: [research.md](research.md) gotcha 1; verify live). So this port is also
an attach fix: the new playbook must actually ride the overlay.

## The shape (revised, review round 1)

Mahmoud's review asked the right question: if the goal is ONE skill, why keep
`agenta-getting-started` here at all? Answer: it does not belong to the build kit, and
the first draft wrongly kept it in the overlay. The two skills serve different
populations on different delivery paths:

- `agenta-getting-started` is the platform-manners baseline for EVERY Agenta agent,
  including deployed agents that never build anything. It is harness-forced:
  `AGENTA_FORCED_SKILLS` (`agenta_builtins.py:320`) is unioned into every `pi_agenta`
  run by `force_skills` (`adapters/harnesses.py:140`).
- The playbook is build knowledge: it matters only to the playground agent configuring
  itself, and it rides the build-kit overlay.

Today the overlay ALSO embeds getting-started (`overlay.py:69-78`), so a `pi_agenta`
build-kit run receives it twice (embed + force; `force_skills` de-dupes by name, so the
duplication is waste, not breakage). The revised shape removes the overlap:

- **The overlay embeds exactly ONE skill: the playbook** (working name `build-an-agent`).
  The builder sees one authoring skill, full stop.
- **`agenta-getting-started` leaves the overlay** and stays where it already lives: the
  harness-forced set, universal and not build-specific. Delivering platform manners is
  the harness's job; the build kit stops carrying it.
- **The playbook replaces `build-your-first-app`, `discover-and-wire-tools`, and
  `set-up-triggers`.** Hard migrate: delete the three `SkillTemplate`s, their slugs, and
  their static-catalog rows (`api/oss/src/core/workflows/static_catalog.py:146-156`);
  register the new slug (`__ag__build_an_agent`).
- The body is the inside translation of BUILD-AGENT.md. Same spine, adjusted for the
  self-targeting asymmetry: inside, the agent configures ITSELF (`commit_revision`), it
  does not create another app, and its tools are platform ops, not scripts.

Alternative, flagged for Mahmoud: getting-started's body is thin (four conventions,
roughly twenty lines, `agenta_builtins.py:74-92`). Folding those lines into the harness
preamble (`AGENTA_PREAMBLE`) and deleting the skill entirely would make the playbook the
only platform skill anywhere. The default proposal keeps getting-started forced and only
removes it from the overlay, because forcing rides the `pi_agenta` harness alone
(`harnesses.py:140`); how manners reach other harnesses is that lane's question, not the
build kit's.

## Proposed body outline (structure, not final prose)

1. **What you are doing.** You turn the user's plain-language ask into a working agent:
   you are configuring yourself. Optimize for the fewest calls. A simple ask is two
   steps: edit your instructions, commit.
2. **The shape of your config.** The four things you decide: instructions, tools,
   skills, trigger. Everything else is fixed. (Port of BUILD-AGENT.md "the shape of
   every agent", trimmed to what `commit_revision.delta.set.parameters.agent` accepts.)
3. **The decision table.** Port verbatim in spirit: transform-text asks need
   instructions only; know-how asks need a skill; outside-tool asks need
   `discover_tools`; on-a-clock asks need `create_schedule`; react-to-event asks need
   `discover_triggers` + `create_subscription`. Do NOT discover tools or triggers an ask
   does not call for.
4. **The loop, in order** (skip what the ask does not need):
   1. Clarify the ask (timezones for crons, exact channels/repos, what "style" means).
   2. Discover with `discover_tools` (one short fragment per capability). Discovery is a
      search, not an oracle: confirm the integration AND the action (the Telegram->Slack
      mis-match rule).
   3. A needed connection that is not ready: STOP and hand the user the link via
      `request_connection`. That is a complete outcome, not a failure.
   4. Configure yourself: write the instructions (see the numbered-procedure rule),
      attach the tools, `commit_revision` (approval stop).
   5. Test: `test_run` with an explicit instruction-framed message; read the tools list
      and the verdict, not just the output. `incomplete` means re-test with a blunter
      numbered instruction. (Until `test_run` ships: `query_spans` on your latest trace.)
   6. Trigger if asked: cron is UTC, five fields, one-minute floor; convert the user's
      timezone yourself. `create_schedule` / `create_subscription` (approval stops).
      Confirm with `list_schedules` / `list_deliveries`. `test_subscription` blocks on a
      real event: warn the user before calling it in a chat turn.
   7. Report short: what you became, what is connected, what is scheduled, what needs
      the human.
5. **The two rules** (see below), inlined where they bite (step 4 and step 5).
6. **Footguns.** Empty output with a healthy tools list is not failure; a failed commit
   does not undo earlier steps; never surface raw provider slugs; re-run discovery after
   the user connects.

## The two rules (must appear in the skill text)

**1. The numbered-procedure instruction rule.** When the agent writes
`instructions.agents_md` for a multi-tool or scheduled agent, the instructions must be an
explicit numbered procedure that names the exact tools in order, pins concrete ids
(channel id, repo) instead of telling the agent to re-resolve them, and ends on the
terminal action ("finish by doing step N"). Port the BUILD-AGENT.md example verbatim
(lines 92-109 there). This is the lab's deepest fix for the stopped-short failure.

**2. Prefer your wired tools.** "Prefer the tools you were given (`discover_tools`,
`commit_revision`, `test_run`, the trigger ops) over your harness builtins. Touch
Terminal, RemoteTrigger, File tools, or raw HTTP only when your wired tools cannot do the
job, and say so when you do." The capstone failure mode was the run wandering into
builtins it never needed; the rule gives the model an explicit fence.

## Mapping: where the old skills' content goes

| Old skill | Content | Destination |
|---|---|---|
| `build-your-first-app` | The 8-step flow, stop points | Playbook steps 1-7 (tightened; "see what exists" via `query_workflows` is DROPPED with the overlay cut) |
| `discover-and-wire-tools` | The discover -> connect -> configure loop, response-reading guide, good habits | Playbook steps 4.2-4.4 and the footguns. The stale availability note (`agenta_builtins.py:161-165`) is deleted, not ported. The long response-field walkthrough shrinks: the op description plus the response itself carry that weight |
| `set-up-triggers` | Cron rules, subscription flow, confirm-it-works | Playbook step 4.6. The "map the sample event and run yourself on it" idea folds into the test step |
| `agenta-getting-started` | Platform manners | Content unchanged; leaves the overlay, stays harness-forced (see "The shape") |

Renames land inside the new body from day one (`discover_tools`, `discover_triggers`),
so no skill text ever names the old ops.

## Delivery (make "attached" true this time)

- Add the new `SkillTemplate` + slug in `agenta_builtins.py`; register it in
  `static_catalog.py`; make it the ONLY entry in `build_agent_template_overlay()`'s
  skills list (`overlay.py:69-78`; getting-started leaves the overlay, see "The shape").
- Do NOT add it to `AGENTA_FORCED_SKILLS`: the playbook is build knowledge, not a
  universal baseline, and forcing rides the `pi_agenta` harness only
  (`adapters/harnesses.py:140`).
- Scope claim, stated precisely: the overlay reaches build-kit-enabled playground runs
  only. The request path applies the overlay when the build kit is on and returns the
  config unchanged when it is off (both cases are pinned in the FE request tests,
  `agentRequest.test.ts`). Deployed and committed agents never carry the overlay; that is
  by design (the recursion guard in [api-design.md](api-design.md) leans on it).
- Hard-migrate sweep (same slice as the deletion): search existing revisions and dev data
  for skill embeds referencing the three deleted slugs, and rewrite or drop them. Aliases
  stay rejected (decided 2026-07-03, pre-production); the sweep IS the migration, so the
  slice is not done until the sweep comes back empty.
- Update `test_build_kit_overlay.py` to assert exactly one skill embed (the playbook),
  and `test_static_catalog.py` for the new/deleted rows.

## Skill-size check

BUILD-AGENT.md is ~210 lines with the script reference; the inside playbook drops the
script docs (ops carry their own schemas) and the lab-only invoke-shape rules, so the
target is roughly 100-120 lines. That is comparable to the current
`discover-and-wire-tools` alone, replacing three skills. Net context cost goes down.

## Persona and preamble (the TODO(product) placeholders)

`AGENTA_PREAMBLE` and `AGENTA_FORCED_APPEND_SYSTEM`
(`agenta_builtins.py:36-53`) are marked `TODO(product)`. They are `pi_agenta`-harness
surfaces, not build-kit surfaces, so they are strictly optional for this project.
Proposal: ship one small, real revision in this PR rather than defer again, because two
of the placeholder lines overlap the playbook's rules and should agree with them:

- Preamble (AGENTS.md layer), proposed direction: keep the current three bullets, add the
  prefer-wired-tools rule in one line, and drop the "greet the user once" tone rule that
  belongs to getting-started. Roughly five lines.
- Persona (`append_system` layer), proposed direction: two sentences. Who the agent is
  (an Agenta agent acting for its author) and the honesty rule (cite what tools return,
  never fabricate a result, say when you are blocked).

If Mahmoud prefers to keep persona wording out of this PR's scope, the explicit deferral
is: leave both placeholders, file a defer-todo against the pi_agenta harness project, and
strip the overlap by making the playbook the only home of the two rules. Either way the
rules live in the playbook; the placeholders only echo them.

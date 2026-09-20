# Implementation tasks

All runtime tasks are unimplemented. The test-first steps, exact files, interfaces, commands, and commit boundaries are in the [implementation plan](../../../docs/superpowers/plans/2026-09-20-load-single-agent-templates.md).

## 1. Source and package validation

- [ ] 1.1 Add typed internal source references, a versioned internal catalog, bounded package reads, canonical SHA-256 digests, and pinned retry resolution.
- [ ] 1.2 Validate local Agent Plugins 1.0 schemas and the `ai.agenta` extension. Parse exactly one agent, native skills, declared workspace entries, MCP declarations, and inactive automation recipes.
- [ ] 1.3 Reject multiple agents, `subagents`, path escapes, symlinks, reserved startup destinations, undeclared files, and unsupported MCP transports before any write.

## 2. Pure binding and compilation

- [ ] 2.1 Re-read target-project gateway connections and MCP endpoints. Bind only active, valid matches and convert missing matches into unresolved first-message needs.
- [ ] 2.2 Derive deterministic skill references without writing, then compile package instructions, tools, and MCP entries into native agent configuration while preserving ordinary `llm`, harness, runner, and sandbox settings.
- [ ] 2.3 Compose one normal first message from the current seed, optional setup guidance, retained choices, unresolved needs, and inactive automation recipes. Keep package text labeled and exclude credentials.
- [ ] 2.4 Build protected `_ag.template_origin` metadata with source kind, key, resolved version, and digest. Do not reuse skill provenance.

## 3. Resource ownership and retries

- [ ] 3.1 Add general project-scoped idempotent workflow creation with deterministic identities, protected request fingerprints, partial-create reconciliation, and same-key conflict detection.
- [ ] 3.2 Expose the same idempotent creation primitive through `SkillsService` and create one reusable skill workflow per declared package skill.
- [ ] 3.3 Add general mount materialization that creates missing declared directories and files and never overwrites an existing destination.
- [ ] 3.4 Add a general session-input claim that stores the original payload fingerprint and binds it to a deterministic execution id. Add a session start service with strict detached-start handling, durable execution read-back, and timeout replay.

## 4. Loader and API

- [ ] 4.1 Implement `AgentTemplateLoader` in this order: authorize, recover a stored source pin, resolve, parse, resolve bindings, plan skill references, compile, create the provenance-bearing agent, create skills, copy workspace, and start the first message.
- [ ] 4.2 Add `POST /agent-templates/load`. Require `Idempotency-Key`, `EDIT_WORKFLOWS`, and `RUN_SESSIONS`. Check both permissions before source or project-resource reads.
- [ ] 4.3 Wire the loader to existing workflow, skill, mount, connection, MCP gateway, and session services in `api/entrypoints/routers.py`. Add no installation table or status.

## 5. Internal catalog and frontend hosts

- [ ] 5.1 Convert all 28 current starter cards into versioned internal packages without inventing skills, files, or capabilities. Add a card-to-catalog parity test.
- [ ] 5.2 Reuse the ordinary ephemeral creation payload as `base_revision`, add typed frontend transport/state, and use one stable request key for every retry of one action.
- [ ] 5.3 Replace the older web host's template action. Keep its setup drawer and navigation, open the returned server session, and do not enqueue a browser seed.
- [ ] 5.4 Replace `/m` template handoff. Keep the connection card inside the session, load after Continue/Create, adopt the returned server session, and do not stash a second seed.
- [ ] 5.5 Keep blank and free-text creation on the existing ordinary path.

## 6. Acceptance

- [ ] 6.1 Run source, parser, compiler, provenance, idempotent workflow/skill, mount, durable session start, loader, route, frontend, and type-check suites.
- [ ] 6.2 Read back the created workflow/revision, skill embeds, mount entries, protected provenance, execution row, and absence of schedules/subscriptions.
- [ ] 6.3 Run browser scenarios on the older host and `/m` at desktop and phone widths. Cover reload, timeout replay, two concurrent same-key requests, and ordinary blank creation.
- [ ] 6.4 Run one ordinary build-kit smoke conversation for a missing connection and an inactive automation recipe. Loading must stop at durable first-message acceptance.
- [ ] 6.5 Record commit-specific evidence. Mark unrun cases `NOT RUN`. Report all multi-agent scenarios as **NOT IMPLEMENTED**.

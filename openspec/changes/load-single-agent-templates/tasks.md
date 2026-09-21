# Implementation tasks

The runtime and revised display-content contract are implemented. The current implementation plan records deployed acceptance evidence and test coverage. The test-first steps, exact files, interfaces, commands, and commit boundaries are in the [implementation plan](../../../docs/superpowers/plans/2026-09-20-load-single-agent-templates.md).

## 1. Source and package validation

- [x] 1.1 Add typed internal source references, a versioned internal catalog, bounded package reads, canonical SHA-256 digests, and pinned retry resolution.
- [x] 1.2 Validate local Agent Plugins 1.0 schemas and the `ai.agenta` extension. Parse exactly one agent, native skills, declared workspace entries, MCP declarations, and inactive automation recipes.
- [x] 1.3 Reject multiple agents, `subagents`, path escapes, symlinks, reserved startup destinations, undeclared files, and unsupported MCP transports before any write.

## 2. Pure binding and compilation

- [x] 2.1 Re-read target-project gateway connections and MCP endpoints. Bind only active, valid matches and convert missing matches into unresolved first-message needs.
- [x] 2.2 Derive deterministic skill references without writing, then compile package instructions, tools, and MCP entries into native agent configuration while preserving ordinary `llm`, harness, runner, and sandbox settings.
- [x] 2.3 Compose one normal first message from the current seed, optional setup guidance, retained choices, unresolved needs, and inactive automation recipes. Keep package text labeled and exclude credentials.
- [x] 2.4 Build protected `_ag.template_origin` metadata with source kind, key, resolved version, and digest. Do not reuse skill provenance.

## 3. Resource ownership and retries

- [x] 3.1 Add general project-scoped idempotent workflow creation with deterministic identities, protected request fingerprints, partial-create reconciliation, and same-key conflict detection.
- [x] 3.2 Expose the same idempotent creation primitive through `SkillsService` and create one reusable skill workflow per declared package skill.
- [x] 3.3 Add general mount materialization that creates missing declared directories and files and never overwrites an existing destination.
- [x] 3.4 Add a general session-input claim that stores the original payload fingerprint and binds it to a deterministic execution id. Add a session start service with strict detached-start handling, durable execution read-back, and timeout replay.

## 4. Loader and API

- [x] 4.1 Implement `AgentTemplateLoader` in this order: authorize, recover a stored source pin, resolve, parse, resolve bindings, plan skill references, compile, create the provenance-bearing agent, create skills, copy workspace, and start the first message.
- [x] 4.2 Add `POST /agent-templates/load`. Require `Idempotency-Key`, `EDIT_WORKFLOWS`, and `RUN_SESSIONS`. Check both permissions before source or project-resource reads.
- [x] 4.3 Wire the loader to existing workflow, skill, mount, connection, MCP gateway, and session services in `api/entrypoints/routers.py`. Add no installation table or status.

## 5. Internal catalog and frontend hosts

- [x] 5.1 Convert all 28 current starter cards into versioned internal packages without inventing skills, files, or capabilities. Add a card-to-catalog parity test.
- [x] 5.2 Reuse the ordinary ephemeral creation payload as `base_revision`, add typed frontend transport/state, and use one stable request key for every retry of one action.
- [x] 5.3 Replace the older web host's template action. Keep its setup drawer and navigation, open the returned server session, and do not enqueue a browser seed.
- [x] 5.4 Replace `/m` template handoff. Keep the connection card inside the session, load after Continue/Create, adopt the returned server session, and do not stash a second seed.
- [x] 5.5 Keep blank and free-text creation on the existing ordinary path.

## 6. Acceptance

- [x] 6.1 Run source, parser, compiler, provenance, idempotent workflow/skill, mount, durable session start, loader, route, frontend, and type-check suites.
- [x] 6.2 Read back the created workflow/revision, skill embeds, mount entries, protected provenance, execution row, and absence of schedules/subscriptions.
- [ ] 6.3 Run browser scenarios on the older host and `/m` at desktop and phone widths. Cover reload, timeout replay, two concurrent same-key requests, and ordinary blank creation.
- [ ] 6.4 Run one ordinary build-kit smoke conversation for a missing connection and an inactive automation recipe. Loading must stop at durable first-message acceptance.
- [x] 6.5 Record commit-specific evidence. Mark unrun cases `NOT RUN`. Report all multi-agent scenarios as **NOT IMPLEMENTED**.

## 7. Revised UI runtime and first-message contract (2026-09-21)

- [x] 7.1 Apply ordinary UI runtime additions on the server-started first turn, including skills and disabled-operation preferences, without persisting them into the agent.
- [x] 7.2 Compose full execution content in the agent service; preserve generic optional `display_content` through SDK conversion, durable input, and runner records. Distinguish absent, string, and explicit null. Reconstruct model history from full content.
- [x] 7.3 Apply one display rule to pending and durable messages on both UI hosts, including copy, edit, resend, and refresh. Reconcile by stable identity without leaking setup content. Preserve full authorized execution records.
- [x] 7.4 Add three clearly named QA templates covering a simple skill, a skill with reference/script files plus workspace files, and an inactive automation recipe.
- [x] 7.5 Test first-turn request_input rendering and submission, actual skill/reference/file use, ordinary UI parity, disabled capabilities, and no automatic trigger creation.
- [x] 7.6 Record mobile and desktop browser evidence after deployment. Read back saved resources and verify retry and cold-replay behavior.
- [x] 7.7 Commit all reviewed preview fixes and revised implementation, push PR #6944, update its description, and verify the deployed SHA and PR head.

### Display-content implementation increment

The [current implementation plan](../../../docs/superpowers/plans/2026-09-21-template-display-content.md) replaces the earlier message-field proposal.

- [x] Add generic display-content transport to Python Message, Vercel conversion, wire schema, and runner interfaces.
- [x] Persist display-content field presence alongside full execution text in runner user-message records.
- [x] Verify SDK conversion and runner HTTP persistence with shared fixtures, unit tests, and runner type checking.
- [x] Connect template startup and frontend display/copy/edit/pending reconciliation.
- [x] Complete UI runtime parity and the revised display-contract acceptance checks.

### QA coverage, 2026-09-21

Code commit `14838bd7312d9a0400a387ef58f9642cf76f5e10` passed the revised display-contract acceptance checks on the isolated Hetzner preview. The final documentation-only commit records these results.

- Live: three fixture sources; first-turn forms and submission; skill/reference/workspace/script facts; phone and desktop display; copied text; refresh; runner-restart follow-up; one initial record; zero active schedules/subscriptions; two concurrent same-key retries returning the original session; ordinary blank creation; legacy playground display.
- Unit: changed-payload replay conflicts, disabled operations, saved-versus-runtime configuration, absent/null/empty display transport, attachments, edit-context preservation, record reconstruction, existing pending-row identity reconciliation.
- NOT RUN in this pass: two separate browser tabs racing the very first submission, a forced network-timeout injection, and a full missing-connection build-kit conversation. Those broader scenarios keep tasks 6.3 and 6.4 open. Multi-agent loading remains NOT IMPLEMENTED.

Checks: 97 backend template/session tests; 111 SDK message/wire tests; 104 runner tests; 1,198 shared chat tests; 332 mobile tests; 5 template transport/state tests. Runner, chat, mobile, and legacy-host type checks passed. Changed Python and frontend files passed formatting/lint checks and git diff checks.

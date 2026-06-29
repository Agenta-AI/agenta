# Agent workflows -- status for Mahmoud

_Maintained by the assistant. You only read this; GitHub is the source of truth._

Last updated: 2026-06-28

---

## 2026-06-28: Agent builds an app -- design PRs up for review

The initiative: a newly created agent ships preloaded with default platform tools and default skills. The user can chat with that agent to build their first real application. Out of the box it can set up triggers and cron jobs, configure tools and connections, edit its own instructions, and commit itself. Anything the user does not want, they delete.

Five draft design-doc PRs are open on big-agents, all marked needs-review. Each has a comment stating exactly what feedback is needed.

| PR | What it covers |
|----|---------------|
| [#4921](https://github.com/Agenta-AI/agenta/pull/4921) | Overview -- the map, start here |
| [#4917](https://github.com/Agenta-AI/agenta/pull/4917) | Default agent config (which tools and skills ship by default) |
| [#4918](https://github.com/Agenta-AI/agenta/pull/4918) | Platform skills (the build-flow skill content) |
| [#4919](https://github.com/Agenta-AI/agenta/pull/4919) | Builder tools (triggers, cron, find-triggers, and the agent-driven trigger test flow) |
| [#4920](https://github.com/Agenta-AI/agenta/pull/4920) | Frontend round-trip (client tools, commit refresh, connections) |

**Plan after review.** Part 1 (default config, skills, builder tools) we implement ourselves. Part 2 (frontend round-trip and trigger test UX) goes to Arda for his approach review first, then we implement together with him on the pure-frontend pieces.

**Process: docs-first.** Nothing gets built until you review and approve each PR. The Slack ping to Arda on the frontend round-trip is on hold until you finish your review pass.

**Small open items in the PR comments** (none block the design review):
- Whether to ship four skills or fold one in
- The trigger test UX default
- The frontend display choice

---

## Merged (big-agents)

All 8 overnight PRs are in. Today added three more, plus the team's FE work.

- **#4899**: MCP env-var error text
- **#4910**: Trace/telemetry interfaces restructured by role. Behavior is unchanged.
- **#4906**: Catalog field renamed from `bind` to `context_bindings`
- **JP's renames**: agent/skill "template" naming pulled in
- **Team FE**: #4902 (agent-chat re-render perf), #4903 (queue messages during stream), #4904 (committed revision ref on clean runs only)

Workspace is clean. :8280 is healthy.

---

## For your review -- do not merge

Take in order. #4905 is urgent.

| PR | What it is | Note |
|----|-----------|------|
| [#4905](https://github.com/Agenta-AI/agenta/pull/4905) | Security fixes for #4891: prototype-pollution, SSRF fail-closed, GET-body guard | **Take first.** These gaps are live in big-agents until this lands. |
| [#4912](https://github.com/Agenta-AI/agenta/pull/4912) | MCP user-servers default-on; HTTP verified end-to-end; stdio stays off by design | Awaiting your SSRF call: harden first (#4911) or ship with residual risk. |
| [#4873](https://github.com/Agenta-AI/agenta/pull/4873) | Claude-Daytona gateway; rebased and green | One live Daytona repro still needed. Run with me. |

---

## Decisions needed

- **#4886** (direct-call design doc): merge after reconcile (recommended) or close.
- **#4912 SSRF**: harden first (#4911) or ship with residual risk. Lean: ship for cloud, harden for OSS self-host.
- **FE platform-tool picker**: this gap keeps the feature out of the playground UI. Arda or me?
- **Redeploy :8280**: picks up #4910 and the team merges. Now or hold?

---

## Issues to glance at

- [#4907](https://github.com/Agenta-AI/agenta/issues/4907): platform-op HTTP methods beyond GET/POST
- [#4908](https://github.com/Agenta-AI/agenta/issues/4908): `find_capabilities` description/schema drift
- [#4909](https://github.com/Agenta-AI/agenta/issues/4909): full words for `op`/`args_into` field names
- [#4911](https://github.com/Agenta-AI/agenta/issues/4911): harden MCP HTTP SSRF guard

---

## Session notes

Build subagents left isolated working clones (agenta-trace, agenta-mcp-clone, scratchpad clones). Safe to delete. I will clean them up.

New this session: design-interfaces skill; rules for no-abbreviations, style-editing-for-complex-comms, verify-the-rename, GitButler-stale-workspace, subscription-sidecar-restart, CI-hygiene.

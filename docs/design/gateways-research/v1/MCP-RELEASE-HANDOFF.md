# MCP release-ready handoff

## Objective and stop point

Bring PR #6049 to an evidenced MCP release-ready state: Agenta's own MCP gateway with OAuth, independent account connections, one Connect journey, per-tool permissions, useful recovery, automated tests, recorded UI QA and completed review loops. Keep the new LLM gateway and wallets disabled for this release.

Stop before merging, production deployment or production enablement. Release-ready means every mandatory item in [the gate](mcp-release-gate.md) has evidence on the final candidate revision. It is not permission to release.

## Start here

Read [confirmed decisions](release-decisions-2026-09-15.md), [connection UX](mcp-connection-ux.md), [status](mcp-release-status.md), [open code findings](open-reviews.md), and repository/area AGENTS.md instructions. The older HANDOFF.md remains historical code-review evidence. Architecture closures do not resolve security findings.

Fetch the current PR branch, record its head and base revisions, and inspect changes since the reviewed 40ee5b8 baseline. Work on feat/add-gateways or scoped dependent changes that integrate back into this PR; do not replace another contributor's work or force-push. #6050 is the separate wallet dependency, outside MCP implementation scope.

## Work packages

### Establish baseline and release gates

Run relevant existing suites and record baseline failures. Trace enablement through API, SDK, runner and UI. Prove MCP can be enabled with new model routing and wallet charging disabled. Existing model calls, credentials and starter credits must still work. Mock switches are not product-release flags. Add only missing independent gating and tests. Record real names/defaults once verified.

### Implement independent account identity

Trace endpoint identity, consent attempt, grant lookup, refresh and disconnect. Use existing stable platform IDs/slugs rather than project plus URL for selecting an account grant. Preserve editable names, configured selection and project ownership. Inspect persisted records before choosing a migration. If old credentials were overwritten, require reconnect rather than pretending to recover them. Test A/B accounts at the same URL and name edits.

### Implement the single Connect journey

Compare current integration components with MCP settings and agent-configuration entry points. Implement the UX document using shared components where appropriate. URL comes first; suggest a name and discover OAuth where supported. Keep an explicit manual fallback. Handle cancel, repeated submit, OAuth return, partial save and tool-discovery failure. Remove the user-visible create-then-connect sequence without pretending internal pending state is unnecessary.

### Prove and implement per-tool permission wiring

Build the smallest complete discovery -> policy -> call -> approval/rejection -> resume proof using the existing runner mechanism. Investigate it early alongside identity work. Then complete UI/configuration wiring on the chosen stable identities. Do not just copy Composio-specific toolkit fields. Verify every supported runner, newly discovered tools, duplicate tool names across accounts and scheduled runs under the existing approval policy. A rejected call must have no upstream side effect.

### Complete recovery and small audit changes

Add method/tool/duration/existing correlation fields where callers can supply them. Preserve credential redaction. Cover ordinary interruptions, concurrency, revoked credentials and reconnect. Retain current buffering, transport, API process and OAuth/storage boundaries. Fix concrete defects; do not use this work to introduce deferred infrastructure.

### Add automated tests, documentation and recorded QA

Follow [the release matrix](mcp-release-gate.md). Tests belong with each change, followed by the real combined path. Use real middleware, database migrations and credential resolution in integration tests. Mock-only green tests do not resolve the existing end-to-end evidence gap.

Deploy a compatible candidate to an authorized test environment with existing data preserved. Use the configured deployment and run-qa/use-browserbase skills when available. Never copy the older QA document's destructive --nuke command onto a shared machine. Capture the visible Connect flow, account selection, permissions and reconnect, plus request/side-effect evidence. Record revision, deployment versions, flags and replay links without secrets.

Update user guides and reference pages to match the implemented candidate. Remove the planned-flow notice only after verifying the flow. Update stale harness/OAuth/permission statements from observed behavior, not this plan alone. Do not regenerate unrelated API reference files.

### Review with Codex Astra and CodeRabbit

Request an independent Codex review using model gpt-6-astra with reasoning effort medium. Give it the exact candidate head/base, decisions, changed paths, existing open findings and test/QA evidence. Ask it to inspect code and tests independently, with file/line evidence for defects and attention to migration, tenant isolation, credential handling, consent recovery, permissions and flags. Do not substitute another model or reasoning level silently.

Push the candidate and request CodeRabbit review through the repository's configured mechanism. Read both review outputs. For each finding record source, severity, evidence, disposition, fix revision and verification. Fix valid findings; explain non-applicable findings with code evidence. Do not accept advice that silently reintroduces deferred architecture.

Repeat focused tests and affected QA after fixes. Ask both reviewers to review the fixes and final integrated candidate. Continue until neither has an unresolved release-blocking finding. If comments conflict, investigate the code and test the disputed behavior; escalate only a real product decision or missing external input.

CodeRabbit previously skipped this large PR because of its file limit. A skipped review is not approval. Use supported scoped/incremental review or small reviewable dependent PRs if required, preserving the final integration diff for review. If the service or requested Astra model remains unavailable, record the blocker and do not claim the review gate passed. Cosmetic suggestions may be deferred with reasons; security/correctness/release-scope defects cannot be self-waived.

### Evaluate the release gate and stop

Publish an evidence index and final checklist on this PR. Confirm the reviewed head equals the tested deployment/candidate head; after a code change, invalidate affected evidence and reverify. Record RELEASE READY only when mandatory tests, UI QA, migration checks, CI and both reviews pass. Otherwise record NOT READY and the exact blocker.

Stop at this point. Do not merge, deploy to production or turn on production flags. Later LLM SDK evaluation and wallet integration remain separate tasks.

## Autonomous working rules

Implement, test, make scoped commits and update this PR as authorized by the goal supplied to the implementing agent. Keep status and findings current after each work package. Do not ask again about settled architecture or routine reversible choices. Pause only for missing credentials, inaccessible required services, a genuinely conflicting product decision or an irreversible action outside the goal. State the blocker and completed evidence, rather than treating elapsed time as approval.

Keep an auditable checklist with task, state, commit, tests and next action. Suggested states: pending, active, verified or blocked. Never mark a task verified from an implementation claim alone. Continue review/fix cycles while useful progress is possible. Preserve existing comments and findings; add dispositions rather than deleting history.

## Code entry points

- API: api/oss/src/core/gateways/mcps/ and api/oss/src/apis/fastapi/gateways/; secrets and policy resolution.
- UI: web/oss/src/components/pages/settings/MCPEndpoints/ and the agent MCP configuration flow; compare integration connection components.
- SDK: sdks/python/agenta/sdk/agents/mcp/ and agents/handler.py.
- Runner: services/runner/src/tools/gateway-policy.ts, tools/relay.ts, extensions/pi-mcp.ts and engines/sandbox_agent/acp-interactions.ts.
- Existing QA: web/ee/tests/playwright/acceptance/settings/mcp-oauth.spec.ts, gateway API/SDK tests and services acceptance tests.
- Agent gate: .agents/skills/agent-release-gate/SKILL.md and its resources. Extend relevant coverage rather than assuming existing cells prove the new MCP flow.

## Goal to give the implementing agent

Bring Agenta-AI/agenta PR #6049 to MCP release-ready by following docs/design/gateways-research/v1/MCP-RELEASE-HANDOFF.md and its linked decisions, UX and gate. Work autonomously through scoped implementation, commits/pushes to the PR, tests, data-preserving test deployment and recorded UI QA. Implement our own MCP gateway with OAuth, URL-first single Connect flow, independent project account connections, tool inspection and per-tool permissions, simple audit context and recovery. Keep new LLM gateway and wallet behavior behind flags and preserve existing model/starter-credit behavior. Obtain independent Codex gpt-6-astra review at medium reasoning and completed CodeRabbit review; address feedback and repeat affected tests/QA and reviews until the final candidate passes the gate. Maintain auditable status, finding dispositions and exact-revision evidence on the PR. Do not silently substitute reviewers or count skipped checks as passes. Stop and report RELEASE READY with evidence, or an explicit external blocker. Do not merge, deploy to production or enable production flags. Do not implement the deferred LLM SDK or wallet work as part of this goal.

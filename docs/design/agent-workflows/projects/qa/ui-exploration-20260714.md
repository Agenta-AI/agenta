# Agent playground UI exploration — 2026-07-14

Exploratory golden-path walk of the agent playground on https://bighetzner.agenta.dev
(agenta v0.104.3, project "Default"), driven through Chrome by an agent session.
Three configurations, one full user journey each. Artifacts created: agents
`qa-ui-claude-local-c1` (v2), `qa-ui-pi-codex-c2` (v2), `qa-ui-claude-daytona-c3` (v1);
one `qa-ui-note.txt` per sandbox. Nothing deleted or shared.

## Per-config verdicts

### Config 1 — Claude Code + local sandbox + subscription (model Sonnet)

| Step | Verdict | Notes |
|---|---|---|
| a. Create | PASS | Agents > Create opens a draft drawer directly; naming happens in the Create modal (name + auto slug + auto-generated create message + "What's changing" diff). No template picker in this flow (templates only on Home). |
| b. Configure | PASS | Harness picker communicates well: "model not available" until a Claude model chosen, provider/hosting summary per harness. "Use subscription" shows a clear Self-managed card (harness reads env credentials, Agenta injects no key). |
| c. Chat PONG | PASS | Clean streamed "PONG", ~20-30 s including sandbox boot. |
| d. Bash tool | PASS | Terminal tool visible with input JSON + output `qa-00dbfc9b6354`; turn metadata (latency, tokens, cost) on hover. |
| e. Approvals | PASS w/ BUG | Dock appeared (default policy "Allow reads" gates non-reads). Approve ran the tool; Deny (via a Write) blocked it and the agent acknowledged. BUG: after one Approve, Terminal never asked again — not in new sessions, not after committing Policy=Ask. Read at the time as a persisted grant; corrected below (see bug 1) — no grant is persisted, Claude was auto-approving read-only commands under Ask. |
| f. Files | PASS | `qa-ui-note.txt` written (Write asked approval; payload showed mount path `/tmp/agenta/mounts/<project>...`), read back exactly `QA-TOKEN-C1-7391`. |
| g. Commit | PASS w/ papercut | Commit modal: New version vs New variant, auto message, diff panel. Committed v1→v2. Papercut: a second, older-style commit dialog with "0 changes" and disabled buttons appears on top after success (bug 5). |
| h. Continuity | PASS | ~90 s idle, follow-up "what token did you write" answered from context in <20 s without re-booting visibly. |

### Config 2 — Pi + local sandbox + Codex subscription (openai-codex / gpt-5.6-luna)

| Step | Verdict | Notes |
|---|---|---|
| a. Create | PASS | Same flow. Note: a new draft inherits the PREVIOUS draft's model/harness config, even across projects (bug 6). |
| b. Configure | PASS | The combination IS offered: model dropdown groups by provider — Openai, Openrouter, and **Openai-codex → GPT-5.6 Luna**. Selecting it + "Use subscription" gives the same Self-managed card ("Claude Code or Codex subscription"). Pricing tooltip shows $ for a subscription model (see bug 4). |
| c. Chat PONG | PASS | Pi replied PONG; transcript shows Thought blocks and two auto-run `read` tool calls (AGENTS.md) before answering. |
| d. Bash tool | PASS | Pi's `bash` asked approval under default policy; after Approve output `qa-00dbfc9b6354`. |
| e. Approvals | PASS | Approve leg ran. Deny leg (bash `rm -f /tmp/qa-test-file`): dock reappeared (Pi re-asks every bash — contrast bug 1), Deny → "bash failed / Denied by the permission policy." Terse but correct. |
| f. Files | PASS | Pi used a bash printf heredoc (asked approval), created `qa-ui-note.txt` with `QA-TOKEN-C2-4620`. |
| g. Commit | PASS | Changed Policy→Ask, saved, committed v1→v2. Same residual "0 changes" dialog papercut. |
| h. Continuity | PASS | ~80-90 s idle; follow-up resumed, agent queued `bash` + `read` ("read waiting on another approval" — nice queue display), answered `QA-TOKEN-C2-4620` after approval. Quirk: the queued `read` stays labeled "waiting on another approval" after the turn completes (bug 7). |

### Config 3 — Claude Code + Daytona sandbox + Anthropic API key (Sonnet)

| Step | Verdict | Notes |
|---|---|---|
| a. Create | PASS | Named `qa-ui-claude-daytona-c3`. |
| b. Configure | PASS w/ FINDING | "Use API key" panel showed Anthropic "Key configured" (vault key) with masked replace field, "encrypted in transit and at rest" copy. Advanced > Execution environment > Sandbox: Daytona reveals Network egress / Filesystem / Enforcement fields — good. FINDING: switching credentials to "Use subscription" with Daytona selected shows NO warning; Save stays enabled. The UI does not communicate that Daytona rejects subscription (bug 3 — the mission's explicit check FAILS). |
| c. Chat PONG | PASS | PONG in ~40 s including Daytona sandbox boot. Surprisingly fast. |
| d. Bash tool | PASS | A `ToolSearch` call auto-ran first, then Terminal asked approval; output `qa-555ef9c4-e8ba-4e55-97f1-d67069e9a209` (real remote sandbox hostname). |
| e. Approvals | PASS | Approve leg ran; Deny leg: "Write failed / The tool call was denied by the user (or permission settings)." Clear. |
| f. Files | PASS | Write payload path `/home/sandbox/agenta/mounts/<project>-...` (the store mount). Created `qa-ui-note.txt` = `QA-TOKEN-C3-9155`; read back exactly after idle. **Store exposure end-to-end: WORKS from the UI.** |
| g. Commit | BLOCKED | Could not produce a config delta: the Advanced drawer stopped opening / kept self-dismissing on this page (bug 2). Commit itself was verified on configs 1 and 2. |
| h. Continuity | PASS | ~4 min idle; Read File ran without re-approval, exact token returned quickly. |

## Ranked bugs

1. **MEDIUM (DOWNGRADED 2026-07-14 — was HIGH: "One Terminal approval becomes a permanent grant; Policy=Ask not enforced for Terminal (Claude Code harness)") — Claude auto-approves read-only bash under "Ask"; no persisted grant.**
   Original observation: new Claude Code agent (local), default policy. Ask for a bash command → dock appears → Approve. Set Advanced > Permissions > Policy = "Ask" ("A human approves every tool call"), save, commit, open a NEW session, ask for another bash command. Expected: approval dock. Actual: Terminal ran immediately (repro'd 3x: same session, new session pre-commit, new session post-commit). Write still asked, and Pi's bash re-asked every time, so this read as the Claude harness's Terminal grant persisting at sandbox level, surviving a fresh session — reported as a HIGH security-persistence bug.

   **Correction (2026-07-14, follow-up investigation — live probes + code trace):** there is no persisted grant. Approvals are answered once-only, no settings file is written, and a mutating command re-gates every time, including in brand-new sessions. What actually repro'd was Claude Code's own command classifier auto-approving commands it scores as READ-ONLY under "Ask" — those never raise a gate at all, so the "immediate" runs were reads slipping past the policy, not a remembered approval. Same family as the known Claude "Deny all" builtin gap (STATUS.md F-6: the generic Policy control doesn't govern Claude's builtins, so "Deny all" still lets reads through); the fix lever is verified too — explicit ask-rules for Claude's builtins force the gate to fire even on reads. Reclassified: not a security persistence bug, an over-promising label / policy-projection gap — "Ask" says "a human approves every tool call," but read-only commands run unasked.

2. **HIGH — Advanced drawer intermittently fails to open or self-dismisses on section clicks.**
   Repro (unreliable, hit repeatedly on qa-ui-claude-daytona-c3's playground): click Advanced row → drawer sometimes never appears; when open, clicking the "Execution environment" or "Permissions" row sometimes dismisses the entire drawer instead of expanding the section. Frequency increased with repeated open/close cycles. Blocked the c3 commit step entirely. Drawer open animation also takes 4-10 s under load.

3. **MEDIUM — Daytona + "Use subscription" invalid combo not communicated.**
   Repro: agent with Sandbox=Daytona → Model & harness → Provider credentials → "Use subscription". Expected: warning/disable ("Daytona sandboxes cannot use subscription credentials"). Actual: generic Self-managed card, Save enabled; nothing mentions Daytona. A user can save a config that will fail at runtime with no UI hint. (Runtime behavior not exercised to avoid burning a broken run.)

4. **LOW — Dollar cost shown for subscription/self-managed runs.**
   Turn footer showed `$0.54788` on a subscription-auth Claude run, and the model pricing tooltip shows $/1M for openai-codex (subscription) models. Confusing: user on subscription auth reads it as billing.

5. **LOW — Residual second commit dialog after successful commit.**
   Repro: Commit → modal → Commit. Toast "Changes committed successfully", version bumps, but an older-style commit dialog ("This will create a new revision of default", Save mode radios, "0 changes", disabled Commit) remains on screen and must be cancelled. Both configs 1 and 2.

6. **LOW — Draft config leaks across create sessions and projects.**
   Abandon a draft (even via forced navigation) → open Agents > Create later, in another project: the new draft pre-fills the abandoned draft's model/harness/credentials. First-time users in a fresh project inherit someone's leftovers. Also, the Create-agent "What's changing" panel counts these inherited edits (e.g. "Advanced 3 changed") against the default template, which is noise.

7. **INFO — misc papercuts.**
   - Create modal takes 4-8 s to appear after clicking Create; clicked twice, it silently closes (lost my name input once).
   - Agents list rendered partially mid-session (4 of ~14 rows) before self-correcting on the next visit.
   - Queued tool row stays "waiting on another approval" after the turn completed (Pi).
   - Tool naming inconsistent across harnesses: Claude = "Terminal"/"Write"/"Read File", Pi = lowercase "bash"/"read".
   - MCP servers config section appears only for Claude Code and silently disappears when switching to Pi — no explanation.
   - "Back" in the playground sidebar (top-left) did not navigate back to the agents list when clicked (had to navigate by URL).

## UI-testability notes (pixel-hunting pain points)

Complements `playwright-testability.md`. Everything below was located by coordinates + screenshots because the accessibility tree gives unnamed nodes:

- **Unnamed buttons everywhere**: the drawer's Create/Commit/Deploy, section rows (Model & harness, Advanced...), approval Approve/Deny, chat "New session" are `button` with no accessible name (`read_page` shows `button [ref_x]` with empty labels). Suggest `data-testid` per playwright-testability conventions: `agent-draft-create`, `playground-commit`, `approval-dock-approve`, `approval-dock-deny`, `config-section-advanced`, `chat-new-session`.
- **Ant Select dropdowns close on any focus change**: the Policy/Sandbox/Model selects can only be driven by click-then-ArrowKeys-then-Enter within one uninterrupted event burst. A `data-testid` on the select plus options (`policy-select-option-ask`, `sandbox-select-option-daytona`) would make this robust.
- **Approval dock**: no stable selector for the dock container or its payload row; the payload JSON is a single truncated line (`Payload {...}`) with no expandable testid. Suggest `approval-dock`, `approval-dock-payload`, plus `data-tool-name` attr.
- **Commit modal vs residual dialog**: two different commit dialogs exist (new modal + legacy); a testid on each (`commit-modal`, `commit-modal-legacy`) would have made bug 5 detectable programmatically.
- **Version pill**: `v1 • Saved` / `v2 • Draft` is plain text; a `data-testid="revision-pill"` with `data-version`/`data-state` attrs would let tests assert commit transitions.
- **Turn/tool status**: tool rows expose state only as adjacent text ("Awaiting approval", "failed"); a `data-state` attribute on the tool-call row would allow polling instead of screenshot-diffing.
- **Drawer animation**: sub-drawers take 2-10 s to mount with no loading indicator; tests need an explicit `data-state="open"` attribute to await.

## Environment notes

- Session ran during/after a stack redeploy; early on, one tab's renderer wedged after a forced `Leave site?` dialog discard (screenshots timed out; get_page_text still worked). A fresh tab fixed it. Later flakiness (bug 2, slow modals) may be redeploy-related load, but it persisted well past the redeploy window.
- Local sandbox host for both local configs: `00dbfc9b6354` (shared host pool); Daytona sandbox: `555ef9c4-e8ba-4e55-97f1-d67069e9a209`.

# Claude Tag Research: Deep Dive

**Date:** July 2026  
**Source:** Official Claude Tag documentation at https://claude.com/docs/claude-tag/  
**Status:** Public Beta  

## Executive Summary

Claude Tag is Anthropic's team collaboration agent running inside Slack channels. An organization Owner provisions it once with service account credentials to external systems, and every team member can then invoke it by @mentioning it in a channel or thread. Each Slack thread runs a separate working session in an ephemeral sandbox on Anthropic's infrastructure. The agent operates under its own identity (not the requester's), which means channel work is shared and auditable, but not personalized to the person who asked.

---

## 1. What Claude Tag Is

Claude Tag is an AI agent that works directly inside Slack channels, threads, and direct messages. It is Anthropic's answer to team-based agentic work: when a team member types `@Claude` with a task in a channel, Claude picks it up, works through the task in a cloud-hosted sandbox, posts progress updates as a live checklist, and delivers results back into the channel thread.

Unlike Claude Code (which runs on your local machine or terminal under your own identity) or Cowork (which is personal Claude inside claude.ai), Claude Tag is **team-oriented and service-account-based**. All team members in a channel share the same access to external systems, and work is attributed to the agent's service accounts rather than to any individual person.

### Key positioning

From the official docs: "Team work in shared channels is Claude Tag; personal work on your own files is Cowork or Claude Code." It targets the **synchronous, collaborative workflow** where a team discusses a problem in Slack and @mentions Claude to research, code, build, or analyze something in real time, with the whole channel watching.

---

## 2. Installation and Admin Setup

### Prerequisites

Before setup begins, an **Owner** of the Claude organization (not a Slack user, but a Claude admin at https://claude.ai/admin-settings/claude-tag) must verify:

1. **Team or Enterprise plan on claude.ai.** Claude Tag is not available on Free, Pro, or Max plans, nor on third-party deployments (Bedrock, Vertex AI, etc.). Only Anthropic's first-party Claude.ai service supports it.
2. **No Zero Data Retention (ZDR) enabled.** Claude Tag stores channel memory and session transcripts, which ZDR forbids. Organizations with ZDR cannot use Claude Tag.
3. **Usage credits loaded (Team plans only).** On a Team plan, channel work draws from an organization-wide usage balance, not from individual seats. This balance must be funded before setup finishes, or Claude Tag will not respond. Enterprise plans invoice.
4. **Slack workspace admin available.** Pairing requires a Slack workspace administrator to run the `@Claude connect` command in Slack and provide a pairing code.

### Four-step setup

Setup runs entirely on one page at https://claude.ai/admin-settings/claude-tag and is completed by an **Owner** of the Claude organization (not a Slack app admin, but a Claude organization Owner).

1. **Pair the Slack workspace.** A Slack app admin clicks "Add the Claude app" to install it in Slack from the Slack Marketplace, then sends `@Claude connect` in any channel as a top-level message (not a reply). Claude replies with a pairing code (valid 15 minutes). The Owner pastes the code into the setup page, confirms which workspace it is, and clicks "Pair workspace."

2. **Choose three tools.** The Owner selects three tools Claude should work in: GitHub (preselected), and two others from a list (Jira, Linear, Asana, Datadog, BigQuery, Snowflake, etc.) or by searching. These tools are where Claude will need credentials to act.

3. **Connect GitHub.** GitHub uses the Claude GitHub App (managed separately from credentials). If the app is already linked to the Claude organization, the Owner just selects which repositories to grant. If not linked, the setup walks through installing and linking the app. These grants apply to every channel Claude is in unless overridden per-channel later.

4. **Create accounts and connect each tool.** For each of the other two tools, the Owner creates a service account (e.g., `claude@company.com`) in each tool, then returns to the setup page and enters the credentials (API key, password, OAuth token, etc.). The credential is write-only once saved; it is never displayed again.

5. **Set a spend limit and launch.** The Owner chooses a monthly spend limit for channel work ($500–$1M, or Unlimited), optionally sends a DM to all workspace members announcing Claude Tag is live, and clicks "Launch Claude." Claude Tag is now enabled in the paired workspace.

### Authentication and credential handling

**For the organization Owner:** They authenticate to https://claude.ai with their claude.ai account and must have the Owner role in the Claude organization they're setting up.

**For the Slack admin:** Only a Slack workspace admin can run `@Claude connect` in Slack; the command issues a pairing code that expires in 15 minutes.

**For end users:** No user setup is required. Once Claude Tag is launched, any Slack user in the workspace can @mention Claude in any channel where it has been added (or use `/invite @Claude` to add it to a channel first). No one needs a Claude account, API key, or password—unless the Owner restricts access to Claude account holders (Team plan) or specific roles (Enterprise plan).

**Credential storage and injection:** Credentials are stored in Anthropic's credential store, separate from the proxy and the session sandbox. When a channel session makes an outbound request to an allowed host, the Agent Proxy (network boundary between sandbox and external systems) retrieves the credential from the store, injects it at request time, and forwards it. The sandbox itself **never holds credentials**; they are retrieved on-demand and injected at the proxy boundary.

---

## 3. Conversation Model

### Channels vs. threads vs. DMs

Claude Tag operates on three surfaces, each with different access and attribution:

#### Channels and threads (shared work)

When a user types `@Claude <task>` in a **channel or channel thread**, a session starts that runs under the **agent's own service account credentials**, not the requester's. The whole channel can see the work, and anyone in the channel can reply in the thread to steer mid-task without re-mentioning `@Claude`. 

A single thread = one continuous session that persists across replies:
- The first reply builds a sandbox for that thread.
- While the thread is idle (no new replies), the sandbox is released.
- A new reply rebuilds the sandbox from scratch but restores the thread context.
- The thread persists indefinitely; the sandbox is ephemeral.

Multiple threads in the same channel are separate sessions with separate sandboxes.

#### Direct messages (personal work)

A one-to-one DM with `@Claude` is a different surface. DMs run under the **user's own claude.ai account**, not the agent's service account. The user's personal connectors apply (GitHub, Drive, etc.), and work is attributed to them. DMs are not part of the shared access model; they are private to that user. Admins can disable DMs organization-wide.

### Session context and what Claude reads

When Claude starts a session (triggered by `@Claude` in a channel or thread), it reads:

1. **The thread itself:** Up to 50 messages from the root and oldest replies (bots' replies filtered out). In long threads, recent messages above the 50-message window fall outside what Claude sees; restate critical context.
2. **Channel history:** Pinned items in the channel. Claude does not automatically read all channel history, only what is pinned.
3. **Workspace search:** Claude can search the workspace by keyword to find public channel messages it is not a member of, the same way any Slack user can. Search results can include messages from channels Claude is not in.
4. **Guest channels:** Workspace search is blocked in any channel with a Slack guest (even if Claude is allowed to respond there). This prevents exposing content guests shouldn't see.
5. **No full history by default:** Claude does not have access to years of channel history unless it is added to the channel or reads pinned items. A one-off mention in a channel it is not in gives it only the thread it was mentioned in.

### Session lifecycle

Each session follows a fixed five-step loop:

1. **Someone tags `@Claude` with a task** in a channel or thread (or a scheduled routine triggers).
2. **A sandbox builds** on Anthropic's infrastructure, unique to that thread.
3. **The working loop runs,** with Claude working through steps, reading files, writing code, calling APIs, and updating a live checklist.
4. **The result lands in the thread** as a reply, a file, a chart, a page hosted on claude.ai, or a pull request.
5. **A quiet period follows:** The sandbox is released while the thread persists. A new reply rebuilds the sandbox.

What survives between sandbox releases:
- **Yes:** The thread, visible work, branches pushed, pull requests opened, files posted, hosted pages.
- **No:** Files that exist only in the sandbox (Claude will regenerate them if asked).

### Threading and conversation continuity

A Slack thread is one continuous conversation that maps to one persistent Claude session. Multiple people can reply in the thread, and Claude reads all replies as part of the same ongoing task. A reply from a colleague steers the active session without re-mentioning `@Claude`.

**Important:** Editing or deleting an earlier message does not steer Claude; Claude receives a notification of the edit but does not act on it. Only a new reply steers an in-progress session. This design prevents accidental redirects if someone edits a message for clarity.

**Can the session be continued elsewhere?** No. Each Slack thread is bound to that thread. A user cannot continue the conversation in another channel or in Claude Code or claude.ai chat. Pressing "Open session in Claude" shows a read-only record of the work, but follow-ups must happen in the Slack thread itself. This scoping is intentional: channel work stays shared, DM work stays private, and code work stays local.

---

## 4. Multi-User Behavior and Identity

### Who is Claude acting as?

In **channels**, Claude acts as **itself** (the agent provisioned by the Owner) under its own **service account credentials**. This is a critical design choice: when Alice asks Claude to open a GitHub pull request in `#eng`, Claude opens it under the Claude GitHub App (or the Claude service account in the system), not as Alice.

When multiple people reply in the same thread, **everyone works with the same access**. Bob can reply to Alice's thread and steer the work, and Claude uses the same GitHub credentials, the same warehouse access, etc. that Alice's request used. The access is scoped to the channel, not to the person.

### No per-user context or differentiation

Claude does not track which person asked for what. It does not build per-user memory or context. **All team members in a channel share the same agent identity and the same access.** A human who says "remember: I always want X" is actually asking Claude to remember for the channel, not for them.

This model has implications:
- Everyone in a channel sees what everyone else is doing with Claude.
- Work is auditable to the service account in each external system.
- There is no "my pull requests" separate from "our pull requests"—all PR activity is under the agent's GitHub account.
- A person's personal connectors (GitHub, Jira, etc. on their claude.ai account) do not apply in channels. Only the channel's provisioned connections apply.

### DMs preserve individual identity

In a one-to-one DM, Claude runs under the user's own account and identity. A GitHub PR opened from a DM shows the user as the author. This is the exception that proves the rule: where the user wants personal attribution, they use a DM; where they want shared, auditable, team-facing work, they use a channel.

### Approval and permissions

**In channels:** No explicit approval step. Claude acts immediately under its own service accounts. An admin can:
- Restrict which channels Claude operates in (per-scope version setting).
- Restrict who can invoke Claude (Owner/Admin role only, or organization members only, or specific role-based groups on Enterprise).
- Disable DMs organization-wide.
- Set spend limits per channel or organization-wide that will block work if exceeded.

**In external systems:** What Claude can do in GitHub, Jira, etc. is determined by the permissions of the service account it uses. If the service account is a read-only reviewer in GitHub, Claude can only review PRs, not merge them. This is the standard way to enforce guardrails: constrain the service account's role in each tool.

**In channels with guests:** By default, Claude is disabled in any channel with a Slack guest (external collaborator). An admin can turn on "Allow Claude to respond to guests" per scope, which allows Claude to reply there and guests to interact with it.

---

## 5. Context, Memory, and What Claude Knows

### Channel memory: stored and shared

Claude keeps **channel memory**, a curated set of facts and instructions saved for each channel. This is not a transcript; it is explicit, short-form reference data.

**Public channels share workspace memory:** Facts learned in `#data-eng` are available when someone asks in `#analytics`. This is automatic. An admin can view these shared facts at https://claude.ai/admin-settings/claude-tag under each scope's options menu (Owner only can edit/delete).

**Private channels keep their own memory:** What Claude learns in a private channel is stored to that channel only. It can read workspace memory (read-only) but does not contribute to it.

**How memory is saved:**
- You tell Claude: "@Claude remember: we use `acme/data-pipeline`, never `acme/website`."
- Claude learns facts on its own while working (decisions made, conventions established).
- You ask Claude to list everything it knows: "@Claude what do you remember about this channel?"
- Anyone in the channel can correct or delete a memory entry by talking to Claude.

**Per-user memory does not exist.** If you ask Claude to remember something "for you," it still saves it to the channel. Memory is collective, not personal.

### Session context per request

Within a single session (one thread), Claude reads:
- The thread messages (up to 50).
- Pinned channel items.
- Results of any workspace search it runs.

It can run code, query databases, fetch URLs (if allowed), and read files pushed to branches.

### Searchability and privacy

- **Public channels:** Claude can search public channel messages by keyword, even without being added to the channel.
- **Private channels:** Claude cannot search private channels; it reads only if it has been invited.
- **Externally shared channels (Slack Connect):** Claude does not operate in these at all.
- **Channels with guests:** Workspace search is disabled (to prevent exposing guest-inaccessible content).

---

## 6. External System Access and Connections

### What Claude can reach

An **Access bundle** is a named set of credentials and allowed hosts for a set of external systems. An Owner creates bundles at https://claude.ai/admin-settings/claude-tag under "Access bundles," then attaches bundles to scopes (channels, workspaces, or organization-wide).

#### Credential types supported

- **API keys** (Datadog, BigQuery, etc.)
- **OAuth tokens** (GitHub via the Claude GitHub App, Google Drive, etc.)
- **Service account credentials** (AWS, GCP, Azure, Snowflake, etc.)
- **Username/password** (for tools that lack OAuth or API key support)
- **Webhook URLs and custom HTTP endpoints**

#### Allowed hosts and the Agent Proxy

Outbound requests from the sandbox pass through **Agent Proxy**, a network boundary that enforces three allow layers, in order:

1. **Credentials layer:** If the destination matches a connection's allowed-websites rule, the proxy injects that connection's credential. Example: `github.com/api/*` with GitHub credentials.
2. **Domains layer:** If the destination matches the bundle's "Domains" list (without a credential), the proxy forwards the request unauthenticated.
3. **Environment network access:** If the destination is allowed by the scope's pinned environment's network access level (defaults to "Trusted," which covers package registries and developer tools), the proxy allows it without a credential.

**Default-deny:** If the destination matches none of these, the request is blocked.

**No protocols other than HTTP/HTTPS:** SSH, direct database connections (e.g., MySQL native protocol), and other protocols cannot cross the proxy, even to allowed hosts.

#### Organization-level network allowlist

An Owner can set an organization-wide environment with "Full" network access (allow-all egress), or "None" (block-all). This is done at https://claude.ai/code under the "Environments" section, separate from Claude Tag settings. Private/internal network addresses and cloud metadata endpoints are always blocked regardless of this setting.

**Web search:** Claude has Anthropic's built-in web search tool, which runs server-side on Anthropic's infrastructure. It does not count as an outbound request from the sandbox, and the network allowlist does not govern it. A search is always allowed; fetching a page Claude found via search is a separate outbound request that follows the proxy rules.

### Scope and inheritance

Access bundles are attached at three scopes:

1. **Specific channel:** Applies only to that channel.
2. **Workspace:** Applies to every channel in that workspace.
3. **Default Slack access:** Organization-wide; applies to every channel in every paired workspace.

**Inheritance:** A channel session reads bundles attached to (1) its channel, (2) its workspace, and (3) the default scope. Bundles attached elsewhere are invisible.

**Example:** If you attach a bundle with finance credentials to a private channel only, every other channel in the organization acts as if that credential does not exist. If you later move the same bundle to workspace-level, every channel in that workspace gains that access.

**Isolation by channel:** To confine a credential to one channel, attach its bundle there and nowhere else, keep the channel private, and check the channel's "Access summary" in admin settings to verify it inherited nothing broader.

---

## 7. Approvals, Controls, and Governance

### What admins can control

An **Owner** can:
- Enable/disable Claude Tag organization-wide (toggle at the top of the admin page).
- Pair or disconnect Slack workspaces.
- Create, edit, delete Access bundles.
- Attach bundles to scopes.
- Set organization-wide spend limits.
- Set per-channel spend limits.
- Restrict who can invoke Claude (by organization membership or role).
- Allow or disable DMs.
- Allow or restrict Claude in guest channels.
- Set the Claude Tag version per scope (On/Off/Legacy for backward compatibility).

An **Admin** can:
- Edit a bundle's Credentials or Domains tabs (add/remove hosts, change credentials).
- View bundles and connections (read-only access to most settings).
- Edit channel memory in the channel itself.

A **channel member** can:
- Mention `@Claude` to start a session.
- Reply in a Claude thread to steer mid-task (anyone, not just the originator).
- Create, list, or disable scheduled routines in the channel.
- Edit channel instructions via the "Configure" link in Claude's replies (unless restricted).

### What admins cannot control

**Absent controls:**
- Per-user spend caps on channel work (only organization and channel levels).
- Per-channel allowlist of who can invoke Claude (only organization-wide or role-based).
- Renaming or rebranding the app in Slack (fixed).
- Pre-invite channel blocklist (anyone can `/invite @Claude` once the app is installed, but you can disable Claude Tag per-channel after the fact).
- Session length enforcement (Slack's session timeout does not apply here).
- Read-scope confinement (Claude can search public channels even if not added; no toggle to disable this).
- Web search toggle for channels (always on; separate from claude.ai's web search setting).

### Spend limits and usage

Channel work draws from an **organization-wide usage balance** (Team and Enterprise plans alike, though Enterprise invoices). On a Team plan, this balance must be funded with credits before Claude Tag responds.

A **spend limit** is a cap on how much of the balance can be used per month. The limits available are $500, $1,000, $2,500 (default), $5,000, Unlimited, or a custom amount up to $1M.

- **Organization limit:** Caps total Claude Tag usage across all channels.
- **Per-channel limit:** Caps usage in that channel (in addition to the org limit).

If a request would exceed a limit, it is declined (not truncated), and the user is notified. They can request more usage from an admin in Slack.

**DMs are not capped by this limit:** A DM runs on the user's own claude.ai seat and follows the seat's usage limits (if any).

**Usage analytics:** Per-channel breakdown available at https://claude.ai/admin-settings/usage/claude-tag.

### Audit and accountability

An Owner can review Claude Tag activity at https://claude.ai/admin-settings/claude-tag under "Audit." The audit trail shows:

- What work was done in each channel or routine.
- Who initiated it (the Slack user who tagged Claude, or the routine name).
- What external systems were reached and by which service account.
- How much usage was consumed.

Results and intermediate work are stored as **session transcripts** (readable record of the session) and **channel memory** (curated facts). Both can be viewed or deleted by an Owner per scope.

---

## 8. Artifact Publishing and Sharing

Claude can publish **artifacts**, web pages hosted on claude.ai and linked in the thread. These pages stay available after the session ends and can be updated by Claude when you ask.

**Visibility:** Anyone with access to the source Slack channel can open the artifact link. In a public channel, this means everyone in the workspace. Someone without access sees a "request access" prompt.

**No per-artifact sharing settings:** Unlike Claude Code artifacts (which belong to you and have sharing options), Claude Tag artifacts are governed entirely by channel membership. No one can change who sees them—that is determined by who can see the channel.

**Updates:** Changes go through Claude in the Slack thread, not through a share or direct link.

---

## 9. Limitations and Constraints

### Supported plans and deployments

- **Team and Enterprise plans only.** Available on claude.ai only; not on Free, Pro, or Max plans. Not available through third-party deployments (Bedrock, Vertex AI, Foundry, self-hosted Claude).
- **Requires Slack:** Claude Tag is Slack-native; no equivalent for Teams, Discord, or other chat platforms (as of this writing).
- **No Zero Data Retention (ZDR).** Organizations with ZDR enabled cannot use Claude Tag because it stores channel memory and session transcripts.

### Usage and compute

- **Usage-based billing:** Channel work is billed by token use, drawn from a shared organization balance. DMs bill to the individual seat.
- **Ephemeral sandboxes:** Each thread gets a fresh sandbox. Work persists only if pushed to a branch, posted as a PR, or posted in Slack.
- **No guaranteed compute continuity:** Long-running tasks are split into turns by Slack's reply pattern, so progress is saved to the thread and the sandbox is rebuilt per reply.

### Scope and integration

- **Slack-only surface:** The work happens in Slack channels and threads. No API for programmatic access or external triggering (beyond scheduled routines set in Slack itself).
- **External system credentials required:** To act in GitHub, Jira, etc., the service account must have credentials and be granted access in those systems. This is the same model as any agent; there are no novel integrations.
- **No local execution:** Nothing runs on your machine or inside your network. Compute is always on Anthropic's infrastructure.

### Per-user and per-workspace

- **No per-user spend caps in channels.** Spend limits apply organization-wide and per-channel, not per individual. An individual can be restricted from using Claude altogether, but not capped per-person within a channel.
- **No per-user memory.** Channel memory is collective, not personal.
- **Enterprise Grid complexity:** In a Slack Enterprise Grid with multiple workspaces connected to different Claude organizations, one organization's settings govern the entire grid (no per-workspace override).

### Workflows not supported

- **Externally shared channels (Slack Connect).** Claude does not operate in channels shared with external companies.
- **Channels with guests (default off).** By default Claude is disabled where external guests are present (can be overridden per-scope).
- **Group DMs.** Only one-to-one DMs; group DMs are not supported.
- **Third-party chat platforms.** No Discord, Teams, or Telegram integration at this time.

---

## 10. Key Design Decisions and Tradeoffs

### Service account over user impersonation

**Design:** Claude acts as itself (the provisioned agent identity) in channels, not as the requester.

**Why:** Auditable, shared access. Everyone sees what the agent did, and credentials are not tied to a person. A credential can be revoked or rotated without affecting a person's account.

**Tradeoff:** No personal attribution in channels. A PR opened by Claude shows the Claude GitHub App as author, not the Slack user who asked. If personal attribution is important, use a DM (work is then attributed to you).

### Shared access per channel

**Design:** Everyone in a channel sees and can use the same credentials, connections, and access.

**Why:** Predictability and configuration simplicity. Setup once, everyone benefits. No confusion about who can access what—it's the channel's access, not anyone's personal access.

**Tradeoff:** Less fine-grained control. A person cannot have access to a tool that the channel doesn't; personal connectors don't apply in channels (only in DMs).

### Persistent threads, ephemeral sandboxes

**Design:** A Slack thread persists indefinitely, but the compute sandbox is rebuilt per reply cycle.

**Why:** Resilience. If compute fails mid-task, the sandbox rebuild is clean and doesn't corrupt thread state. Results are saved to the thread as they finish, not held in the sandbox.

**Tradeoff:** No in-sandbox cache between replies. Large files must be re-read or pushed to a branch to avoid regenerating.

### Default-deny network egress

**Design:** Outbound requests from the sandbox are blocked unless explicitly allowed via credentials, a domains list, or an environment network access setting.

**Why:** Containment. The agent can only reach systems an admin has vetted and configured.

**Tradeoff:** Every new external system requires admin configuration. There is no "let Claude reach the open internet" switch (though an admin can set a Full network access environment or use allow-all egress, both off by default).

---

## 11. Comparison: Claude Tag vs. Claude Code vs. Cowork

| Aspect | Claude Tag | Claude Code | Cowork |
| --- | --- | --- | --- |
| **Where** | Slack channels/threads | Your terminal, IDE, or web | Claude.ai chat |
| **Who sees work** | The whole channel | Just you | Just you |
| **Whose identity** | Agent's service accounts | You | You |
| **Whose access** | Channel's configured connections | Your local creds/MCP servers | Your personal claude.ai connectors |
| **Attribution** | Service account (GitHub app, etc.) | You | You |
| **Setup needed** | Admin setup once; users just @mention | None; run in your local machine | Connect your personal accounts |
| **Best for** | Shared, team-visible work | Local coding and scripting | Personal research and drafting |

---

## 12. Open Questions for Deeper Research

1. **Session routing and scalability:** How does Claude Tag handle multiple simultaneous threads in the same channel? Are sandboxes created on-demand or pooled? What is the latency between mention and first response?

2. **Scheduled routines and observability:** How do scheduled tasks (set via "Set up routines") report status or errors? Do they post results to the channel, or is there a separate audit trail? Can a routine be paused or rolled back mid-execution?

3. **Artifact update mechanics:** When Claude updates a published artifact mid-thread, how does it determine what to update? Is it the most recent artifact, or can it update multiple artifacts in one thread?

4. **Workspace memory retention and TTL:** How long is workspace memory retained? Is there a TTL, or is it indefinite until an admin deletes it? How does a private channel's memory behave if the channel is later archived?

5. **Cross-workspace memory:** Can Claude reference memory from one paired Slack workspace while working in another? Or is memory isolated per workspace?

6. **Credentials and CI/CD:** Can Claude create or rotate credentials in external systems (e.g., GitHub tokens, database passwords)? Or does it only read/use existing credentials?

7. **Third-party deployments timeline:** Is Claude Tag planned for Bedrock, Vertex AI, or self-hosted deployments? If so, what is the timeline?

8. **Discord, Teams, Telegram support:** Are there plans to add Claude Tag to other chat platforms, or is Slack exclusive?

9. **MCP integration:** Does Claude Tag support MCP (Model Context Protocol) servers, or only the built-in Anthropic integrations (GitHub, Google Drive, etc.)?

10. **Escalation and human-in-the-loop:** Can a session pause and ask for human approval before executing a dangerous action (e.g., before merging a PR or running a destructive query)? Or is all work automatic?

11. **Token limits and context windows:** What is the maximum context window per session? Are there per-turn limits on how much Claude can read or generate?

12. **Custom instructions and guardrails:** Can channel-level instructions include guardrails (e.g., "never merge PRs without approval," "never delete customer data")? How are these enforced?

13. **Billing and cost visibility:** Is there per-request cost visibility, or only aggregate monthly bills? Can a user see how much their request cost?

14. **Integrations beyond Slack:** Can Claude Tag be triggered from outside Slack (e.g., a GitHub webhook that mentions Claude in a Slack channel)?

---

## Sources

- [Claude Tag Overview](https://claude.com/docs/claude-tag/overview.md)
- [How Claude Tag works](https://claude.com/docs/claude-tag/concepts/how-it-works.md)
- [How agent identity works](https://claude.com/docs/claude-tag/concepts/agent-identity.md)
- [Security and data handling](https://claude.com/docs/claude-tag/concepts/security-and-data.md)
- [Set up Claude Tag](https://claude.com/docs/claude-tag/admins/setup-overview.md)
- [What Claude Tag remembers](https://claude.com/docs/claude-tag/users/memory.md)
- [Restrict where Claude Tag operates](https://claude.com/docs/claude-tag/admins/restrict-access.md)
- [Claude Tag documentation index](https://claude.com/docs/llms.txt)


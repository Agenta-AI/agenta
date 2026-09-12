# Verifications of challenged claims

Two claims from the competitive research were challenged in review. Both were checked against primary sources (Anthropic's Claude Tag documentation and Gumloop's documentation and changelog) on 2026-07-20. Verdicts: the research was right about Claude Tag's channel credential model, with one nuance the reviewer correctly sensed (DMs use personal credentials); the reviewer was right about Gumloop's approval buttons, which shipped in June 2026.

## Claim 1: Claude Tag credentials — shared service accounts or the invoking user's?

**Verdict: our research is right for channels; the reviewer is right only for DMs. The truth is a clean split, and Anthropic documents it explicitly.**

### Evidence

Anthropic's Claude Tag documentation has a dedicated concepts page, "How agent identity works" (https://claude.com/docs/claude-tag/concepts/agent-identity), whose summary line settles the question directly:

> "Claude Tag acts under its own service accounts in Slack channels, not as you. See how channel access is bounded, how credentials reach it, and why DMs differ."

For channels, the page states:

> "In Slack channels, Claude acts with its own service accounts, rather than as a specific user. An organization Owner provisions this identity during setup, so it arrives with its own account in each system it works in: the Claude app in Slack, the Claude GitHub App on GitHub, and a service account in every other connected tool."

The page rules out any use of personal connectors in channels, in exactly the terms of the disputed claim:

> "**Personal connectors apply in DMs.** A shared channel uses only the service-account connections an admin attached, not connectors on anyone's claude.ai account."

and:

> "**Predictability.** What Claude can do never changes based on who asked."

For DMs, the same page:

> "A DM with Claude works differently from a channel. There is no scope to attach an identity to, so a DM session runs with your own claude.ai account instead, the same way a Claude Code session on the web does, using your own connectors and credentials, with results attributed to you."

The page includes a comparison table: in a channel Claude "acts as" its own service accounts with access from "the channel's Access bundles"; in a DM it acts as "you" with access from "your personal connectors", and billing shifts from the organization to the user's seat. The security page (https://claude.com/docs/claude-tag/concepts/security-and-data) repeats the split under its "Service accounts" heading:

> "In channels, Claude acts under service credentials of its own, not under the account of the person who tagged it. The Slack surface is the Claude app, code work goes through the Claude GitHub App, and every other connected tool uses a service account an Owner provisions in an Access bundle."

> "DMs with `@Claude` run on the user's own claude.ai account instead, with that user's personal connectors, and work there is attributed to them. Personal connectors apply only in DMs, never in channels."

On scoping, the security page confirms credentials are scoped to channel, workspace, or organization, exactly as our research said: "A channel session can use only the Access bundles attached in one of three places: The channel itself. ... The channel's workspace. ... Default Slack access. The organization-wide root" (https://claude.com/docs/claude-tag/concepts/security-and-data, "Isolate credentials between channels"). The overview page (https://claude.com/docs/claude-tag/overview) adds: "An Owner configures these per scope (a channel, a workspace, or the whole organization), separately from any connectors an individual user has set up in their own claude.ai account" and "What it can reach depends on the channel you're in, not on who you are."

On the two permission layers the reviewer may have conflated: Slack-side reading permissions are a separate mechanism from external-tool credentials. For Slack data, Claude Tag "can read and post in Slack channels it's been added to and search public channels by keyword" (security page) — that is app-membership-based, not user-based, and by default "anyone in a connected Slack workspace can invoke Claude in channels, with or without a Claude account." External-tool credentials (GitHub, Jira, warehouses) are the admin-provisioned Access bundle credentials described above, injected by Agent Proxy at the network boundary: "Agent Proxy retrieves it only at the moment of injection and attaches it to the request at the boundary, so the model and the sandbox itself are not given the key" (agent-identity page).

On the "no approval step" part of the claim: no per-action approval gate appears anywhere in the Claude Tag documentation. The documented control model is preventative (allowlists, credential scoping, spend limits), not per-action confirmation; the request path is described as fully automatic ("Agent Proxy attaches a credential ... The credentialed request reaches your system"), scheduled jobs "run with the channel's credentials" unattended, and the "Controls that aren't available" list on https://claude.com/docs/claude-tag/admins/restrict-access contains no approval control either. This is confirmation by documented design plus absence, not an explicit "there are no approvals" sentence, so treat the strong form ("Anthropic states there is no approval step") as **[unverified]**; the accurate form is that no approval step is documented and the documented request path has none.

One likely source of the reviewer's belief: **Claude Code in Slack**, the adjacent product that Claude Tag is replacing, genuinely does run under the invoking user's identity. Its docs (https://code.claude.com/docs/en/slack) say "Each session runs under your own Claude account, using your connected repositories and your plan limits" and "Each user runs sessions under their own Claude account." The same page carries a migration note that draws the contrast: "Claude Tag runs @Claude as your organization's shared identity with admin-configured access." The agent-identity page even gives the tell for distinguishing them: "If `@Claude` in your workspace opens pull requests as you, you're seeing Claude Code in Slack, not a Claude Tag session."

### Corrected statement for the research

In Slack channels, Claude Tag acts under its own admin-provisioned service accounts, never under the invoking user's credentials. An organization Owner provisions an identity made of "Access bundles" (credentials, repositories, allowed domains) and attaches them at channel, workspace, or organization scope; every member of a covered channel gets the same capability ("What Claude can do never changes based on who asked"), personal claude.ai connectors "apply only in DMs, never in channels," and actions in connected tools are attributed to the service accounts (for example, pull requests author as the Claude GitHub App). Credentials never enter the sandbox; Anthropic's Agent Proxy injects them at the network boundary against admin-configured allowlists. The one exception is direct messages: a DM session runs on the sender's own claude.ai account with their personal connectors, is attributed to them, and bills their seat rather than the organization. No per-action approval step appears in the documented channel flow; governance is preventative (credential scoping, domain allowlists, spend limits) rather than confirm-per-action. Note the contrast with the adjacent Claude Code in Slack product, which does run each session under the invoking user's own account — a likely source of confusion between the two models.

## Claim 2: Gumloop in-channel approval buttons

**Verdict: the reviewer is right. Gumloop has documented Approve/Reject buttons that resolve directly inside Slack. The feature shipped in June 2026, so research done before then would have been correct at the time.**

### Evidence

Gumloop's Human in the Loop documentation (https://docs.gumloop.com/core-concepts/human_in_the_loop) describes in-Slack resolution explicitly:

> "approval buttons appear directly in the Slack thread. You get Approve, Reject, and Open in Gumloop buttons right in Slack."

> "If you are not watching the thread, you also receive a Slack DM so nothing gets missed."

The "Open in Gumloop" button is an optional deep link for full context ("Click Open in Gumloop to see the full context in the web app"), not the resolution path; approval and rejection complete from the Slack message itself. The docs also describe a persistent auto-approve option: checking a box before approving means "Future calls to the same tool will be auto-approved without asking."

The Gumloop changelog (https://www.gumloop.com/changelog) dates the feature precisely:

- v10.0.0, June 16, 2026: "Agents can now loop you in mid-task. They can pause to ask for approval before running a tool, or ask a question with options to choose from, then pick up right where they left off once you respond."
- v10.2.0, June 22, 2026: "Fixed human-in-the-loop approvals not reaching custom Slack apps. Add an interactivity URL to your Slack app to turn it on."

The v10.2.0 entry confirms the approvals are delivered through Slack interactivity (that is, real interactive buttons in Slack messages), including on customer-provided custom Slack apps.

### Corrected statement for the research

Gumloop has human-in-the-loop approvals that resolve directly inside Slack, shipped June 16, 2026 (v10.0.0) and extended to custom Slack apps on June 22, 2026 (v10.2.0). An agent pauses before a sensitive tool call and shows the tool, arguments, and intent; for Slack-connected agents, Approve, Reject, and Open in Gumloop buttons appear in the Slack thread (with a fallback Slack DM if the requester is not watching the thread), and the approval or rejection completes from the Slack message without opening the web app. A checkbox at approval time auto-approves future calls to the same tool. Our earlier statement that Gumloop had no documented in-channel approval buttons is now wrong; it described the pre-June-2026 state.

## Sources

- https://claude.com/docs/claude-tag/concepts/agent-identity
- https://claude.com/docs/claude-tag/concepts/security-and-data
- https://claude.com/docs/claude-tag/overview
- https://claude.com/docs/claude-tag/admins/restrict-access
- https://code.claude.com/docs/en/slack
- https://docs.gumloop.com/core-concepts/human_in_the_loop
- https://www.gumloop.com/changelog

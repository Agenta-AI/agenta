# MCP release decisions

Status: product direction confirmed by Mahmoud on 2026-09-15. Implementation and release evidence remain pending. This document governs release scope where earlier design alternatives differ. It does not close unresolved code-review findings in open-reviews.md.

## Product decisions

| Area | Confirmed direction | Work remaining |
| --- | --- | --- |
| Release order | Ship our MCP gateway with OAuth first. Keep the new LLM gateway and wallet behavior behind flags. | Prove independent enablement and unchanged existing model/starter-credit behavior. |
| MCP implementation | Keep Agenta's own MCP gateway. Withdraw LiteLLM MCP replacement work. | Complete compatibility, permissions and recovery tests. |
| Account identity | Multiple accounts at one server are separate project connections. Use existing stable IDs/slugs. Names are editable. | Bind consent, grants, refresh and disconnect to the selected connection rather than project plus URL. |
| Agent selection | Interactive and scheduled runs use their configured connection. | Verify persisted references and project access. |
| Future ownership | Optional user scope is later work. | Avoid making a later ownership extension require changing connection identity. |
| Connection experience | One Connect journey, like integrations, with MCP URL as the extra input. After connecting, open the connection to inspect tools and change permissions. | Implement the target flow in mcp-connection-ux.md. |
| Permissions | Individual ask/deny/allow with the existing runner approval experience. | Prove discovery and execution carry the same per-tool policy. |
| Audit and recovery | Small useful audit fields and thorough recovery tests. | Add available method/tool/duration/correlation context without secrets. |
| Model adapter | Keep the current adapter. Evaluate LiteLLM SDK for LLM calls alongside later work. | Compare actual bugs, compatibility and maintenance; adoption remains undecided. |
| Wallet | Later integrate usage and production pricing with the existing Agenta wallet. | Preserve organization and charge identity; migrate remaining starter credit and purchases. |
| Deferred | Buffering/POST transport redesign, separate gateway processes, extra OAuth/storage interfaces, background refresh machinery, wallet reservations and new audit infrastructure. | Do not expand the MCP release to implement these. |

The eight closed architecture discussions record decisions, not completed implementation. Per-tool MCP permission wiring remains a technical validation task. The phrase about MCP with LiteLLM was corrected by Mahmoud: LiteLLM SDK testing concerns only the LLM gateway.

## Evidence and assumptions

The settings component currently has distinct creation/editing and connection handlers. The MCP SDK models have a tool filter and server permission, while the runner's Composio policy uses a per-tool execution gate. The existing passthrough model adapter includes credential guards, incremental stream usage and shielded response cleanup. These observations were inspected at 40ee5b8be4f10b0cfd8a5ae51ebaf0b002fa82e0; they are not new runtime test results.

Wallet observations came from fef84e911888cb8a4d084a2f641ed516319750a1 on the separate wallet work: pricing was a fixture. Refresh both branches before later integration; do not treat wallet files as present on this PR.

Automatic connection naming and authentication discovery are implementation recommendations with fallback behavior specified below, not a promise that every MCP server exposes enough metadata.

## Reading order

1. [Connection experience](mcp-connection-ux.md).
2. [Autonomous handoff](MCP-RELEASE-HANDOFF.md).
3. [QA and release gate](mcp-release-gate.md).
4. [Execution status](mcp-release-status.md).
5. Existing [code-review findings](open-reviews.md), including the real end-to-end evidence gap. Every unresolved finding still needs disposition.

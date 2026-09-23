# Channels specification evidence

Captured on 2026-09-20. This document supports the baseline and proposed change. It does not claim that the proposal has been implemented or tested in Slack.

## Source boundary

The baseline describes [PR #6737](https://github.com/Agenta-AI/agenta/pull/6737), branch `channels/telegram-ui`, at `658d6f5edae34d861d141a38604ef7a12a7b69c8`. Its base is `channels/telegram-hosted`. The foundational [PR #6644](https://github.com/Agenta-AI/agenta/pull/6644), branch `feat/channels`, remains at `f725917965766dafb50e78eca55ce35e6e751122`.

The docs are added at the effective stack tip because they describe its shared agent-page UI as well as the underlying backend. Mahmoud confirmed that the channels stack has not shipped to production. The baseline records pre-release code; it does not establish backward-compatibility obligations. No application files changed in the specification commits.

## Baseline traceability

| Capability and requirement | Source at reviewed head | Observation |
| --- | --- | --- |
| Installation ownership | [Connection and agent constraints](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/dbs/postgres/channels/dbes.py#L22-L66), [agent relationship](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/dtos.py#L545-L556), [Slack identity](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/capabilities.py#L28-L39) | Several agents can share a connection. The installation key is globally unique, not project-scoped. |
| Shared scope list | [Manifest](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/manifest.py#L12-L49), [OAuth](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/oauth.py#L22-L48) | Both use the same bot scopes. The three native-address scopes are absent. |
| Signature and access checks | [Signature verification](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L223-L241), [resolution](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/service.py#L1438-L1574) | Connection, sender, space, agent, and grant checks are separate from addressing. No grants means unrestricted by grants. |
| Explicit addressing | [Slug parser](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/mapping.py#L6-L35), [event normalization](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L291-L318) | The adapter recognizes `~slug` and `app_mention`, not user-group IDs. |
| Conversation and pending-choice precedence | [Resolution call order](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/service.py#L1514-L1535), [selection helpers](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/service.py#L1696-L1810) | A pending choice and existing conversation can win before ordinary addressing. An explicit slug bypasses the conversation helper. |
| Bot echo filtering | [Subtype and author filters](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L262-L289) | Bot messages, edits, deletions, and unsupported subtypes are dropped. |
| Reply identity | [Slack post and edit](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L322-L366), [adapter contract](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/interface.py#L160-L186) | No sender profile, `username`, or `icon_url` is passed. |
| Progress and answer delivery | [Outbox send path](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/tasks/asyncio/channels/outbox.py#L470-L534) | The thread provides the first target; subsequent updates use the stored receipt. |
| Deployment action | [Answering agent selection](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/packages/agenta-settings-ui/src/channels/actions.ts#L140-L145), [retarget action](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/packages/agenta-settings-ui/src/channels/actions.ts#L208-L240) | Connecting another application edits the selected row. |
| Connection presentation | [Row ranking](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/packages/agenta-settings-ui/src/channels/actions.ts#L449-L462), [desktop host](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/oss/src/components/pages/overview/agent/AgentChannelsCard.tsx), [mobile host](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/mobile/src/features/agents/AgentChannelsCard.tsx) | Both hosts use shared actions that select one row per platform. |
| Permission controls and disconnect | [Grant target and behavior](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/packages/agenta-settings-ui/src/channels/actions.ts#L242-L342), [disconnect](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/web/packages/agenta-settings-ui/src/channels/actions.ts#L526-L530) | Grants target the answering agent. Disconnect archives the connection. |

## Channel agent tools traceability

| Capability or constraint | Source at reviewed head | Observation |
| --- | --- | --- |
| Platform tool configuration | [PlatformToolConfig](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/sdks/python/agenta/sdk/agents/tools/models.py#L448-L467), [platform resolver](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/sdks/python/agenta/sdk/agents/platform/platform_tools.py#L53-L140) | A configured platform operation becomes an authenticated direct call to an existing Agenta endpoint. The model receives the catalog schema, not credentials or endpoint ownership fields. |
| Hidden caller identity | [PlatformOp context bindings](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/sdks/python/agenta/sdk/agents/platform/op_catalog.py#L152-L319), [run workflow identity](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/sdks/python/agenta/sdk/agents/dtos.py#L528-L613) | Context bindings remove self-target fields from the model schema and fill them from run context. Workflow artifact, variant, and revision identity exist. A stable tool-call identity does not yet exist. |
| Tool execution permission | [Permission resolution](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/sdks/python/agenta/sdk/agents/tools/models.py#L142-L165) | Explicit per-tool permission wins. Under `allow_reads`, a `read_only` operation is allowed and an unmarked write asks. |
| Connected agent identity | [ChannelAgent references](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/dtos.py#L328-L370), [ChannelAgent relation](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/dtos.py#L545-L556) | A channel agent stores workflow or application references and belongs to one connection. The proposed tool endpoint can resolve the running workflow to these deployments rather than accept an agent ID from the model. |
| Channels API access | [Authenticated route check](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/apis/fastapi/channels/router.py#L507-L515), [space discovery route](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/apis/fastapi/channels/router.py#L360-L378) | Configuration routes derive project and user from the request. Agent-facing execution routes do not yet exist. |
| Current Channels policy | [ChannelPolicy](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/dtos.py#L305-L320), [ChannelGrant](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/dtos.py#L668-L718) | Policy covers triggers, session scope, backfill, and forward fill. Grants allow or deny an agent by space or kind. They do not distinguish reply, search, proactive send, or direct-message initiation. |
| Thread-bound outbound path | [Session-to-thread lookup](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/tasks/asyncio/channels/outbox.py#L105-L139), [delivery service stubs](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/service.py#L1939-L1946) | The worker ignores a session with no ChannelThread. The intended `enqueue_output` and `deliver` service boundary is not implemented. |
| Provider posting | [Slack post and edit](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L322-L366), [adapter idempotency contract](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/interface.py#L160-L186) | Adapters already accept a locator, content, and idempotency key and return a receipt. Slack does not send the idempotency key to `chat.postMessage`, so a lost receipt still leaves duplicate-post risk. |
| Slack history | [Default backfill limit](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L52-L54), [history fetch](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/slack/adapter.py#L431-L476) | Slack can fetch one conversation or thread. The default fetch is capped at 50. There is no continuously maintained, permission-filtered search index. |
| Telegram discovery and history | [Telegram discovery and history](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/api/oss/src/core/channels/adapters/telegram/adapter.py#L395-L417) | The bot cannot list chats or fetch historical messages. Chats self-register on an observed event, and search can cover only retained observed events. |
| Existing recurring scheduler | [create_schedule platform operation](https://github.com/Agenta-AI/agenta/blob/658d6f5edae34d861d141a38604ef7a12a7b69c8/sdks/python/agenta/sdk/agents/platform/op_catalog.py#L1748-L1758) | Agenta can schedule a workflow run. Channels has no separate exact-message intent, cancellation path, or due-delivery operation. |

## Provider documentation for channel tools

- [conversations.open](https://docs.slack.dev/reference/methods/conversations.open): Slack can open or resume a direct or multi-person conversation. The proposed direct-message setup must verify the token type, required scope, recipient rules, and returned channel in a live workspace.
- [conversations.history](https://docs.slack.dev/reference/methods/conversations.history) and [conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies): History reads are paginated and subject to membership, token, scope, and rate limits. Backfill coverage cannot be assumed complete.
- [Telegram Bot API](https://core.telegram.org/bots/api): The API exposes updates and send methods, but no general method to enumerate joined chats or retrieve arbitrary chat history. The Telegram adapter therefore declares both operations unsupported.

## Slack documentation

These pages were read for the specification. They establish API constraints, not successful live behavior of Agenta.

- [usergroups.create](https://docs.slack.dev/reference/methods/usergroups.create): Bot and user tokens support `usergroups:write`. Names and handles have uniqueness rules. Workspace permissions can refuse creation. Paid plans are required. Organization-token calls require the target team.
- [usergroups.users.update](https://docs.slack.dev/reference/methods/usergroups.users.update): “You cannot use this method to remove all members from a user group.” It also states that bot users and guests cannot be added. Its permission guidance distinguishes bot tokens from authorized user tokens.
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage): `chat:write.customize` permits `username`, `icon_url`, and `icon_emoji`. Customized posting must follow initiating user action and not surprise the user.
- [chat.update](https://docs.slack.dev/reference/methods/chat.update): The documented update fields do not include sender name or avatar overrides. Set identity at the initial post and verify edit behavior live.

The previous conversation supplied ChatGPT Workspace Agents as the desired comparison. This package does not independently verify OpenAI's implementation. The specs stand on the requested behavior, reviewed Agenta code, and Slack's documented interfaces.

## Test locations

Existing tests provide extension points. Their presence is not a pass result for this change.

- `api/oss/tests/pytest/unit/channels/slack/test_slack_adapter.py` and `test_slack_mapping.py` cover adapter behavior and parsing.
- `api/oss/tests/pytest/unit/channels/slack/test_slack_contract_suite.py` covers the common adapter contract.
- `api/oss/tests/pytest/unit/channels/test_channels_resolve_policy.py` and `test_channels_grant_evaluation.py` cover admission behavior.
- `api/oss/tests/pytest/unit/channels/test_channels_slack_install_routes.py`, `test_channels_slack_hosted_lifecycle.py`, and `test_channels_install_connection.py` cover installation paths.
- `api/oss/tests/pytest/unit/channels/test_channels_outbox_worker.py` covers first post, progress, final edits, retries, and pending interactions.
- `api/oss/tests/pytest/acceptance/channels/test_slack_adapter_live.py` is the existing live Slack test entry point.
- Add focused tests for `web/packages/agenta-settings-ui/src/channels/actions.ts`. No existing tests for `buildAgentChannelsActions` were found in this checkout.

## Tool provenance and verification boundary

OpenSpec 1.13.1 was already cached in the product workspace from earlier work. Its package is `@fission-ai/openspec`, published by the [official OpenSpec project](https://github.com/Fission-AI/OpenSpec). The cached archive matches npm's SHA-512 integrity value:

```text
sha512-UHJSV2n6ohjfRaJLvi526avOohFS/orCjM+7JPgvDzuEJbCCkykKfP2fp3gcsvthDLeWolMRT5JAE08MSPnr8Q==
```

This package follows the bundled `openspec-propose` skill workflow and CLI-generated instructions for the `spec-driven` schema. The repository was initialized with no editor-specific skills or application dependency changes. The proposal remains open; it has not been applied or archived.

Validation covers OpenSpec structure, delta targets, local links, and documentation scope. It does not run application tests, create Slack groups, change scopes, or prove runtime behavior.

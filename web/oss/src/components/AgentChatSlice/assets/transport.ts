import {DefaultChatTransport, type UIMessage} from "ai"

import {resolveAppAgConfig} from "./agConfig"
import {type AgentChatTrack, trackApi} from "./constants"
import {toAgentaMessages} from "./toAgentaMessage"

/**
 * Transport for the agent chat slice (contract v1), parameterized by request-contract
 * **track**. Both tracks consume the same v6 UI Message Stream response — only the
 * outgoing request body shape differs (see ./constants and ./toAgentaMessage).
 *
 * Shared S3-contract passthrough: `ag_config` (workflow config) + `references`
 * (app/variant/revision refs) + `session_id` (the useChat chat id). When the page is
 * app-scoped and `appId` is given, these are resolved from the app's LATEST revision via
 * `resolveAppAgConfig` (real config); otherwise we fall back to `stubConfig()`. Query
 * params (`application_id`, `project_id`) and `Authorization` are still out of scope for
 * the slice — they ride the execution-item builder during full integration.
 *
 * **Track A (`uimessage`)** — POST the `UIMessage[]` verbatim. The service speaks AI SDK
 * parts; the approval decision is inside the assistant message's tool part. Zero FE
 * translation (JP's "1:1 to UIMessage parts, no translation layer").
 *
 * **Track B (`agenta`)** — adapt to Agenta's `{role, content}` + `tool_calls` shape via
 * `toAgentaMessages`, with the approval decision in a `tool_approvals` side field. Uniform
 * backend contract across workflow types, at the cost of a FE translation layer.
 */
const stubConfig = () => ({
    ag_config: {
        prompt: {
            messages: [{role: "system", content: "You are a helpful agent."}],
            llm_config: {model: "gpt-4o-mini", tools: []},
        },
        harness: "pi",
        sandbox: "local",
    },
    references: {
        application: null,
        application_variant: null,
        application_revision: null,
    },
})

/**
 * Real config from the app's latest revision when `appId` is set and loaded; else the stub.
 * `harness`/`sandbox` (agent-specific, not part of a stored workflow config) are defaulted
 * but never override values the resolved config already carries.
 */
const configFor = (appId?: string | null) => {
    const resolved = resolveAppAgConfig(appId)
    if (!resolved) return stubConfig()
    return {
        ag_config: {harness: "pi", sandbox: "local", ...resolved.ag_config},
        references: resolved.references,
    }
}

export function createAgentChatTransport(track: AgentChatTrack, appId?: string | null) {
    return new DefaultChatTransport<UIMessage>({
        api: trackApi(track),
        prepareSendMessagesRequest: ({messages, id, body}) => {
            const config = configFor(appId)

            if (track === "agenta") {
                // Track B: FE adapts down to the existing Agenta message contract.
                const {messages: agentaMessages, tool_approvals} = toAgentaMessages(messages)
                return {
                    body: {
                        messages: agentaMessages,
                        tool_approvals,
                        ...config,
                        session_id: id,
                        ...body,
                    },
                }
            }

            // Track A: post the UIMessage[] verbatim — the service speaks parts.
            return {
                body: {
                    messages,
                    ...config,
                    session_id: id,
                    ...body,
                },
            }
        },
    })
}

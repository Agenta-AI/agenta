import {DefaultChatTransport, type UIMessage} from "ai"

import {resolveAppAgConfig} from "./agConfig"
import {agentChatApi} from "./constants"

/**
 * Transport for the agent chat slice — a client for the RFC `POST /messages` contract
 * (`docs/design/agent-workflows/agent-protocol-rfc.md`). It posts the RFC envelope:
 *
 *   { session_id, references?, data: { messages: UIMessage[], parameters } }
 *
 * `data.messages` is the `useChat` `UIMessage[]` posted verbatim (parts) — the RFC's chosen
 * shape. `references` + the resolved agent config (`data.parameters`) come from the app's
 * LATEST revision via `resolveAppAgConfig` when the page is app-scoped; otherwise a stub.
 * `session_id` is the useChat chat id. Query params (`application_id`, `project_id`) and
 * `Authorization` ride the execution-item builder during full integration.
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
    references: null as Record<string, unknown> | null,
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

export function createAgentChatTransport(appId?: string | null) {
    return new DefaultChatTransport<UIMessage>({
        api: agentChatApi,
        prepareSendMessagesRequest: ({messages, id, body}) => {
            const {ag_config, references} = configFor(appId)
            return {
                body: {
                    session_id: id,
                    ...(references ? {references} : {}),
                    data: {
                        messages, // RFC data.messages — UIMessage[] verbatim (parts)
                        parameters: ag_config,
                    },
                    ...body,
                },
            }
        },
    })
}

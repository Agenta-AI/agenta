import {projectIdAtom} from "@agenta/shared/state"
import {DefaultChatTransport, type UIMessage} from "ai"
import {getDefaultStore} from "jotai"

import {getJWT} from "@/oss/services/api"

import {resolveAppAgConfig} from "./agConfig"
import {type AgentChatTrack, trackApi} from "./constants"
import {toAgentaMessages} from "./toAgentaMessage"

/**
 * Transport for the agent chat slice (contract v1), parameterized by request-contract
 * **track**. Both tracks consume the same v6 UI Message Stream response — only the
 * outgoing request body shape differs (see ./constants and ./toAgentaMessage).
 *
 * The request is built the way the playground execution pipeline builds it, so the page
 * can hit a real authenticated backend:
 *  - **Auth:** `Authorization: Bearer <jwt>` from `getJWT()` (omitted when unauthenticated,
 *    so the credential-free example backend still works).
 *  - **Query params:** `application_id` (the app id) and `project_id` (the current
 *    project, only sent alongside auth — mirroring `executionItems.ts`).
 *  - **Body:** the agent-protocol envelope — `session_id` + `references` at the top level,
 *    and `data: {inputs: {messages}, parameters}` nested (the config resolved from the app's LATEST
 *    revision via `resolveAppAgConfig`, else a stub). `parameters` is the stored workflow
 *    config (what the backend reads as `data.parameters`); `references` lines up at the top
 *    level. This matches Mahmoud's BE contract (2026-06-19).
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
    parameters: {
        prompt: {
            messages: [{role: "system", content: "You are a helpful agent."}],
            llm_config: {model: "gpt-4o-mini", tools: []},
        },
        harness: "pi_core",
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
 * Returns `{parameters, references}`: `parameters` is the agent config the backend reads as
 * `data.parameters`. `harness`/`sandbox` are run-selection fields on the AGENT CONFIG
 * (`parameters.agent`); they are defaulted there but never override values the resolved
 * config already carries.
 */
// Legacy pre-migration run-selection keys that now live inside `agent`. Stripped from the
// top level when `agent` is present so we never emit both wire shapes for one config.
const LEGACY_RUN_SELECTION_KEYS = ["harness", "sandbox", "permission_policy"] as const

const configFor = (appId?: string | null) => {
    const resolved = resolveAppAgConfig(appId)
    if (!resolved) return stubConfig()
    const agConfig = resolved.ag_config as Record<string, unknown>
    const agent = agConfig.agent
    let parameters: Record<string, unknown>
    if (agent && typeof agent === "object") {
        const rest = {...agConfig}
        for (const key of LEGACY_RUN_SELECTION_KEYS) delete rest[key]
        parameters = {
            ...rest,
            agent: {
                harness: "pi_core",
                sandbox: "local",
                ...(agent as Record<string, unknown>),
            },
        }
    } else {
        parameters = {harness: "pi_core", sandbox: "local", ...agConfig}
    }
    return {parameters, references: resolved.references}
}

const withQuery = (url: string, params: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value) qs.set(key, value)
    }
    const suffix = qs.toString()
    return suffix ? `${url}${url.includes("?") ? "&" : "?"}${suffix}` : url
}

/** Per-request auth header + URL (with `application_id`/`project_id` query params), built
 * the way the playground pipeline builds them so the page can hit a real backend. */
async function requestMeta(track: AgentChatTrack, appId?: string | null) {
    const jwt = await getJWT()
    // `Accept: text/event-stream` makes the agent endpoint serve the v6 SSE stream useChat
    // consumes; without it the endpoint negotiates down to batch JSON (the AI-SDK transport
    // sets no Accept), which useChat can't render.
    // `x-ag-messages-format` declares the request body's message format (AI-SDK / Vercel
    // UIMessages) so the endpoint picks the right adapter; "vercel" matches the backend's
    // VERCEL_MESSAGE_PROTOCOL identity (sdk/agents/adapters/vercel/routing.py).
    const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "x-ag-messages-format": "vercel",
    }
    if (jwt) headers.Authorization = `Bearer ${jwt}`
    const projectId = getDefaultStore().get(projectIdAtom) || undefined
    const api = withQuery(trackApi(track), {
        application_id: appId || undefined,
        // Mirror executionItems.ts: project_id only travels alongside auth.
        project_id: jwt ? projectId : undefined,
    })
    return {api, headers}
}

export function createAgentChatTransport(track: AgentChatTrack, appId?: string | null) {
    return new DefaultChatTransport<UIMessage>({
        api: trackApi(track),
        prepareSendMessagesRequest: async ({messages, id, body}) => {
            const {parameters, references} = configFor(appId)
            const {api, headers} = await requestMeta(track, appId)

            if (track === "agenta") {
                // Track B: FE adapts down to the existing Agenta message contract. Same
                // envelope; the approval decision stays in the top-level `tool_approvals`
                // side field (the Agenta message shape has no per-tool approval slot).
                const {messages: agentaMessages, tool_approvals} = toAgentaMessages(messages)
                return {
                    api,
                    headers,
                    body: {
                        session_id: id,
                        references,
                        tool_approvals,
                        data: {inputs: {messages: agentaMessages}, parameters},
                        ...body,
                    },
                }
            }

            // Track A: post the `UIMessage[]` verbatim — the service reads `data.inputs.messages`.
            return {
                api,
                headers,
                body: {
                    session_id: id,
                    references,
                    data: {inputs: {messages}, parameters},
                    ...body,
                },
            }
        },
    })
}

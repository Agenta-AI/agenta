import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/**
 * Streaming endpoint for the agent chat slice — the RFC `POST /messages` contract
 * (`docs/design/agent-workflows/agent-protocol-rfc.md`): the conversation is posted as
 * `data.messages` in the AI SDK `UIMessage[]` (parts) shape. Override with
 * `NEXT_PUBLIC_AGENT_CHAT_API` to point the page at a real backend for parity testing.
 */
export const agentChatApi = getEnv("NEXT_PUBLIC_AGENT_CHAT_API") || "http://localhost:8000/messages"

/** Whether the agent chat slice page is enabled. Feature-flagged, off by default. */
export const isAgentChatSliceEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_SLICE") || "").toLowerCase() === "true"

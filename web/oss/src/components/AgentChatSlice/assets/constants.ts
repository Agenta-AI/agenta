import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/**
 * The two request-contract tracks the slice exposes for the team to compare:
 *  - `uimessage` (Track A): POST the `useChat` `UIMessage[]` verbatim (parts). No FE
 *    translation; the service must speak AI SDK parts.
 *  - `agenta` (Track B): adapt to Agenta's existing `{role, content}` message shape (the
 *    contract `chat.py`/`completion.py` already parse), with approvals in `tool_approvals`.
 *
 * The *response* stream (text + tools + approval + trace) is identical for both; only the
 * outgoing request body differs.
 */
export type AgentChatTrack = "uimessage" | "agenta"

const API_BASE = getEnv("NEXT_PUBLIC_AGENT_CHAT_API") || "http://localhost:8000/api/agent/chat"

/** Streaming endpoint per track. Track B appends `-agenta` to the base path. */
export const trackApi = (track: AgentChatTrack): string =>
    track === "agenta" ? `${API_BASE}-agenta` : API_BASE

/** Default track on first load. Override with `NEXT_PUBLIC_AGENT_CHAT_TRACK=agenta`. */
export const DEFAULT_TRACK: AgentChatTrack =
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_TRACK") || "").toLowerCase() === "agenta"
        ? "agenta"
        : "uimessage"

/** Whether the agent chat slice page is enabled. Feature-flagged, off by default. */
export const isAgentChatSliceEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_SLICE") || "").toLowerCase() === "true"

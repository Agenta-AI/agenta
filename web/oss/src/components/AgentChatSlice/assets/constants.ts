import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/** Whether the agent chat slice page is enabled. On by default; opt out with `NEXT_PUBLIC_AGENT_CHAT_SLICE=false`. */
export const isAgentChatSliceEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_SLICE") || "").toLowerCase() !== "false"

/**
 * When "true", the chat Stop button also kills the session (tears down the live sandbox + halts
 * server-side compute) on top of aborting the client stream. Off by default: kill ends the current
 * run, cancels pending approvals, and forces a fresh sandbox on the next turn. Durable state
 * survives (records + the object-store-backed cwd/agent mounts remount on resume, #5197 merged), so
 * this is safe where the store is configured; left off so default Stop stays a pure stream-abort.
 */
export const doesAgentChatStopKillSession = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_STOP_KILLS_SESSION") || "").toLowerCase() === "true"

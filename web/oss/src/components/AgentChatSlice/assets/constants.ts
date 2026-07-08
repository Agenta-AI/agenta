import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/** Whether the agent chat slice page is enabled. On by default; opt out with `NEXT_PUBLIC_AGENT_CHAT_SLICE=false`. */
export const isAgentChatSliceEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_SLICE") || "").toLowerCase() !== "false"

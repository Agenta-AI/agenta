import {getEnv} from "@agenta/shared"

/**
 * Agent file uploads. Default ON; only an explicit "false" disables it.
 * Lives here rather than in the chat slice so the drive code carries no app-layer import.
 */
export const isAgentFileUploadsEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_FILE_UPLOADS") || "").toLowerCase() !== "false"

import {CODING_AGENT_INSTALL} from "./constants"

/** Clipboard payload for the "Use my coding agent" handoff (owner-authoritative shape). */
export const buildCodingAgentClipboard = (text: string): string =>
    `${CODING_AGENT_INSTALL}\n\n` +
    `Then use the Agenta skills to create an agent that does the following:\n\n` +
    `${text.trim() || "<describe your agent>"}`

import {getEnv} from "./env"

/**
 * Pre-create connect step (`NEXT_PUBLIC_AGENT_CONNECT_STEP`) — the SAME flag the desktop reads,
 * so the two surfaces cannot disagree about a decision that was made once.
 *
 * ON by default: describing an agent on first run opens the setup card (the accounts it will
 * need, connected while it is still a draft) instead of creating immediately (#6043). Set to
 * "false" to restore instant create.
 */
export const CONNECT_STEP_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_CONNECT_STEP") || "").toLowerCase() !== "false"

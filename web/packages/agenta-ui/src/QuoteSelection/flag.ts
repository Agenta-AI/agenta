import {getEnv} from "@agenta/shared"

/**
 * Quote-to-reply — selecting part of a settled agent reply (or a file preview) and replying to
 * just that span. Off by default: with the flag down no `selectionchange` listener is bound at
 * all, so the transcript is byte-for-byte its current self. Opt in with
 * `NEXT_PUBLIC_AGENT_QUOTE_REPLY=true`.
 */
export const isQuoteReplyEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_QUOTE_REPLY") || "").toLowerCase() === "true"

import {atom} from "jotai"

/**
 * Raised when an interaction OUTSIDE the config pane mutates the DRAFT agent config
 * (e.g. flipping "always allow" in the approval dock writes a per-tool permission).
 * The draft/uncommitted counterpart of {@link agentSelfCommitSignalAtom}: that one marks
 * a COMMITTED self-commit in agent teal; this one marks an UNCOMMITTED, user-initiated
 * change in draft blue, so the config sections it touched can pulse for attention even
 * when the user's eyes are on the chat.
 *
 * Config-scoped by design — files (time-based recency) and triggers (persisted, not draft)
 * keep their own "changed" engines; only the shared visual language is reused.
 * Cleared by the next draft change or by dismissal.
 */
export interface DraftConfigChangeSignal {
    /** The draft revision whose config changed. */
    revisionId: string
    /** Config section keys to light up, e.g. ["tools"] or ["model-harness"]. */
    sectionKeys: string[]
    /** Where the change came from — extensible provenance for future callers. */
    origin: "approval-dock"
    /** Short human summary for the tooltip, e.g. "Always allow search_web". */
    summary?: string
    /** Friendly label for the config-pane banner, e.g. "Send email". */
    label?: string
    /** The tool the change targeted, so the banner's Undo can revert it. */
    toolName?: string
    at: number
}

export const draftConfigChangeSignalAtom = atom<DraftConfigChangeSignal | null>(null)

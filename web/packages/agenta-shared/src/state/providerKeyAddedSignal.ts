import {atom} from "jotai"

/**
 * Raised when a provider API key is saved from the config pane's "Connect key" flow (the inline
 * provider-credentials pane or its drawer). Drives the success banner pinned to the bottom of the
 * config pane — the same pattern as {@link agentSelfCommitSignalAtom} /
 * {@link draftConfigChangeSignalAtom}, in success green: it confirms the agent can now run without
 * pulling focus away with a floating toast. Cleared by dismissal or after an auto-dismiss timeout.
 */
export interface ProviderKeyAddedSignal {
    /** The displayed revision the key was connected for. */
    revisionId: string
    /** Friendly provider name for the banner, e.g. "OpenAI". */
    provider?: string
    at: number
}

export const providerKeyAddedSignalAtom = atom<ProviderKeyAddedSignal | null>(null)

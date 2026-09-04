/**
 * The pre-create setup step's state (#6043), shared by both onboarding hosts: Home's first-run
 * create surface and the playground-native onboarding.
 *
 * Holds only what survives across the step — the description that opened it, the accounts on the
 * card, what was skipped, and the permission answer. Which accounts are *connected* is the card's
 * business (each row reads its own workspace connection) and comes back through `onCreate`.
 *
 * `open()` is the whole gate: a host that never calls it behaves exactly as it did before the
 * step existed, which is what the flag-off path relies on.
 */
import {useCallback, useMemo, useState} from "react"

import {
    DEFAULT_PERMISSION,
    detectAccounts,
    suggestionAccounts,
    type AgentPermission,
    type AgentStarterTemplate,
    type DetectedAccount,
} from "@agenta/entities/workflow"

/** What the step was opened for — replayed into `createAgent` once the user presses Create. */
export interface AgentSetupDraft {
    /** The composer text, or the template's builder message. */
    seedMessage: string
    /** Agent name the host would have used. */
    name?: string
    template?: AgentStarterTemplate
}

export interface AgentSetupStep {
    /** The step is showing; the host renders the card instead of creating. */
    draft: AgentSetupDraft | null
    accounts: DetectedAccount[]
    suggestions: DetectedAccount[]
    skippedSlugs: string[]
    permission: AgentPermission
    /** Start the step. Detection runs here, once, off the description and template. */
    /** Opens the step; `false` means nothing was detected, so the caller should just commit. */
    open: (draft: AgentSetupDraft) => boolean
    /** Abandon the step and go back to the composer. */
    close: () => void
    skip: (slug: string) => void
    undoSkip: (slug: string) => void
    addAccount: (account: DetectedAccount) => void
    setPermission: (permission: AgentPermission) => void
}

export function useAgentSetupStep(): AgentSetupStep {
    const [draft, setDraft] = useState<AgentSetupDraft | null>(null)
    const [accounts, setAccounts] = useState<DetectedAccount[]>([])
    const [skippedSlugs, setSkippedSlugs] = useState<string[]>([])
    const [permission, setPermission] = useState<AgentPermission>(DEFAULT_PERMISSION)

    /**
     * Opens the step, and reports whether it had anything to ask for. A draft with no detected
     * account has nothing to connect and nothing to show — opening on it puts a blocking card
     * reading "Nothing required." between the user and their agent.
     */
    const open = useCallback((next: AgentSetupDraft) => {
        // Detection is a one-shot: re-running it as the user connects would reshuffle the rows
        // under their cursor, and an account they added by hand must never be detected away.
        const detected = detectAccounts({description: next.seedMessage, template: next.template})
        if (detected.length === 0) return false
        setAccounts(detected)
        setSkippedSlugs([])
        setPermission(DEFAULT_PERMISSION)
        setDraft(next)
        return true
    }, [])

    const close = useCallback(() => setDraft(null), [])

    const skip = useCallback((slug: string) => {
        setSkippedSlugs((prev) => (prev.includes(slug) ? prev : [...prev, slug]))
    }, [])

    const undoSkip = useCallback((slug: string) => {
        setSkippedSlugs((prev) => prev.filter((entry) => entry !== slug))
    }, [])

    const addAccount = useCallback((account: DetectedAccount) => {
        setAccounts((prev) =>
            prev.some((entry) => entry.slug === account.slug) ? prev : [...prev, account],
        )
        // Adding an account the user had skipped is an undo, not a duplicate row.
        setSkippedSlugs((prev) => prev.filter((entry) => entry !== account.slug))
    }, [])

    const suggestions = useMemo(() => suggestionAccounts(accounts), [accounts])

    return {
        draft,
        accounts,
        suggestions,
        skippedSlugs,
        permission,
        open,
        close,
        skip,
        undoSkip,
        addAccount,
        setPermission,
    }
}

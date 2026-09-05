/**
 * The pre-create setup step's state (#6043), shared by both onboarding hosts: Home's first-run
 * create surface and the playground-native onboarding.
 *
 * Holds only what survives across the step — the description that opened it, the accounts on the
 * card. Which accounts are *connected* is the card's
 * business (each row reads its own workspace connection) and comes back through `onCreate`.
 *
 * `open()` is the whole gate: a host that never calls it behaves exactly as it did before the
 * step existed, which is what the flag-off path relies on.
 */
import {useCallback, useMemo, useState} from "react"

import {isConnectionActive, useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {
    detectAccounts,
    isAccountSatisfied,
    suggestionAccounts,
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
    /** Start the step. Detection runs here, once, off the description and template. */
    /** Opens the step; `false` means nothing was detected, so the caller should just commit. */
    open: (draft: AgentSetupDraft) => boolean
    /** Abandon the step and go back to the composer. */
    close: () => void
    addAccount: (account: DetectedAccount) => void
}

export function useAgentSetupStep(): AgentSetupStep {
    // What the workspace is already connected to, so the step can decline to open at all.
    const {connections} = useToolConnectionsQuery()
    const workspaceSlugs = useMemo(
        () =>
            new Set(
                connections
                    .filter(isConnectionActive)
                    .map((connection) => connection.integration_key)
                    .filter(Boolean) as string[],
            ),
        [connections],
    )
    const [draft, setDraft] = useState<AgentSetupDraft | null>(null)
    /**
     * Whether the step was LAST OPENED for a template — deliberately not cleared on close.
     * Gating suggestions on `draft?.template` made them reappear the instant `close()` nulled
     * the draft, growing the card mid-fold while a host animates it shut.
     */
    const [templateDraft, setTemplateDraft] = useState(false)
    const [accounts, setAccounts] = useState<DetectedAccount[]>([])

    /**
     * Opens the step, and reports whether it had anything to ask for. A draft with no detected
     * account has nothing to connect and nothing to show — opening on it puts a blocking card
     * reading "Nothing required." between the user and their agent.
     */
    const open = useCallback(
        (next: AgentSetupDraft) => {
            // Detection is a one-shot: re-running it as the user connects would reshuffle the rows
            // under their cursor, and an account they added by hand must never be detected away.
            const detected = detectAccounts({
                description: next.seedMessage,
                template: next.template,
            })
            if (detected.length === 0) return false
            // Nothing left to ask: every need the template gates on is already met by a connection
            // this workspace has — including one standing in for another. Stopping here would be a
            // card with every row ticked and a button, which is a step that exists to be dismissed.
            const outstanding = detected.filter(
                (account) => account.required && !isAccountSatisfied(account, workspaceSlugs),
            )
            // …unless a template slot offers a CHOICE of provider (GitHub or GitLab). A satisfied
            // slot still defaults to the connected provider, but the user must get the chance to
            // pick the alternative — a second PR reviewer on GitLab beside the GitHub one.
            const hasChoice =
                Boolean(next.template) && detected.some((account) => account.alternatives?.length)
            if (outstanding.length === 0 && !hasChoice) return false
            setAccounts(detected)
            setTemplateDraft(Boolean(next.template))
            setDraft(next)
            return true
        },
        [workspaceSlugs],
    )

    const close = useCallback(() => setDraft(null), [])

    const addAccount = useCallback((account: DetectedAccount) => {
        setAccounts((prev) =>
            prev.some((entry) => entry.slug === account.slug) ? prev : [...prev, account],
        )
    }, [])

    // A template declares exactly what it needs, so the step offers nothing beyond it — the
    // "Also add" chips are a shortcut for a described agent, not a catalogue to upsell from.
    const suggestions = useMemo(
        () => (templateDraft ? [] : suggestionAccounts(accounts)),
        [accounts, templateDraft],
    )

    return {
        draft,
        accounts,
        suggestions,
        open,
        close,
        addAccount,
    }
}

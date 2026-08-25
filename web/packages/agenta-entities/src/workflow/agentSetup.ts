/**
 * The onboarding setup step's rules (#6043): what gates "Create agent", and what the created
 * agent is told about the choices made in the step.
 *
 * Pure — no React, no network — so both halves are unit-testable and neither the card
 * (`@agenta/entity-ui/onboarding`) nor the create hooks own a copy of the logic.
 */
import type {DetectedAccount} from "./detectAccounts"

/** How much the agent may do on its own. Asked once, in the setup step's footer. */
export type AgentPermission = "read" | "ask" | "auto"

export const PERMISSION_OPTIONS: {
    value: AgentPermission
    label: string
    /**
     * The line sent to the agent. Written in the USER's voice, first person — the preamble is
     * appended to the seed, which is auto-sent as their first message and shown in the transcript
     * as theirs. A machine-shaped "Permissions: …" block reads as something they never typed.
     */
    instruction: string
}[] = [
    {value: "read", label: "Read only", instruction: "Don't write or send anything — read only."},
    {value: "ask", label: "Ask first", instruction: "Ask me before you write or send anything."},
    {
        value: "auto",
        label: "On its own",
        instruction: "You can act without asking me for approval.",
    },
]

export const DEFAULT_PERMISSION: AgentPermission = "ask"

/** Everything the step has decided, at the moment Create is pressed. */
export interface AgentSetupSelection {
    accounts: DetectedAccount[]
    /** Slugs with a live workspace connection. */
    connectedSlugs: string[]
    /** Suggested slugs the user dismissed. A required account can never be skipped. */
    skippedSlugs: string[]
    permission: AgentPermission
}

/**
 * Required accounts still missing a connection — the only thing allowed to block create.
 * A text-detected account is never `required`, so a keyword guess can't reach this list (D2).
 */
export const outstandingRequired = ({
    accounts,
    connectedSlugs,
}: Pick<AgentSetupSelection, "accounts" | "connectedSlugs">): DetectedAccount[] => {
    const connected = new Set(connectedSlugs)
    return accounts.filter((account) => account.required && !connected.has(account.slug))
}

export const canCreateAgent = (
    selection: Pick<AgentSetupSelection, "accounts" | "connectedSlugs">,
): boolean => outstandingRequired(selection).length === 0

export type AgentSetupStatus =
    /** A required account is unconnected — create is disabled. */
    | "blocked"
    /** Every offered account is connected. */
    | "all-set"
    /** Something is still unconnected or skipped, but nothing blocks create. */
    | "ready"
    /** Nothing was detected and nothing added. */
    | "empty"

export const setupStatus = ({
    accounts,
    connectedSlugs,
    skippedSlugs,
}: Pick<AgentSetupSelection, "accounts" | "connectedSlugs" | "skippedSlugs">): AgentSetupStatus => {
    if (accounts.length === 0) return "empty"
    if (outstandingRequired({accounts, connectedSlugs}).length > 0) return "blocked"
    const connected = new Set(connectedSlugs)
    const skipped = new Set(skippedSlugs)
    const unresolved = accounts.filter(
        (account) => !connected.has(account.slug) && !skipped.has(account.slug),
    )
    return unresolved.length === 0 && skipped.size === 0 ? "all-set" : "ready"
}

const labelsFor = (accounts: DetectedAccount[], slugs: Set<string>): string[] => {
    const seen = new Set<string>()
    const labels: string[] = []
    for (const account of accounts) {
        if (!slugs.has(account.slug) || seen.has(account.slug)) continue
        seen.add(account.slug)
        labels.push(account.label)
    }
    return labels
}

/** "A" · "A and B" · "A, B and C" — a readable list, since this is prose, not a data field. */
const readableList = (items: string[]): string => {
    if (items.length <= 1) return items[0] ?? ""
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/**
 * What the setup step tells the agent it is about to create (D5 / M2).
 *
 * WRITTEN IN THE USER'S VOICE, on purpose. The seed is auto-sent as the first turn and renders in
 * the transcript as the user's own message, so this has to read like something they said — not a
 * machine block appended under their sentence. There is no hidden-context channel on the seed
 * (`AgentFirstRunSeed` carries text only), and the config-write alternative (M1) turned out not to
 * exist for this step: a gateway tool is per-ACTION (`{type:"gateway", integration, action,
 * connection}`), and choosing actions is the builder's job via `discover_tools`. So this line is
 * the carry-through, permanently — see the design workspace's D5 revision.
 *
 * Returns `""` when there is nothing to say, so the seed is left untouched.
 */
export const buildSetupPreamble = (selection: AgentSetupSelection): string => {
    const {accounts, connectedSlugs, skippedSlugs, permission} = selection
    const connected = labelsFor(accounts, new Set(connectedSlugs))
    const skipped = labelsFor(accounts, new Set(skippedSlugs))

    const sentences: string[] = []
    if (connected.length > 0) sentences.push(`I've connected ${readableList(connected)}.`)
    if (skipped.length > 0) {
        sentences.push(
            `I've skipped ${readableList(skipped)} for now — ask me when you need ${
                skipped.length > 1 ? "them" : "it"
            }.`,
        )
    }

    // The permission answer is worth sending on its own — "read only" constrains an agent that
    // needs no account at all — but the default posture says nothing the builder doesn't assume.
    const option = PERMISSION_OPTIONS.find((entry) => entry.value === permission)
    if (option && (sentences.length > 0 || permission !== DEFAULT_PERMISSION)) {
        sentences.push(option.instruction)
    }
    return sentences.join(" ")
}

/** The seed message the agent is created with, plus the setup step's preamble when there is one. */
export const appendSetupPreamble = (seed: string, selection: AgentSetupSelection): string => {
    const preamble = buildSetupPreamble(selection)
    if (!preamble) return seed
    return seed.trim() ? `${seed.trim()}\n\n${preamble}` : preamble
}

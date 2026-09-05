/**
 * The onboarding setup step's rules (#6043): what gates "Create agent", and what the created
 * agent is told about the choices made in the step.
 *
 * Pure — no React, no network — so both halves are unit-testable and neither the card
 * (`@agenta/entity-ui/onboarding`) nor the create hooks own a copy of the logic.
 */
import {PROVIDERS} from "./agentTemplates"
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

/**
 * Everything the step has decided, at the moment Create is pressed. There is deliberately no
 * skip state: an optional slot left unconnected IS the skip — the builder asks when it needs
 * it, and no button had to say so.
 */
export interface AgentSetupSelection {
    accounts: DetectedAccount[]
    /** Slugs with a live workspace connection. */
    connectedSlugs: string[]
    permission: AgentPermission
}

/**
 * Required accounts still missing a connection — the only thing allowed to block create.
 * A text-detected account is never `required`, so a keyword guess can't reach this list (D2).
 */
/** Settled when its own provider is connected, or any provider that stands in for it. */
export const isAccountSatisfied = (account: DetectedAccount, connected: Set<string>): boolean =>
    connected.has(account.slug) ||
    (account.alternatives?.some((slug) => connected.has(slug)) ?? false)

export const outstandingRequired = ({
    accounts,
    connectedSlugs,
}: Pick<AgentSetupSelection, "accounts" | "connectedSlugs">): DetectedAccount[] => {
    const connected = new Set(connectedSlugs)
    return accounts.filter((account) => account.required && !isAccountSatisfied(account, connected))
}

export const canCreateAgent = (
    selection: Pick<AgentSetupSelection, "accounts" | "connectedSlugs">,
): boolean => outstandingRequired(selection).length === 0

export type AgentSetupStatus =
    /** A required account is unconnected — create is disabled. */
    | "blocked"
    /** Every offered account is connected. */
    | "all-set"
    /** An optional account is still unconnected, but nothing blocks create. */
    | "ready"
    /** Nothing was detected and nothing added. */
    | "empty"

export const setupStatus = ({
    accounts,
    connectedSlugs,
}: Pick<AgentSetupSelection, "accounts" | "connectedSlugs">): AgentSetupStatus => {
    if (accounts.length === 0) return "empty"
    if (outstandingRequired({accounts, connectedSlugs}).length > 0) return "blocked"
    const connected = new Set(connectedSlugs)
    const unresolved = accounts.filter((account) => !isAccountSatisfied(account, connected))
    return unresolved.length === 0 ? "all-set" : "ready"
}

const providerLabel = (slug: string): string => PROVIDERS[slug]?.label ?? slug

/**
 * How each account's need was actually met — by its own provider, or by the alternative the
 * user chose instead. A GitHub|GitLab slot connected via GitLab must SAY GitLab, or the builder
 * wires the wrong provider's tools.
 */
const resolveVia = (
    accounts: DetectedAccount[],
    slugs: Set<string>,
): {account: DetectedAccount; via: string}[] =>
    accounts.flatMap((account) => {
        const via = [account.slug, ...(account.alternatives ?? [])].find((slug) => slugs.has(slug))
        return via ? [{account, via}] : []
    })

const labelsFor = (accounts: DetectedAccount[], slugs: Set<string>): string[] => {
    const seen = new Set<string>()
    const labels: string[] = []
    for (const {account, via} of resolveVia(accounts, slugs)) {
        if (seen.has(via)) continue
        seen.add(via)
        labels.push(via === account.slug ? account.label : providerLabel(via))
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
    const {accounts, connectedSlugs, permission} = selection
    const connected = labelsFor(accounts, new Set(connectedSlugs))

    const sentences: string[] = []
    if (connected.length > 0) sentences.push(`I've connected ${readableList(connected)}.`)

    // The choice of an ALTERNATIVE travels only as prose, and prose loses to the template's
    // own vocabulary (a PR-reviewer prompt reads as GitHub) — especially when BOTH providers
    // hold live connections and tool discovery offers each. So a non-primary choice is stated
    // as an instruction, not left implied by the connected list.
    for (const {account, via} of resolveVia(accounts, new Set(connectedSlugs))) {
        if (via === account.slug) continue
        sentences.push(`Use ${providerLabel(via)}, not ${account.label}.`)
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

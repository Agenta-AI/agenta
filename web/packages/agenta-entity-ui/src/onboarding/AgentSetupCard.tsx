/**
 * The pre-create setup step (#6043, iteration B): the accounts a new agent will need, connected
 * before it exists rather than asked for mid-run.
 *
 * The gating rule lives in `@agenta/entities/workflow` (`canCreateAgent`), not here: a
 * TEMPLATE-declared account blocks create, a text-detected one never does. This component only
 * renders that rule — a wrong guess costs one click, never the agent.
 *
 * Controlled on purpose. Permission and the account list belong to the host (Home's create
 * surface and the playground onboarding both keep them across their own re-renders), so the
 * card holds only what it alone knows: which accounts are connected right now.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {isConnectionActive, useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {
    PERMISSION_OPTIONS,
    canCreateAgent,
    setupStatus,
    type AgentPermission,
    type AgentSetupSelection,
    type DetectedAccount,
} from "@agenta/entities/workflow"
import {Button, Segmented, Spinner} from "@agenta/ui/ui"
import {MagnifyingGlass, Plus, X} from "@phosphor-icons/react"
import clsx from "clsx"
import Image from "next/image"

import AccountRow from "./AccountRow"
import {SETUP_COPY, setupBadge, setupFootnote, setupLead, setupTitle} from "./copy"

export interface AgentSetupCardProps {
    /** Rows, in order: template-declared first, then text matches (see `detectAccounts`). */
    accounts: DetectedAccount[]
    /** Chips offering accounts not on the card yet. Clicking one promotes it to a row. */
    suggestions?: DetectedAccount[]
    /** A chip was picked — the host adds it to `accounts`. */
    onAddAccount: (account: DetectedAccount) => void
    /** "Search all" — opens the host's catalogue surface. Hidden when omitted. */
    onBrowseAll?: () => void
    permission: AgentPermission
    onPermissionChange: (permission: AgentPermission) => void
    /**
     * Create, with everything the step decided. Which accounts are actually connected is known
     * only here (each row reads its own workspace connection), so the card hands the whole
     * selection back rather than making the host track it a second time.
     */
    onCreate: (selection: AgentSetupSelection) => void
    /**
     * Reports the create gate (`canCreateAgent`) and the CURRENT selection whenever either
     * changes — which accounts are connected is known only in here, so a host that disables its
     * own controls until the required connections are made, or renders the Create action itself
     * (`hideCreate`), has no other way to see them.
     */
    onReadyChange?: (canCreate: boolean, selection: AgentSetupSelection) => void
    /** The host renders the Create action itself (e.g. in the composer it is docked into). */
    hideCreate?: boolean
    /** Abandon the step — a small ✕ in the card's own header. Hidden when omitted. */
    onDismiss?: () => void
    /**
     * `card` stands alone with its own frame; `docked` drops the frame so the card can sit
     * inside another surface's border (the composer), keeping only its internal dividers.
     */
    variant?: "card" | "docked"
    creating?: boolean
    className?: string
}

const AgentSetupCard = ({
    accounts,
    suggestions = [],
    onAddAccount,
    onBrowseAll,
    permission,
    onPermissionChange,
    onCreate,
    onReadyChange,
    hideCreate = false,
    onDismiss,
    variant = "card",
    creating = false,
    className,
}: AgentSetupCardProps) => {
    // Each row reports its live connection state; the card aggregates. Keyed by slug so a row
    // remounting (or the list reordering) can't strand a stale entry.
    const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({})
    /**
     * Which provider each slot acts as (`rowSlug → providerSlug`), where the slot offers a
     * choice. Held here rather than in the host: the choice lives and dies with the card — the
     * hosts remount it per step — and only the rows' reports (which follow it) leave the card.
     */
    const [selections, setSelections] = useState<Record<string, string>>({})
    const handleSelect = useCallback((rowSlug: string, providerSlug: string) => {
        setSelections((prev) =>
            prev[rowSlug] === providerSlug ? prev : {...prev, [rowSlug]: providerSlug},
        )
    }, [])
    const handleConnectedChange = useCallback((slug: string, connected: boolean) => {
        setConnectedMap((prev) => (prev[slug] === connected ? prev : {...prev, [slug]: connected}))
    }, [])

    const connectedSlugs = useMemo(
        () => Object.keys(connectedMap).filter((slug) => connectedMap[slug]),
        [connectedMap],
    )

    // The project's connections, read once here rather than per row: a row can only query its own
    // provider, so it could never see that an ALTERNATIVE was already connected.
    const {connections, isLoading: connectionsLoading} = useToolConnectionsQuery()
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
    /** The provider already meeting this need — its own, or the first alternative that is live. */
    const satisfiedVia = (account: DetectedAccount): string | undefined =>
        [account.slug, ...(account.alternatives ?? [])].find((slug) => workspaceSlugs.has(slug))

    /**
     * Every connection renders in the SECTION style — slim header over the scope, switch and
     * actions — so the card reads the same at any count. Two or more become an accordion (one
     * body open at a time, 44px per collapsed section); a single one keeps its body open with
     * no chevron: collapsing the only section would be a tap tax with nothing bought.
     */
    const accordionMode = accounts.length > 1
    /**
     * Which section is open. The card decides this exactly ONCE — when the workspace
     * connections are known, the first REQUIRED-and-unsatisfied section opens (an optional one
     * never demands attention: ignoring it is the skip). After that, only the user's taps move
     * it: a section must never collapse itself the moment its connection lands — the ground
     * yanked out from under the very thing they were looking at.
     */
    const [openSlug, setOpenSlug] = useState<string | null>(null)
    const openLatchedRef = useRef(false)
    useEffect(() => {
        if (openLatchedRef.current || connectionsLoading) return
        openLatchedRef.current = true
        const first = accounts.find((account) => account.required && !satisfiedVia(account))
        if (first) setOpenSlug(first.slug)
        // Once, on the first settled read of the connections — not reactive to later changes.
    }, [connectionsLoading, accounts, workspaceSlugs])
    const toggleSection = useCallback((slug: string) => {
        setOpenSlug((prev) => (prev === slug ? null : slug))
    }, [])

    const status = setupStatus({accounts, connectedSlugs})
    const canCreate = canCreateAgent({accounts, connectedSlugs})
    useEffect(() => {
        onReadyChange?.(canCreate, {accounts, connectedSlugs, permission})
    }, [canCreate, accounts, connectedSlugs, permission, onReadyChange])
    const badge = setupBadge(status, accounts.length)
    // A declared account only ever comes from a template, so its presence names the source.
    const fromTemplate = accounts.some((account) => account.origin === "template")

    const permissionOptions = useMemo(
        () => PERMISSION_OPTIONS.map((option) => ({value: option.value, label: option.label})),
        [],
    )

    return (
        <div
            className={clsx(
                "flex flex-col",
                variant === "card"
                    ? "rounded-xl border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]"
                    : // Docked: the host's frame is the frame; only a bottom divider separates
                      // the step from the editor beneath it.
                      "border-x-0 border-b border-t-0 border-solid border-[var(--ag-colorSplit)]",
                className,
            )}
        >
            <div className="flex items-center gap-2 border-x-0 border-t-0 border-b border-solid border-[var(--ag-colorSplit)] px-4 py-3">
                <span className="flex-1 truncate text-xs font-semibold text-[var(--ag-colorText)]">
                    {setupTitle(status)}
                </span>
                {badge ? (
                    <span
                        className={clsx(
                            "shrink-0 rounded-full border border-solid px-2 py-0.5 text-[10px] font-medium",
                            badge.tone === "warning"
                                ? "border-[var(--ag-colorWarningBorder)] text-[var(--ag-colorWarning)]"
                                : badge.tone === "success"
                                  ? "border-[var(--ag-colorSuccessBorder)] text-[var(--ag-colorSuccess)]"
                                  : "border-[var(--ag-colorBorderSecondary)] text-[var(--ag-colorTextSecondary)]",
                        )}
                    >
                        {badge.text}
                    </span>
                ) : null}
                {onDismiss ? (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label={SETUP_COPY.dismiss}
                        title={SETUP_COPY.dismiss}
                        className="-mr-1 flex shrink-0 cursor-pointer items-center rounded border-0 bg-transparent p-1 text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)]"
                    >
                        <X size={13} />
                    </button>
                ) : null}
            </div>

            <div className="flex flex-col gap-2 px-4 py-3">
                {/* A template card says nothing above the rows: the title and the sections
                    already say what is needed, and on a phone the lead sentence was two lines
                    of crowding. Described-agent and empty cards keep their lead — there the
                    words ARE the explanation of where the rows came from. */}
                {fromTemplate ? null : (
                    <p className="m-0 text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                        {setupLead(status, fromTemplate)}
                    </p>
                )}

                <div className="flex flex-col">
                    {accounts.map((account) => (
                        <AccountRow
                            key={account.slug}
                            account={account}
                            satisfiedVia={satisfiedVia(account)}
                            // Default display: the provider already meeting the need, else the
                            // slot's preferred one — but the user's own pick beats both.
                            selectedSlug={
                                selections[account.slug] ?? satisfiedVia(account) ?? account.slug
                            }
                            onSelect={handleSelect}
                            providerConnected={(slug) => workspaceSlugs.has(slug)}
                            onConnectedChange={handleConnectedChange}
                            accordion
                            open={accordionMode ? openSlug === account.slug : true}
                            onToggle={accordionMode ? () => toggleSection(account.slug) : undefined}
                        />
                    ))}
                </div>

                {suggestions.length > 0 || onBrowseAll ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {suggestions.length > 0 ? (
                            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                {SETUP_COPY.suggestionsLabel}
                            </span>
                        ) : null}
                        {suggestions.map((suggestion) => (
                            <Button
                                key={suggestion.slug}
                                variant="outline"
                                size="sm"
                                className="rounded-full"
                                onClick={() => onAddAccount(suggestion)}
                            >
                                {suggestion.logo ? (
                                    <Image
                                        src={suggestion.logo}
                                        alt=""
                                        width={13}
                                        height={13}
                                        unoptimized
                                        className="object-contain"
                                    />
                                ) : (
                                    <Plus size={12} />
                                )}
                                {suggestion.label}
                            </Button>
                        ))}
                        {onBrowseAll ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-full"
                                onClick={onBrowseAll}
                            >
                                <MagnifyingGlass size={12} />
                                {SETUP_COPY.browseAll}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-x-0 border-b-0 border-t border-solid border-[var(--ag-colorSplit)] px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {SETUP_COPY.permissionLabel}
                    </span>
                    <Segmented
                        size="sm"
                        options={permissionOptions}
                        value={permission}
                        onChange={(value) => onPermissionChange(value as AgentPermission)}
                        aria-label="How much the agent may do on its own"
                    />
                </div>

                <div className="flex items-center gap-3">
                    {/* Empty for blocked (the rows carry it) — render nothing, not a bare span. */}
                    {setupFootnote(status) ? (
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                            {setupFootnote(status)}
                        </span>
                    ) : null}
                    {hideCreate ? null : (
                        <Button
                            onClick={() => onCreate({accounts, connectedSlugs, permission})}
                            disabled={!canCreate || creating}
                        >
                            {creating ? <Spinner size="small" /> : null}
                            {SETUP_COPY.create}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AgentSetupCard

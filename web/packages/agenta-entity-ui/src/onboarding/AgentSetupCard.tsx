/**
 * The pre-create setup step (#6043, iteration B): the accounts a new agent will need, connected
 * before it exists rather than asked for mid-run.
 *
 * The gating rule lives in `@agenta/entities/workflow` (`canCreateAgent`), not here: a
 * TEMPLATE-declared account blocks create, a text-detected one never does. This component only
 * renders that rule — a wrong guess costs one click, never the agent.
 *
 * Controlled on purpose. Skip state, permission and the account list belong to the host (Home's
 * create surface and the playground onboarding both keep them across their own re-renders), so
 * the card holds only what it alone knows: which accounts are connected right now.
 */
import {useCallback, useMemo, useState} from "react"

import {
    PERMISSION_OPTIONS,
    canCreateAgent,
    outstandingRequired,
    setupStatus,
    type AgentPermission,
    type AgentSetupSelection,
    type DetectedAccount,
} from "@agenta/entities/workflow"
import {Button, Segmented, Spinner} from "@agenta/ui/ui"
import {MagnifyingGlass, Plus} from "@phosphor-icons/react"
import clsx from "clsx"
import Image from "next/image"

import AccountRow from "./AccountRow"
import {SETUP_COPY, setupBadge, setupFootnote, setupLead, setupTitle} from "./copy"

export interface AgentSetupCardProps {
    /** Rows, in order: template-declared first, then text matches (see `detectAccounts`). */
    accounts: DetectedAccount[]
    /** Chips offering accounts not on the card yet. Clicking one promotes it to a row. */
    suggestions?: DetectedAccount[]
    skippedSlugs: string[]
    onSkip: (slug: string) => void
    onUndoSkip: (slug: string) => void
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
    creating?: boolean
    className?: string
}

const AgentSetupCard = ({
    accounts,
    suggestions = [],
    skippedSlugs,
    onSkip,
    onUndoSkip,
    onAddAccount,
    onBrowseAll,
    permission,
    onPermissionChange,
    onCreate,
    creating = false,
    className,
}: AgentSetupCardProps) => {
    // Each row reports its live connection state; the card aggregates. Keyed by slug so a row
    // remounting (or the list reordering) can't strand a stale entry.
    const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({})
    const handleConnectedChange = useCallback((slug: string, connected: boolean) => {
        setConnectedMap((prev) => (prev[slug] === connected ? prev : {...prev, [slug]: connected}))
    }, [])

    const connectedSlugs = useMemo(
        () => Object.keys(connectedMap).filter((slug) => connectedMap[slug]),
        [connectedMap],
    )

    const status = setupStatus({accounts, connectedSlugs, skippedSlugs})
    const outstanding = outstandingRequired({accounts, connectedSlugs})
    const canCreate = canCreateAgent({accounts, connectedSlugs})
    const skippedCount = skippedSlugs.filter((slug) =>
        accounts.some((account) => account.slug === slug),
    ).length
    const badge = setupBadge(status, accounts.length, skippedCount)
    const skipped = useMemo(() => new Set(skippedSlugs), [skippedSlugs])

    const permissionOptions = useMemo(
        () => PERMISSION_OPTIONS.map((option) => ({value: option.value, label: option.label})),
        [],
    )

    return (
        <div
            className={clsx(
                "flex flex-col rounded-xl border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]",
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
            </div>

            <div className="flex flex-col gap-2 px-4 py-3">
                <p className="m-0 text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                    {setupLead(status)}
                </p>

                {accounts.map((account) => (
                    <AccountRow
                        key={account.slug}
                        account={account}
                        onConnectedChange={handleConnectedChange}
                        skipped={skipped.has(account.slug)}
                        onSkip={account.required ? undefined : onSkip}
                        onUndoSkip={onUndoSkip}
                    />
                ))}

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
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {setupFootnote(status, outstanding, skippedCount)}
                    </span>
                    <Button
                        onClick={() =>
                            onCreate({accounts, connectedSlugs, skippedSlugs, permission})
                        }
                        disabled={!canCreate || creating}
                    >
                        {creating ? <Spinner size="small" /> : null}
                        {SETUP_COPY.create}
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default AgentSetupCard

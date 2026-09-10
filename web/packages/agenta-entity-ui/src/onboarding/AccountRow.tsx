/**
 * One account the agent will use, in the pre-create setup step (#6043).
 *
 * Extracted from the template setup drawer's `IntegrationRow` so the drawer and the new card
 * render the same row, off a `DetectedAccount` input — a template-declared account and a
 * text-detected one differ only by their `required` flag. There is deliberately no skip state:
 * leaving an optional account unconnected IS the skip.
 *
 * A slot with alternatives is a CHOICE, and choosing IS connecting: the section body shows one
 * card per provider (preferred first, horizontally scrollable), and tapping an unconnected one
 * opens ITS connect drawer — only a successful connect adopts it, so there is no selected-but-
 * not-connected limbo. Tapping an already-connected card just makes it the one this agent uses.
 * Everything — the row's identity, the connection state, what is reported up for gating —
 * follows the provider in use, defaulting to whichever is already connected (else the slot's
 * preferred). Without `onSelect` (the drawer), the choice renders as static "or …" text.
 *
 * Connection state is read live from the workspace connections — connecting here is a real,
 * durable act, so a row can already be `Connected` on first render.
 *
 * Two shapes: the flat row (single-connection cards, the drawer), and `accordion` — one section
 * of a multi-connection card, a slim header over a collapsible body. Both share the queries,
 * the reporting, the provider switch and the Connect drawer; only the chrome differs.
 */
import {useEffect, useState} from "react"

import {
    isConnectionActive,
    useToolIntegrationConnections,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {PROVIDERS, type DetectedAccount} from "@agenta/entities/workflow"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import {Button} from "@agenta/ui/ui"
import {CaretDown, CheckCircle, Circle, Plugs} from "@phosphor-icons/react"
import clsx from "clsx"
import Image from "next/image"

import ConnectDrawer from "../gatewayTool/drawers/ConnectDrawer"

export interface AccountRowProps {
    account: DetectedAccount
    /** Report the live connection state up so the card can compute what is left. */
    onConnectedChange: (slug: string, connected: boolean) => void
    /**
     * A provider that already satisfies this need — the row's own, or one of its alternatives.
     * Resolved by the card from the project's connections so a need the workspace already meets
     * is settled on sight instead of asked for again.
     */
    satisfiedVia?: string
    /** The provider this row currently acts as. Resolved by the card; defaults to the row's own. */
    selectedSlug?: string
    /** The choice was made: `(rowSlug, providerSlug)`. Omitted, alternatives render as text. */
    onSelect?: (rowSlug: string, providerSlug: string) => void
    /**
     * Whether a given provider has a live workspace connection — resolved by the card (it holds
     * the whole connections list; this row only queries its own active provider), so every
     * option card can show its true state.
     */
    providerConnected?: (slug: string) => boolean
    /**
     * Render as one SECTION of the card: a slim header (status, provider, state) over a body
     * holding the scope line, the provider switch and the actions. With `onToggle` it is one
     * section of the multi-connection accordion; without it (a single connection) the header is
     * inert, the chevron is gone and the body stays open. Off entirely (the default), the row
     * is the flat boxed row the template drawer still renders.
     */
    accordion?: boolean
    /** Section only: this section's body is the open one. */
    open?: boolean
    /** Section only: the header was tapped. Omitted = not collapsible (single connection). */
    onToggle?: () => void
}

/** A slug's display name, for naming an alternative the row has no detail query for. */
const providerLabel = (slug: string): string => PROVIDERS[slug]?.label ?? slug

const AccountRow = ({
    account,
    onConnectedChange,
    satisfiedVia,
    selectedSlug,
    onSelect,
    providerConnected,
    accordion = false,
    open = false,
    onToggle,
}: AccountRowProps) => {
    // The provider this row is currently about. Everything below follows it.
    const active = selectedSlug ?? satisfiedVia ?? account.slug
    const {integration: detail} = useToolIntegrationDetail(active)
    const {connections} = useToolIntegrationConnections(active)
    const connected = connections.some(isConnectionActive)
    const [connectOpen, setConnectOpen] = useState(false)
    /**
     * The provider the Connect drawer is FOR — decoupled from `active`, because tapping an
     * unconnected alternative starts ITS connect flow without moving the choice: only a
     * SUCCESSFUL connect adopts it (`onSelect`), so closing the drawer leaves nothing behind —
     * no "will use, connect next" limbo, and no revert bookkeeping.
     */
    const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
    const {integration: drawerDetail} = useToolIntegrationDetail(drawerSlug ?? active)

    useEffect(() => {
        // Report the provider the row is acting as, so gating counts the actual choice — and
        // un-report it when the choice moves on, or a deselected provider's old `true` would
        // keep satisfying a need the user just pointed elsewhere.
        onConnectedChange(active, connected)
        return () => onConnectedChange(active, false)
    }, [connected, active, onConnectedChange])

    const activeIsOwn = active === account.slug
    const name = activeIsOwn
        ? (detail?.name ?? account.label)
        : (detail?.name ?? providerLabel(active))
    const logo = detail?.logo ?? (activeIsOwn ? account.logo : PROVIDERS[active]?.logo)
    const options = account.alternatives?.length ? [account.slug, ...account.alternatives] : []
    // Only an unconnected REQUIRED account is highlighted: it is the one thing standing between
    // the user and their agent. A suggested account is an offer, so it stays quiet.
    const blocking = account.required && !connected

    const drawerFor = drawerSlug ?? active
    const connectDrawer = (
        <ConnectDrawer
            open={connectOpen}
            integrationKey={drawerFor}
            integrationName={drawerDetail?.name ?? providerLabel(drawerFor)}
            integrationLogo={drawerDetail?.logo ?? PROVIDERS[drawerFor]?.logo ?? undefined}
            integrationDescription={account.why}
            authSchemes={drawerDetail?.auth_schemes ?? ["oauth"]}
            onClose={() => {
                setConnectOpen(false)
                setDrawerSlug(null)
            }}
            onSuccess={() => {
                setConnectOpen(false)
                // Connecting IS choosing: the provider that just connected becomes the one
                // this agent uses. A drawer merely closed adopts nothing.
                if (drawerSlug && drawerSlug !== active) onSelect?.(account.slug, drawerSlug)
                setDrawerSlug(null)
            }}
        />
    )

    /**
     * The provider CARDS (one per option, horizontally scrollable): tapping an unconnected one
     * opens ITS connect drawer — choosing and connecting are one act; tapping one that is
     * already connected simply makes it the one this agent uses. The ring marks the provider in
     * use; the template's preference is carried by ORDER (primary first), not by a label. A
     * single-provider slot renders its one card too — the row is titled by the NEED ("Email"),
     * so the card is where the provider (Gmail) shows its face.
     */
    const cardOptions = options.length ? options : [account.slug]
    const providerCards =
        onSelect && cardOptions.length ? (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
                {cardOptions.map((slug) => {
                    const optionConnected = providerConnected?.(slug) ?? false
                    const inUse = slug === active && (optionConnected || connected)
                    return (
                        <button
                            key={slug}
                            type="button"
                            aria-pressed={inUse}
                            onClick={() => {
                                if (inUse) return
                                if (optionConnected) {
                                    onSelect(account.slug, slug)
                                    return
                                }
                                setDrawerSlug(slug)
                                setConnectOpen(true)
                            }}
                            className={clsx(
                                "box-border flex min-h-[52px] min-w-[148px] shrink-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-solid bg-transparent px-3 py-2 text-left transition-colors",
                                inUse
                                    ? "border-[var(--ag-colorPrimary)]"
                                    : "border-[var(--ag-colorBorderSecondary)] hover:border-[var(--ag-colorTextTertiary)]",
                            )}
                        >
                            {PROVIDERS[slug]?.logo ? (
                                <Image
                                    src={PROVIDERS[slug].logo}
                                    alt=""
                                    width={18}
                                    height={18}
                                    unoptimized
                                    className="shrink-0 object-contain"
                                />
                            ) : (
                                <Plugs
                                    size={18}
                                    className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                                />
                            )}
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-xs font-medium text-[var(--ag-colorText)]">
                                    {providerLabel(slug)}
                                </span>
                                {optionConnected ? (
                                    <span className="text-[10px] text-[var(--ag-colorSuccess)]">
                                        Connected
                                    </span>
                                ) : null}
                            </span>
                        </button>
                    )
                })}
            </div>
        ) : null

    if (accordion) {
        const stateText = connected ? "Connected" : account.required ? "Required" : "Optional"
        return (
            <div
                className={clsx(
                    "border-x-0 border-b border-t-0 border-solid border-[var(--ag-colorSplit)] transition-colors last:border-b-0",
                    open && blocking && "bg-[var(--ag-colorWarningBg)]",
                )}
            >
                <button
                    type="button"
                    onClick={onToggle}
                    disabled={!onToggle}
                    aria-expanded={onToggle ? open : undefined}
                    className={clsx(
                        "flex min-h-11 w-full items-center gap-2.5 border-0 bg-transparent px-1 py-1 text-left",
                        onToggle ? "cursor-pointer" : "cursor-default",
                    )}
                >
                    {connected ? (
                        <CheckCircle
                            size={15}
                            weight="fill"
                            className="shrink-0 text-[var(--ag-colorSuccess)]"
                        />
                    ) : (
                        <Circle
                            size={15}
                            className={clsx(
                                "shrink-0",
                                blocking
                                    ? "text-[var(--ag-colorWarning)]"
                                    : "text-[var(--ag-colorTextTertiary)]",
                            )}
                        />
                    )}
                    {/* A slot with a choice is titled by its NEED ("CRM"), never one provider —
                        "HubSpot · Optional" over a HubSpot/Salesforce/Attio choice misleads.
                        Once connected, the provider actually in use rides along. */}
                    <span className="truncate text-xs font-medium text-[var(--ag-colorText)]">
                        {account.needLabel ?? name}
                    </span>
                    {account.needLabel && connected ? (
                        <span className="shrink-0 truncate text-[11px] text-[var(--ag-colorTextSecondary)]">
                            {name}
                        </span>
                    ) : null}
                    <span
                        className={clsx(
                            "shrink-0 text-[11px]",
                            connected
                                ? "text-[var(--ag-colorSuccess)]"
                                : blocking
                                  ? "text-[var(--ag-colorWarning)]"
                                  : "text-[var(--ag-colorTextTertiary)]",
                        )}
                    >
                        {stateText}
                    </span>
                    <span className="flex-1" />
                    {onToggle ? (
                        <CaretDown
                            size={13}
                            className={clsx(
                                "shrink-0 text-[var(--ag-colorTextTertiary)] transition-transform",
                                open && "rotate-180",
                            )}
                        />
                    ) : null}
                </button>
                <HeightCollapse open={open} fade>
                    <div className="flex flex-col gap-2.5 pb-3 pl-[26px] pr-1">
                        {account.why ? (
                            <p className="m-0 text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                                {account.why}
                            </p>
                        ) : null}
                        {providerCards}
                        {/* Cards carry the connect action for a slot with a choice; only a
                            single-provider slot still needs the plain Connect button. There is
                            no Skip: leaving an optional slot unconnected IS the skip. */}
                        {!connected && !providerCards ? (
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConnectOpen(true)}
                                >
                                    Connect
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </HeightCollapse>
                {connectDrawer}
            </div>
        )
    }

    return (
        <div
            className={clsx(
                "rounded-lg border border-solid p-3 transition-colors",
                connected
                    ? "border-[var(--ag-colorSuccessBorder)] bg-[var(--ag-colorSuccessBg)]"
                    : blocking
                      ? "border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)]"
                      : "border-[var(--ag-colorBorderSecondary)]",
            )}
        >
            <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]">
                    {logo ? (
                        <Image
                            src={logo}
                            alt={name}
                            width={20}
                            height={20}
                            unoptimized
                            className="object-contain"
                        />
                    ) : (
                        <Plugs size={18} className="text-[var(--ag-colorTextSecondary)]" />
                    )}
                </span>

                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-medium text-[var(--ag-colorText)]">
                            {name}
                        </span>
                        {/* Static fallback for hosts without selection (the drawer): the choice is
                            at least stated, even where it cannot be taken. */}
                        {!onSelect && !connected && options.length ? (
                            <span className="shrink-0 text-[10px] text-[var(--ag-colorTextTertiary)]">
                                or{" "}
                                {options
                                    .filter((slug) => slug !== active)
                                    .map(providerLabel)
                                    .join(" or ")}
                            </span>
                        ) : null}
                        {account.required ? (
                            <span className="shrink-0 rounded-full border border-solid border-[var(--ag-colorWarningBorder)] px-1.5 text-[10px] font-medium text-[var(--ag-colorWarning)]">
                                Required
                            </span>
                        ) : null}
                    </div>
                    {/* Only a template row carries a scope line; a detected one has nothing
                        per-account to say, so it gets no second line at all. */}
                    {account.why ? (
                        <div className="truncate text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                            {account.why}
                        </div>
                    ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    {connected ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-[var(--ag-colorSuccess)]">
                            <CheckCircle size={13} weight="fill" />
                            Connected
                        </span>
                    ) : (
                        <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
                            Connect
                        </Button>
                    )}
                </div>
            </div>

            {connectDrawer}
        </div>
    )
}

export default AccountRow

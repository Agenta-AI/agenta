/**
 * The model-providers drawer — one component, three entry contexts.
 *
 * The contexts differ in what they can honestly show. Settings has a connections table beside the
 * drawer, so the drawer is the catalog and nothing else. The agent playground has no such table
 * and a harness runtime underneath it, so it gets Connected above the catalog and Subscriptions
 * below. The completion playground has the table's problem but not the runtime — a completion runs
 * no harness — so it gets Connected and drops Subscriptions.
 *
 * Structure: everything is pinned except the catalog. Connected, Subscriptions, and the footer
 * hold their place while the catalog absorbs all spare height, which is what keeps the footer off
 * the bottom of an empty column.
 *
 * Selecting a provider pushes the connection card into the same drawer, and a subscription row
 * pushes its pair card — no modal, and a back arrow only when the level was pushed from a list.
 *
 * Design: providers-drawer-final/README.md
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import type {
    ProviderCatalogEntry,
    ProviderConnection,
    SubscriptionPair,
} from "@agenta/entities/secret"
import {providerTitleForKind} from "@agenta/entities/secret"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft, ArrowSquareOut, WarningCircle, X} from "@phosphor-icons/react"
import Link from "next/link"
import {useRouter} from "next/router"

import {DrawerFooter} from "../drawers/shared/DrawerFooter"
import {harnessMetaFor} from "../DrillInView/SchemaControls/harnessMeta"

import {harnessMarkNode} from "./harnessMark"
import {
    PlaygroundConnectedSection,
    PlaygroundSubscriptionsSection,
} from "./PlaygroundProviderSections"
import ProviderCatalogList from "./ProviderCatalogList"
import ProviderConnectionCard, {type ProviderCardSaveState} from "./ProviderConnectionCard"
import SubscriptionPairCard, {type SubscriptionPairCardSaveState} from "./SubscriptionPairCard"

/**
 * Where the drawer was opened from. `playground` is the AGENT playground (the one with a harness
 * runtime); `completion` is the completion engine's, which has connections but no harnesses.
 */
export type ProviderDrawerContext = "settings" | "playground" | "completion"

export interface ProviderDrawerProps {
    open: boolean
    onClose: () => void
    context: ProviderDrawerContext
    /** Every connection in the project — the card's name preview and the playground contexts read them. */
    connections: ProviderConnection[]
    /** Open straight on this saved connection's card (a Settings table row click). */
    connection?: ProviderConnection | null
    /** Called after a connection is saved, so the host can refetch the vault. */
    onSaved?: () => void
    /** Where "configured in the deployment" points. */
    subscriptionDocsUrl?: string
    /**
     * Whether subscriptions are reachable at all. A cloud deployment cannot mount a provider
     * login, so the rows are hidden there — same gate the playground picker applies.
     */
    showSubscriptions?: boolean
    /** Panel width. 480 by default; 400 is the floor and 560 the roomy variant. */
    width?: number
}

/** Which level the drawer is showing. `pushed` records whether a back arrow belongs on it. */
type DrawerView =
    | {level: "catalog"}
    | {level: "connection"; kind: string; connection: ProviderConnection | null; pushed: boolean}
    | {level: "subscription"; pair: SubscriptionPair}

const DEFAULT_SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** DrawerFooter brings its own rule and padding, so the drawer's footer slot must add neither. */
const CARD_FOOTER_STYLE = {padding: 0, border: 0, display: "block"} as const

/**
 * The catalog level owns its own padding and its own scroller, so the drawer body gives up both:
 * it becomes a plain column that clips, and the catalog inside it is what scrolls.
 */
const LIST_BODY_STYLE = {
    padding: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
} as const

/**
 * The card levels keep the body's padding and let it scroll, which is the short-viewport fallback:
 * the card's own flexible region takes the height when there is any, and the body takes over when
 * the fixed sections no longer fit.
 */
const CARD_BODY_STYLE = {display: "flex", flexDirection: "column"} as const

/** The catalog's footer is a paper strip, not a button row: a note on the left, a link on the right. */
const LIST_FOOTER_STYLE = {
    background: "var(--ag-colorFillQuaternary)",
    padding: "10px 24px",
} as const

/** Wide enough for a model id and a tag on one line, narrow enough to read as a side panel. */
const DRAWER_WIDTH = 480

/**
 * The AI-providers settings tab, scoped to the project in the current route (the tab key is
 * legacy). Read off the router's `asPath` rather than `window.location`: asPath is basePath-
 * relative, so this stays right on the mobile app, which is mounted under `/m`. `null` on a route
 * with no project in it — there is no settings page to point at, so the footer drops the link.
 */
const useSettingsHref = (): string | null => {
    const router = useRouter()
    const projectPath = router.asPath.split("?")[0].match(/^(\/w\/[^/]+\/p\/[^/]+)/)?.[1]
    return projectPath ? `${projectPath}/settings?tab=llms` : null
}

const ProviderDrawer = ({
    open,
    onClose,
    context,
    connections,
    connection,
    onSaved,
    subscriptionDocsUrl = DEFAULT_SUBSCRIPTION_DOCS_URL,
    showSubscriptions = true,
    width = DRAWER_WIDTH,
}: ProviderDrawerProps) => {
    const [view, setView] = useState<DrawerView>({level: "catalog"})
    /**
     * The connections the user actually connected. A provisioned one (`managedBy`) is not editable
     * — saving it answers 409 — so it is neither counted nor listed, the same rule the Settings
     * table applies. It stays in the `connections` prop the card reads, and in the callers' own
     * lists, so the model picker and the "Connect key" gate keep counting it.
     */
    const userConnections = useMemo(
        () => connections.filter((candidate) => !candidate.managedBy),
        [connections],
    )
    const visibleCount = userConnections.length
    const settingsHref = useSettingsHref()
    // The card owns the save; the footer that triggers it lives out here, so the card publishes
    // what it needs. Cleared on every level change — the next card publishes its own.
    const [cardSave, setCardSave] = useState<ProviderCardSaveState | null>(null)
    const [pairSave, setPairSave] = useState<SubscriptionPairCardSaveState | null>(null)

    const showView = useCallback((next: DrawerView) => {
        setCardSave(null)
        setPairSave(null)
        setView(next)
    }, [])

    // Opening is what decides the level: with a connection the drawer goes straight to its card
    // (and shows no back arrow, because there is no list behind it); without one, the catalog.
    useEffect(() => {
        if (!open) return
        showView(
            connection
                ? {level: "connection", kind: connection.kind, connection, pushed: false}
                : {level: "catalog"},
        )
    }, [open, connection, showView])

    const onPickProvider = (entry: ProviderCatalogEntry) =>
        showView({level: "connection", kind: entry.kind, connection: null, pushed: true})

    const goBack = () => showView({level: "catalog"})

    const isSettings = context === "settings"
    const showConnected = !isSettings
    // Only the agent playground runs a harness, so only it can offer a subscription.
    const showSubscriptionRows = context === "playground" && showSubscriptions

    const backButton = (
        <button
            type="button"
            aria-label="Back to the provider catalog"
            onClick={goBack}
            className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-colorText"
        >
            <ArrowLeft size={16} />
        </button>
    )

    /**
     * What the title may occupy before it has to truncate.
     *
     * `SheetTitle` is `flex-1` but carries no `min-w-0`, so its automatic minimum size would let a
     * long connection name grow the header and shove the close button off the edge. Bounding the
     * title here is what makes its `truncate` actually engage: the header's 24px padding either
     * side, its 8px gap, and the 22px close button.
     */
    const titleMaxWidth = width - 24 * 2 - 8 - 22

    /**
     * The drawer's own close, on the RIGHT.
     *
     * `Sheet` puts its built-in X FIRST in the header row, which on a pushed level lands it on top
     * of the back arrow. So the built-in one is switched off (`closable={false}`) and this rides
     * the `extra` slot instead, which renders after the flex-1 title — i.e. far right. Styled to
     * match `SheetHeader`'s own close so the two are indistinguishable.
     */
    const closeButton = (
        <button
            type="button"
            aria-label="Close"
            onClick={() => onClose()}
            className="box-border flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-control-sm border-0 bg-transparent p-0 text-colorIcon transition-colors hover:bg-colorFillQuaternary hover:text-colorIconHover"
        >
            <X size={14} />
        </button>
    )

    const title =
        view.level === "catalog" ? (
            isSettings ? (
                "Add a provider"
            ) : (
                "Model providers"
            )
        ) : view.level === "subscription" ? (
            <span className="flex min-w-0 items-center gap-2" style={{maxWidth: titleMaxWidth}}>
                {backButton}
                <span className="truncate">{view.pair.name}</span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-control-sm bg-colorFillTertiary px-1.5 py-0.5 text-field-sm font-normal text-colorTextSecondary">
                    {harnessMarkNode(view.pair.harness)}
                    {harnessMetaFor(view.pair.harness).label}
                </span>
            </span>
        ) : (
            // A connection name is user-supplied, so it truncates rather than shoving the X out.
            <span className="flex min-w-0 items-center gap-2" style={{maxWidth: titleMaxWidth}}>
                {view.pushed ? backButton : null}
                <span className="truncate">
                    {view.connection?.name ?? providerTitleForKind(view.kind)}
                </span>
            </span>
        )

    // Cancel undoes the step that opened the card: back to the catalog when it was pushed from
    // there, and out of the drawer when a table row opened it directly.
    const onCardCancel = view.level === "connection" && view.pushed ? goBack : onClose

    // The card levels footer Cancel/Done for the card below them. On the catalog it is one note:
    // from Settings, that subscriptions are not something this drawer can add; from a playground,
    // what is connected and where it gets renamed or removed.
    const footer =
        view.level === "connection" ? (
            <DrawerFooter
                onCancel={onCardCancel}
                left={
                    cardSave?.error ? (
                        <span className="flex items-center gap-1 text-colorError">
                            <WarningCircle size={16} />
                            {cardSave.error}
                        </span>
                    ) : undefined
                }
                isMutating={cardSave?.saving}
                canSave={cardSave?.canSave ?? false}
                // One label in every entry context: nothing is written until it is pressed, which
                // is as true of the first save as of the tenth.
                submitLabel="Done"
                cancelVariant="ghost"
                onSubmit={() => cardSave?.submit()}
            />
        ) : view.level === "subscription" ? (
            <DrawerFooter
                onCancel={goBack}
                canSave
                submitLabel="Done"
                cancelVariant="ghost"
                onSubmit={() => pairSave?.submit()}
            />
        ) : isSettings ? (
            <p className="m-0 flex w-full items-center justify-between gap-4 text-field-sm text-colorTextSecondary">
                <span>Subscriptions are configured in your deployment, not added here.</span>
                <a
                    href={subscriptionDocsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex shrink-0 items-center gap-1 text-btn-link hover:text-btn-link-hover"
                >
                    docs
                    <ArrowSquareOut size={12} />
                </a>
            </p>
        ) : (
            <p className="m-0 flex w-full items-center justify-between gap-4 text-field-sm text-colorTextSecondary">
                {/* A count over an empty list says nothing; the link is the whole footer then. */}
                <span>{visibleCount ? `${visibleCount} connected` : ""}</span>
                {settingsHref ? (
                    // In-app navigation, so `Link` rather than a bare anchor: it prefixes the
                    // host's basePath and skips the full reload. The drawer closes behind it.
                    <Link
                        href={settingsHref}
                        onClick={onClose}
                        className="flex shrink-0 items-center gap-1 text-btn-link hover:text-btn-link-hover"
                    >
                        Manage in Settings
                        <ArrowSquareOut size={12} />
                    </Link>
                ) : null}
            </p>
        )

    return (
        <EnhancedDrawer
            open={open}
            onClose={onClose}
            title={title}
            width={width}
            // The X moves to the `extra` slot on every level and context, so the back arrow on a
            // pushed level is never sitting under it.
            closable={false}
            extra={closeButton}
            footer={footer}
            styles={
                view.level === "catalog"
                    ? {body: LIST_BODY_STYLE, footer: LIST_FOOTER_STYLE}
                    : {body: CARD_BODY_STYLE, footer: CARD_FOOTER_STYLE}
            }
        >
            {view.level === "catalog" ? (
                <>
                    {showConnected ? (
                        <PlaygroundConnectedSection
                            connections={userConnections}
                            onSelect={(picked) =>
                                showView({
                                    level: "connection",
                                    kind: picked.kind,
                                    connection: picked,
                                    pushed: true,
                                })
                            }
                        />
                    ) : null}
                    <ProviderCatalogList
                        onSelect={onPickProvider}
                        label={isSettings ? undefined : "Add a provider"}
                        hint={isSettings ? undefined : "several connections per provider are fine"}
                    />
                    {showSubscriptionRows ? (
                        <PlaygroundSubscriptionsSection
                            subscriptionDocsUrl={subscriptionDocsUrl}
                            onSelectPair={(pair) => showView({level: "subscription", pair})}
                        />
                    ) : null}
                </>
            ) : view.level === "subscription" ? (
                <SubscriptionPairCard
                    key={view.pair.key}
                    pair={view.pair}
                    docsUrl={subscriptionDocsUrl}
                    onDone={goBack}
                    onSaveStateChange={setPairSave}
                />
            ) : (
                <ProviderConnectionCard
                    key={view.connection?.id ?? view.kind}
                    kind={view.kind}
                    connection={view.connection}
                    connections={connections}
                    onSaveStateChange={setCardSave}
                    onSaved={() => {
                        onSaved?.()
                        onClose()
                    }}
                />
            )}
        </EnhancedDrawer>
    )
}

export default ProviderDrawer

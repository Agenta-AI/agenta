/**
 * The AI-providers drawer — one component, two entry contexts.
 *
 * From Settings it shows the catalog only: the table beside it already lists every connection, and
 * a table row opens that connection's card directly. From the playground (pull request 3) the same
 * drawer gains a Connected section and subscription rows, because the playground has nowhere else
 * to show them. The context prop is the seam; the settings context is what ships here.
 *
 * Selecting a provider pushes the connection card into the same drawer — no modal, and a back
 * arrow only when the card was pushed from the catalog.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider drawer").
 */
import {useEffect, useState} from "react"

import type {ProviderCatalogEntry, ProviderConnection} from "@agenta/entities/secret"
import {providerTitleForKind} from "@agenta/entities/secret"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft} from "@phosphor-icons/react"

import {
    PlaygroundConnectedSection,
    PlaygroundSubscriptionsSection,
} from "./PlaygroundProviderSections"
import ProviderCatalogList from "./ProviderCatalogList"
import ProviderConnectionCard from "./ProviderConnectionCard"

/** Where the drawer was opened from. The contexts differ in what they list, by design. */
export type ProviderDrawerContext = "settings" | "playground"

export interface ProviderDrawerProps {
    open: boolean
    onClose: () => void
    context: ProviderDrawerContext
    /** Every connection in the project — the card's name preview and the playground context read them. */
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
}

/** Which level the drawer is showing. `pushed` records whether a back arrow belongs on the card. */
type DrawerView =
    | {level: "catalog"}
    | {level: "connection"; kind: string; connection: ProviderConnection | null; pushed: boolean}

const DEFAULT_SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** The AI-providers settings tab, derived from the current project path (the tab key is legacy). */
const settingsHref = (): string => {
    const projectPath =
        typeof window === "undefined"
            ? null
            : window.location.pathname.match(/^(\/w\/[^/]+\/p\/[^/]+)/)?.[1]
    return `${projectPath ?? ""}/settings?tab=llms`
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
}: ProviderDrawerProps) => {
    const [view, setView] = useState<DrawerView>({level: "catalog"})

    // Opening is what decides the level: with a connection the drawer goes straight to its card
    // (and shows no back arrow, because there is no list behind it); without one, the catalog.
    useEffect(() => {
        if (!open) return
        setView(
            connection
                ? {level: "connection", kind: connection.kind, connection, pushed: false}
                : {level: "catalog"},
        )
    }, [open, connection])

    const onPickProvider = (entry: ProviderCatalogEntry) =>
        setView({level: "connection", kind: entry.kind, connection: null, pushed: true})

    const goBack = () => setView({level: "catalog"})

    const isPlaygroundCatalog = view.level === "catalog" && context === "playground"

    const title =
        view.level === "catalog" ? (
            context === "playground" ? (
                "AI providers"
            ) : (
                "Add a provider"
            )
        ) : (
            <span className="flex items-center gap-2">
                {view.pushed ? (
                    <button
                        type="button"
                        aria-label="Back to the provider catalog"
                        onClick={goBack}
                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-colorText"
                    >
                        <ArrowLeft size={16} />
                    </button>
                ) : null}
                {view.connection?.name ?? providerTitleForKind(view.kind)}
            </span>
        )

    // One footer note, only on the catalog: subscriptions are not something this drawer can add.
    // From the playground the footer instead counts what is connected and points at Settings, the
    // one place a connection can be renamed or removed.
    const footer =
        view.level === "catalog" && context === "settings" ? (
            <p className="m-0 px-6 py-3 text-colorTextSecondary">
                Claude and ChatGPT subscriptions are configured in your deployment, not added here.{" "}
                <a href={subscriptionDocsUrl} target="_blank" rel="noreferrer">
                    How to set one up
                </a>
                .
            </p>
        ) : isPlaygroundCatalog ? (
            <p className="m-0 flex items-center justify-between gap-4 px-6 py-3 text-colorTextSecondary">
                <span>
                    {connections.length} {connections.length === 1 ? "provider" : "providers"}{" "}
                    connected
                </span>
                <a href={settingsHref()}>Manage in Settings</a>
            </p>
        ) : null

    return (
        <EnhancedDrawer open={open} onClose={onClose} title={title} width={520} footer={footer}>
            {view.level === "catalog" ? (
                <>
                    {isPlaygroundCatalog ? (
                        <PlaygroundConnectedSection
                            connections={connections}
                            onSelect={(picked) =>
                                setView({
                                    level: "connection",
                                    kind: picked.kind,
                                    connection: picked,
                                    pushed: true,
                                })
                            }
                        />
                    ) : null}
                    <ProviderCatalogList onSelect={onPickProvider} />
                    {isPlaygroundCatalog && showSubscriptions ? (
                        <PlaygroundSubscriptionsSection subscriptionDocsUrl={subscriptionDocsUrl} />
                    ) : null}
                </>
            ) : (
                <ProviderConnectionCard
                    key={view.connection?.id ?? view.kind}
                    kind={view.kind}
                    connection={view.connection}
                    connections={connections}
                    // Cancel undoes the step that opened the card: back to the catalog when it was
                    // pushed from there, and out of the drawer when a table row opened it directly.
                    onCancel={view.pushed ? goBack : onClose}
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

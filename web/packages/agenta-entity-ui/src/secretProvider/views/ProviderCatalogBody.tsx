/**
 * The Model providers catalog, as Settings › AI providers lists it: "Connected", then
 * "Subscriptions", "Model providers" and "Cloud platforms", one search fixed above one scroll.
 * A body, not a view: the host says how a picked row's view opens (`open`).
 */
import {createElement, useMemo, useState, type ReactNode} from "react"

import {
    buildModelProviderList,
    providerConnectionsAtom,
    subscriptionConnectionFor,
    subscriptionProviderFamily,
    subscriptionProviderName,
    vaultSecretsQueryAtom,
    type ProviderCatalogEntry,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {builtinModelEndpointsQueryAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import providerDrawerCatalog from "@agenta/i18n/catalogs/entityUi.providerDrawer"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    IconTile,
    SearchInput,
    SimpleTooltip,
} from "@agenta/ui/ui"
import type {ViewDef} from "@agenta/ui/view-stack"
import {MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {CanvasGroupHeader} from "../../DrillInView/SchemaControls/agentTemplate/CanvasGroupHeader"
import {CatalogListRow} from "../../DrillInView/SchemaControls/agentTemplate/CatalogListRow"
import {credentialSummaryText} from "../providerCardText"
import {
    CLOUD_PLATFORMS,
    MODEL_PROVIDERS,
    providerCatalogDescription,
    providerCatalogTitle,
    SUBSCRIPTION_HINT,
    SUBSCRIPTION_PRODUCTS,
} from "../providerCatalogText"
import {providerIconFor} from "../providerIcon"
import {subscriptionStatusLine} from "../subscriptionText"

import {ProviderCatalogSkeleton} from "./ProviderCatalogSkeleton"
import {builtinModelsView, providerConnectionView} from "./providerViews"
import {subscriptionViewFor, subscriptionViewOf} from "./subscriptionViews"

/** A sign-in never finished (a cancelled Connect): still one to start, not held. */
const neverSignedIn = (connection: ProviderConnection) =>
    connection.subscription?.loginState === "pending_login"

export type OpenProviderView = <P>(view: ViewDef<P>, params: P) => void

interface Row {
    key: string
    kind: string
    name: string
    description?: string
    /** The problem beside the name (a sign-in that expired). */
    attention?: string
    /** Set on a row one click from connecting: the "+" and its label. */
    connectLabel?: string
    onOpen: () => void
}

/** The provider's mark: its logo on a 32 px tile, as the integration rows draw theirs. */
const ProviderMark = ({kind}: {kind: string}) => (
    <IconTile size={32} className="text-foreground">
        {createElement(providerIconFor(kind))}
    </IconTile>
)

const CatalogRow = ({row}: {row: Row}) => (
    <CatalogListRow
        variant="canvas"
        onClick={row.onOpen}
        actionLabel={row.connectLabel ?? row.name}
        leading={<ProviderMark kind={row.kind} />}
        title={row.name}
        titleSuffix={
            row.attention ? (
                <span className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-warning">
                    <span aria-hidden className="size-1.5 rounded-round bg-current" />
                    {row.attention}
                </span>
            ) : null
        }
        action={
            row.connectLabel ? (
                <SimpleTooltip title={row.connectLabel}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        // The integration catalog's "+": shown on row hover and focus, always on touch.
                        className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0"
                        aria-label={row.connectLabel}
                        onClick={row.onOpen}
                    >
                        <Plus />
                    </Button>
                </SimpleTooltip>
            ) : undefined
        }
    >
        {row.description ? (
            <span className="truncate text-meta text-muted-foreground" title={row.description}>
                {row.description}
            </span>
        ) : null}
    </CatalogListRow>
)

const Group = ({label, children}: {label: string; children: ReactNode}) => (
    <section className="flex flex-col">
        <CanvasGroupHeader label={label} />
        <div className="flex flex-col gap-2 pt-2">{children}</div>
    </section>
)

export const ProviderCatalogBody = ({open}: {open: OpenProviderView}) => {
    const t = useT(
        providerListCatalog,
        providerDrawerCatalog,
        settingsProvidersCatalog,
        commonCatalog,
    )
    const [query, setQuery] = useState("")
    const connections = useAtomValue(providerConnectionsAtom)
    const vault = useAtomValue(vaultSecretsQueryAtom)
    const builtinEndpoints = useAtomValue(builtinModelEndpointsQueryAtom).data
    const list = useMemo(
        () => buildModelProviderList({connections, builtinEndpoints}),
        [connections, builtinEndpoints],
    )
    const loading = vault.isPending
    const failed = vault.isError && !connections.length

    const groups = useMemo(() => {
        const term = query.trim().toLowerCase()
        const matches = (row: Row) =>
            !term || row.name.toLowerCase().includes(term) || row.kind.includes(term)
        const openConnection = (connection: ProviderConnection) =>
            open(providerConnectionView, {kind: connection.kind, connectionId: connection.id})
        const openSubscription = (connection: ProviderConnection) => {
            const {view, params} = subscriptionViewOf(connection)
            open(view, params)
        }
        const connected: Row[] = [
            ...(list.builtin
                ? [
                      {
                          key: "builtin:agenta",
                          kind: "agenta",
                          name: t("entityUi.providerList.agenta"),
                          description: t("entityUi.providerList.builtIn"),
                          onOpen: () => open(builtinModelsView, {}),
                      },
                  ]
                : []),
            ...list.subscriptions
                .filter(({connection}) => !neverSignedIn(connection))
                .map(({connection, signInNeeded}) => ({
                    key: connection.id,
                    kind: connection.kind,
                    name: connection.name,
                    description:
                        subscriptionStatusLine(connection.subscription) || t("common.notConnected"),
                    attention: signInNeeded ? t("settings.providers.needsSignIn") : undefined,
                    onOpen: () => openSubscription(connection),
                })),
            ...list.apiKeys.map((connection) => ({
                key: connection.id,
                kind: connection.kind,
                name: connection.name,
                description: credentialSummaryText(connection) || undefined,
                onOpen: () => openConnection(connection),
            })),
        ]
        // A held subscription lists under Connected; only a sign-in never finished is offered.
        const subscriptions: Row[] = SUBSCRIPTION_PRODUCTS.filter((provider) => {
            const held = subscriptionConnectionFor(connections, provider)
            return !held || neverSignedIn(held)
        }).map((provider) => {
            const name = subscriptionProviderName(provider)
            return {
                key: `subscription:${provider}`,
                kind: subscriptionProviderFamily(provider),
                name,
                description: t(SUBSCRIPTION_HINT[provider]),
                connectLabel: t("settings.providers.connectName", {name}),
                onOpen: () => open(subscriptionViewFor(provider), {provider, start: true}),
            }
        })
        const catalogRow = (entry: ProviderCatalogEntry): Row => {
            const name = providerCatalogTitle(entry, t)
            return {
                key: entry.kind,
                kind: entry.kind,
                name,
                description: providerCatalogDescription(entry, t),
                connectLabel: t("settings.providers.connectName", {name}),
                onOpen: () => open(providerConnectionView, {kind: entry.kind}),
            }
        }
        return [
            {key: "connected", label: t("common.connected"), rows: connected.filter(matches)},
            {
                key: "subscriptions",
                label: t("settings.providers.subscriptions"),
                rows: subscriptions.filter(matches),
            },
            {
                key: "model-providers",
                label: t("settings.providers.modelProviders"),
                rows: MODEL_PROVIDERS.map(catalogRow).filter(matches),
            },
            {
                key: "cloud-platforms",
                label: t("settings.providers.cloudPlatforms"),
                rows: CLOUD_PLATFORMS.map(catalogRow).filter(matches),
            },
        ].filter((group) => group.rows.length)
    }, [connections, list, open, query, t])

    if (loading) return <ProviderCatalogSkeleton />

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Fixed above the scroll; pt-1 keeps the focus ring inside the body's clip. */}
            <div className="flex shrink-0 px-4 pb-2 pt-1">
                <SearchInput
                    className="min-w-0 flex-1 border-border-muted"
                    placeholder={t("entityUi.providerDrawer.searchProviders")}
                    value={query}
                    allowClear
                    onValueChange={setQuery}
                />
            </div>
            <div className="ag-scroll-fade flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3">
                {failed ? (
                    <div role="alert" className="flex items-center justify-between gap-2 pt-3">
                        <span className="text-label text-foreground">
                            {t("entityUi.providerList.loadFailed")}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => void vault.refetch()}
                        >
                            {t("common.tryAgain")}
                        </Button>
                    </div>
                ) : null}
                {groups.map((group) => (
                    <Group key={group.key} label={group.label}>
                        {group.rows.map((row) => (
                            <CatalogRow key={row.key} row={row} />
                        ))}
                    </Group>
                ))}
                {groups.length ? null : (
                    <Empty className="py-10">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <MagnifyingGlass />
                            </EmptyMedia>
                            <EmptyTitle>
                                {t("entityUi.providerDrawer.noProviderMatches")}
                            </EmptyTitle>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button variant="outline" onClick={() => setQuery("")}>
                                {t("common.clearSearch")}
                            </Button>
                        </EmptyContent>
                    </Empty>
                )}
            </div>
        </div>
    )
}

import {createElement, Fragment, type ReactNode, useCallback, useMemo, useState} from "react"

import {
    builtinModelsOf,
    PROVIDER_CATALOG,
    SecretKind,
    subscriptionConnectionFor,
    subscriptionIsReady,
    subscriptionProviderFamily,
    subscriptionProviderName,
    type ProviderCatalogEntry,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {builtinModelEndpointsQueryAtom} from "@agenta/entities/workflow"
import {OwnerChip} from "@agenta/entity-ui/secret"
import {
    BuiltinModelsSheet,
    ProviderDrawer,
    providerIconFor,
    ProviderOwnerChoiceContext,
    SubscriptionSheet,
    type OrganizationConnectionScope,
    type ProviderOwnerChoice,
    type SubscriptionSheetOwner,
    type SubscriptionViewParams,
} from "@agenta/entity-ui/secretProvider"
import {useT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import type {OwnerKind} from "@agenta/shared/types"
import {MagnifyingGlass, PencilSimpleLine, Trash, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"


/** What the host needs to render its own confirm chrome; the page owns the removal itself. */
export interface ProviderRemovalState {
    connection: ProviderConnection | null
    open: boolean
    pending: boolean
    error: string | null
    onConfirm: () => void
    onClose: () => void
}

/** Where a providers list gets its rows and what it may do with them. */
export interface ProvidersSource {
    /** Every connection of this owner: the drawer and the sign-in read them. */
    connections: ProviderConnection[]
    /** The rows of the group. */
    rows: ProviderConnection[]
    loading: boolean
    describe: (connection: ProviderConnection) => string
    /** Whether a row opens: a key in the drawer, a subscription in its sign-in. Every row does when absent. */
    canOpen?: (connection: ProviderConnection) => boolean
    /** Edit and delete on each row; a read-only list has neither. */
    manage: boolean
    remove: (connection: ProviderConnection) => Promise<void>
    removeFailed: (failure: unknown, connection: ProviderConnection) => string
    /** A load failure, shown under the group whether or not it has rows. */
    failure?: ReactNode
    /** Set for the organization's connections: the drawer and the sign-in save to the organization. */
    organization?: OrganizationConnectionScope
    /** Offers the ChatGPT and Claude sign-ins this owner does not hold yet, as rows. */
    offersSubscriptions?: boolean
    onSaved?: () => void
}

/** One owner's group on the page: the project's, or the organization's. */
export interface ProvidersGroup {
    key: string
    /** Whose rows these are; the chip on each row in a mixed list. */
    owner: OwnerKind
    source: ProvidersSource
}

/**
 * What the drawer is open on. A saved connection is held by id and read from the current list,
 * so a save that lands in part (the projects but not the key) shows the drawer what is stored.
 */
interface DrawerTarget {
    groupKey: string
    /** A saved connection to open on. */
    connectionId?: string
    /** A new connection of this kind (a catalog row). */
    kind?: string
}

type SubscriptionProvider = "chatgpt" | "claude"


const subscriptionProviderOf = (connection: ProviderConnection): SubscriptionProvider | null => {
    const provider = connection.subscription?.provider
    return provider === "chatgpt" || provider === "claude" ? provider : null
}

/** A provider's title as shown; the OpenAI-compatible kind's name is translated. */
export const providerTitle = (kind: string, title: string, t: ReturnType<typeof useT>): string =>
    kind === "custom" ? t("settings.providers.customEndpoint") : title

export const ProviderLogo = ({kind}: {kind: string}) =>
    createElement(providerIconFor(kind), {className: "size-4"})

/** What a credential-set kind's form asks for, read off its fields in `providerFields.ts`. */
const FORM_FIELDS_BY_KIND: Record<
    string,
    CatalogKey<typeof commonCatalog | typeof settingsProvidersCatalog>
> = {
    bedrock: "settings.providers.bedrockFields",
    azure: "settings.providers.azureFields",
    vertex_ai: "settings.providers.vertexFields",
}

const MODEL_PROVIDERS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.ProviderKey,
)
const CLOUD_PLATFORMS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.CustomProvider,
)

const catalogDescription = (
    entry: ProviderCatalogEntry,
    t: ReturnType<typeof useT>,
): string | undefined => {
    if (entry.kind === "custom") return t("settings.providers.customEndpointHint")
    if (entry.subtitle) return entry.subtitle
    if (entry.secretKind === SecretKind.ProviderKey) return t("settings.providers.apiKey")
    const fields = FORM_FIELDS_BY_KIND[entry.kind]
    return fields ? t(fields) : undefined
}

const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ["chatgpt", "claude"]
/** The line of a sign-in not made yet. */
const SUBSCRIPTION_HINT: Record<
    SubscriptionProvider,
    CatalogKey<typeof commonCatalog | typeof settingsProvidersCatalog>
> = {
    chatgpt: "settings.providers.chatgptHint",
    claude: "settings.providers.claudeHint",
}

/** The AI providers list: every owner's rows in one Connected list, sign-ins, the catalog. */
export const ProvidersPanel = ({
    groups: ownerGroups,
    projectGroup,
    query = "",
    ownerChoiceFor,
    loading = false,
    ownerChips = false,
    connectedLabel,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: {
    groups: ProvidersGroup[]
    /** Where a new connection goes; absent, no catalog. */
    projectGroup?: ProvidersGroup
    /** The search: rows whose name holds it. */
    query?: string
    /** The drawer's Owner field for a new connection of this kind; absent, it is the project's. */
    ownerChoiceFor?: (kind: string) => ProviderOwnerChoice | undefined
    loading?: boolean
    /** Every owner's rows in one Connected list, each with its owner chip (the All tab). */
    ownerChips?: boolean
    /** The Connected heading, named by the owner tab; absent, "Connected". */
    connectedLabel?: string
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    subscriptionDocsUrl: string
}) => {
    const t = useT(commonCatalog, settingsProvidersCatalog, settingsSharedCatalog, providerListCatalog)
    const builtinEndpoints = useAtomValue(builtinModelEndpointsQueryAtom).data
    const builtinModels = useMemo(() => builtinModelsOf(builtinEndpoints), [builtinEndpoints])
    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const allGroups = useMemo(
        () =>
            projectGroup && !ownerGroups.some((group) => group.key === projectGroup.key)
                ? [projectGroup, ...ownerGroups]
                : ownerGroups,
        [ownerGroups, projectGroup],
    )
    const drawerGroup = drawerTarget
        ? (allGroups.find((group) => group.key === drawerTarget.groupKey) ?? null)
        : null
    const drawerConnection = drawerTarget?.connectionId
        ? (drawerGroup?.source.connections.find(
              (candidate) => candidate.id === drawerTarget.connectionId,
          ) ?? null)
        : null
    // The open subscription or built-in models sheet; a new id remounts it fresh.
    const [sheet, setSheet] = useState<
        | {id: number; view: "subscription"; params: SubscriptionViewParams; groupKeys: string[]}
        | {id: number; view: "builtin"}
        | null
    >(null)
    const [pendingRemoval, setPendingRemoval] = useState<{
        groupKey: string
        connection: ProviderConnection
    } | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const canRemoveIn = useCallback(
        (source: ProvidersSource) => source.manage && Boolean(renderRemoveDialog),
        [renderRemoveDialog],
    )

    // One owner opens its own sign-in; several let the dialog ask which owner first.
    const openSignIn = useCallback(
        (
            groupKeys: string[],
            provider: SubscriptionProvider,
            connectionId?: string,
            start = false,
        ) => {
            setSheet({
                id: Date.now(),
                view: "subscription",
                params: {provider, connectionId, start: start && groupKeys.length === 1},
                groupKeys,
            })
        },
        [],
    )

    const requestRemoval = useCallback((groupKey: string, connection: ProviderConnection) => {
        setRemoveError(null)
        setPendingRemoval({groupKey, connection})
    }, [])

    const removeConnection = useCallback(async () => {
        if (!pendingRemoval) return
        const source = allGroups.find((group) => group.key === pendingRemoval.groupKey)?.source
        if (!source) return
        setRemoving(true)
        setRemoveError(null)
        try {
            await source.remove(pendingRemoval.connection)
        } catch (failure) {
            setRemoveError(source.removeFailed(failure, pendingRemoval.connection))
        } finally {
            setPendingRemoval(null)
            setRemoving(false)
        }
    }, [pendingRemoval, allGroups])

    const onSaved = useCallback(() => {
        allGroups.forEach((group) => group.source.onSaved?.())
    }, [allGroups])

    const term = query.trim().toLowerCase()
    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        const matches = (item: SettingsCatalogItem) =>
            !term || (typeof item.name === "string" && item.name.toLowerCase().includes(term))
        const owned = ownerGroups.map(({key: groupKey, owner, source}) => {
            const badge = ownerChips ? <OwnerChip owner={owner} /> : undefined
            const canRemove = canRemoveIn(source)
            const open = (connection: ProviderConnection) => {
                const provider = subscriptionProviderOf(connection)
                if (provider) openSignIn([groupKey], provider, connection.id)
                else setDrawerTarget({groupKey, connectionId: connection.id})
            }
            const held = source.rows.map<SettingsCatalogItem>((connection) => {
                // A subscription that is not signed in needs attention, not a connected mark.
                const needsSignIn =
                    !!connection.subscription && !subscriptionIsReady(connection.subscription)
                return {
                    key: connection.id,
                    logo: <ProviderLogo kind={connection.kind} />,
                    name: connection.name,
                    badge,
                    description: source.describe(connection),
                    status: needsSignIn ? "attention" : "connected",
                    statusLabel: needsSignIn
                        ? t("settings.providers.needsSignIn")
                        : t("common.connected"),
                    onOpen: (source.canOpen?.(connection) ?? true) ? () => open(connection) : undefined,
                    menu: source.manage ? (
                        <SettingsRowMenu
                            label={t("settings.providers.actionsFor", {name: connection.name})}
                            items={[
                                {
                                    key: "edit",
                                    label: t("common.edit"),
                                    icon: <PencilSimpleLine size={14} />,
                                    hidden: !(source.canOpen?.(connection) ?? true),
                                    onClick: () => open(connection),
                                },
                                {type: "divider"},
                                {
                                    key: "delete",
                                    label: t("common.delete"),
                                    icon: <Trash size={14} />,
                                    danger: true,
                                    hidden: !canRemove,
                                    onClick: () => requestRemoval(groupKey, connection),
                                },
                            ]}
                        />
                    ) : undefined,
                }
            })
            // Offered once the list is in, so a held sign-in never shows as one to connect.
            const offered =
                source.offersSubscriptions && !source.loading
                    ? SUBSCRIPTION_PROVIDERS.filter(
                          (provider) => !subscriptionConnectionFor(source.connections, provider),
                      )
                    : []
            return {
                key: groupKey,
                label: null,
                items: held.filter(matches),
                // Sign-ins this owner may start: not connections, so they list apart.
                offered,
                // A group still loading holds its place with one skeleton row.
                pendingRows: source.loading && !held.length ? 1 : 0,
                footer: source.failure,
            }
        })
        // The deployment's own models: no owner, shown with the project's rows.
        const builtin: SettingsCatalogItem[] =
            builtinModels.length && ownerGroups.some((group) => group.key === projectGroup?.key)
                ? [
                      {
                          key: "builtin:agenta",
                          logo: <ProviderLogo kind="agenta" />,
                          name: t("entityUi.providerList.agenta"),
                          description: t("entityUi.providerList.builtIn"),
                          status: "connected",
                          statusLabel: t("common.connected"),
                          onOpen: () => setSheet({id: Date.now(), view: "builtin"}),
                      },
                  ].filter(matches)
                : []
        const footers = owned.flatMap((group) =>
            group.footer ? [<Fragment key={`${group.key}:failure`}>{group.footer}</Fragment>] : [],
        )
        // One Connected list: every owner's rows, narrow owners first.
        const items = [...builtin, ...owned.flatMap((group) => group.items)]
        const connected: SettingsCatalogGroup = {
            key: "connected",
            label: connectedLabel ?? t("common.connected"),
            list: true,
            items,
            count: items.length,
            pendingRows: owned.some((group) => group.pendingRows) ? 1 : 0,
            footer: footers.length ? <>{footers}</> : undefined,
        }
        const subscriptionsGroup: SettingsCatalogGroup = {
            key: "subscriptions",
            label: t("settings.providers.subscriptions"),
            // One row per provider; its dialog asks which owner when more than one may start it.
            items: SUBSCRIPTION_PROVIDERS.flatMap<SettingsCatalogItem>((provider) => {
                const groupKeys = owned
                    .filter((group) => group.offered.includes(provider))
                    .map((group) => group.key)
                return groupKeys.length
                    ? [
                          {
                              key: `subscription:${provider}`,
                              logo: <ProviderLogo kind={subscriptionProviderFamily(provider)} />,
                              name: subscriptionProviderName(provider),
                              description: t(SUBSCRIPTION_HINT[provider]),
                              status: "available",
                              statusLabel: t("settings.providers.connectName", {
                                  name: subscriptionProviderName(provider),
                              }),
                              onOpen: () => openSignIn(groupKeys, provider, undefined, true),
                          },
                      ]
                    : []
            }).filter(matches),
        }
        if (!projectGroup) return [connected, subscriptionsGroup]
        const catalogRow = (entry: ProviderCatalogEntry): SettingsCatalogItem => ({
            key: entry.kind,
            logo: <ProviderLogo kind={entry.kind} />,
            name: providerTitle(entry.kind, entry.title, t),
            description: catalogDescription(entry, t),
            status: "available",
            statusLabel: t("settings.providers.connectName", {
                name: providerTitle(entry.kind, entry.title, t),
            }),
            onOpen: projectGroup
                ? () => setDrawerTarget({groupKey: projectGroup.key, kind: entry.kind})
                : undefined,
        })
        return [
            connected,
            subscriptionsGroup,
            {
                key: "model-providers",
                label: t("settings.providers.modelProviders"),
                items: MODEL_PROVIDERS.map(catalogRow).filter(matches),
            },
            {
                key: "cloud-platforms",
                label: t("settings.providers.cloudPlatforms"),
                items: CLOUD_PLATFORMS.map(catalogRow).filter(matches),
            },
        ]
    }, [
        ownerGroups,
        projectGroup,
        ownerChips,
        connectedLabel,
        builtinModels,
        term,
        canRemoveIn,
        requestRemoval,
        openSignIn,
        t,
    ])

    return (
        <div className="ph-no-capture">
            <SettingsCatalog
                groups={groups}
                loading={loading}
                empty={
                    <SettingsEmpty
                        compact
                        icon={<MagnifyingGlass size={18} />}
                        title={t("settings.shared.noMatchTitle")}
                        description={t("settings.shared.noMatchSearchBody")}
                    />
                }
                notice={
                    <>
                        {removeError ? (
                            <span className="flex items-center gap-1 text-meta text-destructive">
                                <WarningCircle size={14} />
                                {removeError}
                            </span>
                        ) : null}
                    </>
                }
            />

            {renderRemoveDialog?.({
                connection: pendingRemoval?.connection ?? null,
                open: !!pendingRemoval,
                pending: removing,
                error: removeError,
                onConfirm: () => void removeConnection(),
                onClose: () => setPendingRemoval(null),
            })}

            <ProviderOwnerChoiceContext.Provider value={ownerChoiceFor ?? null}>
                {sheet?.view === "subscription" ? (
                    <SubscriptionSheet
                        key={sheet.id}
                        params={sheet.params}
                        owners={sheet.groupKeys.flatMap<SubscriptionSheetOwner>((groupKey) => {
                            const group = allGroups.find((candidate) => candidate.key === groupKey)
                            if (!group) return []
                            // The organization's sheet finds its connections and signs in on its routes.
                            const organization = group.source.organization
                            return [
                                organization
                                    ? {
                                          kind: "organization",
                                          context: {
                                              connections: group.source.connections,
                                              organization,
                                          },
                                      }
                                    : {kind: "project", context: null},
                            ]
                        })}
                        onClosed={() => setSheet(null)}
                    />
                ) : sheet?.view === "builtin" ? (
                    <BuiltinModelsSheet key={sheet.id} onClosed={() => setSheet(null)} />
                ) : null}
            </ProviderOwnerChoiceContext.Provider>

            <ProviderDrawer
                open={!!drawerTarget}
                onClose={() => setDrawerTarget(null)}
                context="settings"
                connections={drawerGroup?.source.connections ?? []}
                connection={drawerConnection}
                kind={drawerTarget?.kind ?? null}
                onSaved={onSaved}
                subscriptionDocsUrl={subscriptionDocsUrl}
                organization={drawerGroup?.source.organization}
                ownerChoice={drawerTarget?.kind ? ownerChoiceFor?.(drawerTarget.kind) : undefined}
            />
        </div>
    )
}

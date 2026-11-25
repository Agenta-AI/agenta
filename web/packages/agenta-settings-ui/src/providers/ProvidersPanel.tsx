import {createElement, Fragment, type ReactNode, useCallback, useMemo, useState} from "react"

import {
    builtinModelsOf,
    PROVIDER_CATALOG,
    SecretKind,
    SecretManagementPolicy,
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
    builtinModelsView,
    providerConnectionView,
    ProviderDrawer,
    providerIconFor,
    ProviderOwnerChoiceContext,
    SubscriptionOwnerContext,
    subscriptionStatusLine,
    subscriptionViewFor,
    type OrganizationConnectionScope,
    type ProviderOwnerChoice,
} from "@agenta/entity-ui/secretProvider"
import {useT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import type {OwnerKind} from "@agenta/shared/types"
import {useViewOpener, type ViewTarget} from "@agenta/ui/view-stack"
import {MagnifyingGlass, PencilSimpleLine, Trash, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {SubscriptionCards, type SubscriptionCard} from "./SubscriptionCards"

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
    /** Under an empty list; without it an empty group hides. */
    emptyFooter?: ReactNode
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
    connectionId: string
}

type SubscriptionProvider = "chatgpt" | "claude"

const PROJECT: ViewTarget = {kind: "project"}

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

/** The AI providers list: plan cards, every owner's rows in one Connected list, the catalog. */
export const ProvidersPanel = ({
    groups: ownerGroups,
    projectGroup,
    query = "",
    subscriptions,
    ownerChoiceFor,
    loading = false,
    ownerChips = false,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: {
    groups: ProvidersGroup[]
    /** Where a new connection and the cards' sign-ins go; absent, no catalog and no cards. */
    projectGroup?: ProvidersGroup
    /** The search: rows whose name holds it. */
    query?: string
    /** The project's ChatGPT and Claude cards; absent hides them. */
    subscriptions?: ProviderConnection[]
    /** The drawer's Owner field for a new connection of this kind; absent, it is the project's. */
    ownerChoiceFor?: (kind: string) => ProviderOwnerChoice | undefined
    loading?: boolean
    /** Every owner's rows in one Connected list, each with its owner chip (the All tab). */
    ownerChips?: boolean
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
    const drawerConnection = drawerTarget
        ? (drawerGroup?.source.connections.find(
              (candidate) => candidate.id === drawerTarget.connectionId,
          ) ?? null)
        : null
    // The group whose subscription view is open; it stays set while the drawer closes.
    const [signInGroupKey, setSignInGroupKey] = useState<string | null>(null)
    const views = useViewOpener()
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

    const signInGroup = allGroups.find((group) => group.key === signInGroupKey) ?? null
    const openSignIn = useCallback(
        (groupKey: string, provider: SubscriptionProvider, connectionId?: string) => {
            setSignInGroupKey(groupKey)
            void views.open(subscriptionViewFor(provider), {provider, connectionId}, PROJECT)
        },
        [views],
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
        const owned = ownerGroups.map<SettingsCatalogGroup>(({key: groupKey, owner, source}) => {
            const badge = ownerChips ? <OwnerChip owner={owner} /> : undefined
            const canRemove = canRemoveIn(source)
            const open = (connection: ProviderConnection) => {
                const provider = subscriptionProviderOf(connection)
                if (provider) openSignIn(groupKey, provider, connection.id)
                // The project's key opens the view, which asks before it drops edits.
                else if (groupKey === projectGroup?.key)
                    void views.open(
                        providerConnectionView,
                        {kind: connection.kind, connectionId: connection.id},
                        PROJECT,
                    )
                else setDrawerTarget({groupKey, connectionId: connection.id})
            }
            const held = source.rows.map<SettingsCatalogItem>((connection) => ({
                key: connection.id,
                logo: <ProviderLogo kind={connection.kind} />,
                name: connection.name,
                badge,
                description: source.describe(connection),
                status: "connected",
                statusLabel: t("common.connected"),
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
            }))
            // Offered once the list is in, so a held sign-in never shows as one to connect.
            const offered =
                source.offersSubscriptions && !source.loading
                    ? SUBSCRIPTION_PROVIDERS.filter(
                          (provider) => !subscriptionConnectionFor(source.connections, provider),
                      ).map<SettingsCatalogItem>((provider) => ({
                          key: `${groupKey}:subscription:${provider}`,
                          logo: <ProviderLogo kind={subscriptionProviderFamily(provider)} />,
                          name: subscriptionProviderName(provider),
                          badge,
                          description: t(SUBSCRIPTION_HINT[provider]),
                          status: "available",
                          statusLabel: t("settings.providers.connectName", {
                              name: subscriptionProviderName(provider),
                          }),
                          onOpen: () => openSignIn(groupKey, provider),
                      }))
                    : []
            return {
                key: groupKey,
                label: null,
                items: [...held, ...offered].filter(matches),
                // The count is of what the owner holds, not of what it may connect.
                count: held.filter(matches).length,
                // A group still loading holds its place with one skeleton row.
                pendingRows: source.loading && !held.length ? 1 : 0,
                ...(source.failure
                    ? {footer: source.failure}
                    : source.emptyFooter && !source.loading && !source.connections.length
                      ? {count: 0, footer: source.emptyFooter}
                      : {}),
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
                          onOpen: () => void views.open(builtinModelsView, {}, PROJECT),
                      },
                  ].filter(matches)
                : []
        // One Connected list: every owner's rows, narrow owners first.
        const connected: SettingsCatalogGroup = {
            key: "connected",
            label: t("common.connected"),
            list: true,
            items: [...builtin, ...owned.flatMap((group) => group.items)],
            count: owned.reduce((sum, group) => sum + (group.count ?? 0), 0),
            pendingRows: owned.some((group) => group.pendingRows) ? 1 : 0,
            footer: owned.some((group) => group.footer) ? (
                <>
                    {owned.map((group) => (
                        <Fragment key={group.key}>{group.footer}</Fragment>
                    ))}
                </>
            ) : undefined,
        }
        if (!projectGroup) return [connected]
        const catalogRow = (entry: ProviderCatalogEntry): SettingsCatalogItem => ({
            key: entry.kind,
            logo: <ProviderLogo kind={entry.kind} />,
            name: providerTitle(entry.kind, entry.title, t),
            description: catalogDescription(entry, t),
            status: "available",
            statusLabel: t("settings.providers.connectName", {
                name: providerTitle(entry.kind, entry.title, t),
            }),
            onOpen: () => void views.open(providerConnectionView, {kind: entry.kind}, PROJECT),
        })
        return [
            connected,
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
        builtinModels,
        term,
        canRemoveIn,
        requestRemoval,
        openSignIn,
        views,
        t,
    ])

    const cards = useMemo<SubscriptionCard[] | null>(() => {
        if (!subscriptions || !projectGroup) return null
        const open = (provider: SubscriptionProvider, connection: ProviderConnection | null) =>
            openSignIn(projectGroup.key, provider, connection?.id)
        const chatgpt = subscriptionConnectionFor(subscriptions, "chatgpt") ?? null
        const claude = subscriptionConnectionFor(subscriptions, "claude") ?? null
        const chatgptReady = subscriptionIsReady(chatgpt?.subscription)
        const loginState = chatgpt?.subscription?.loginState
        // A sign-in that once worked and now does not needs attention, not a fresh connect.
        const broken = !chatgptReady && !!loginState && loginState !== "pending_login"
        const claudeReady = subscriptionIsReady(claude?.subscription)
        const remover = (connection: ProviderConnection | null) =>
            connection &&
            canRemoveIn(projectGroup.source) &&
            connection.managementPolicy !== SecretManagementPolicy.ManagerOnly
                ? () => requestRemoval(projectGroup.key, connection)
                : undefined
        return [
            {
                key: "chatgpt",
                logo: <ProviderLogo kind={subscriptionProviderFamily("chatgpt")} />,
                name: subscriptionProviderName("chatgpt"),
                detail:
                    subscriptionStatusLine(chatgpt?.subscription) ||
                    t(SUBSCRIPTION_HINT.chatgpt),
                state: chatgptReady ? "connected" : broken ? "attention" : "available",
                actionLabel: chatgptReady
                    ? t("common.manage")
                    : broken
                      ? t("settings.providers.signInAgain")
                      : t("common.connect"),
                onAction: () => open("chatgpt", chatgpt),
                onRemove: remover(chatgpt),
            },
            {
                key: "claude",
                logo: <ProviderLogo kind={subscriptionProviderFamily("claude")} />,
                name: subscriptionProviderName("claude"),
                detail: claudeReady ? t("common.connected") : t(SUBSCRIPTION_HINT.claude),
                state: claudeReady ? "connected" : "available",
                actionLabel: claudeReady ? t("common.manage") : t("common.connect"),
                onAction: () => open("claude", claude),
                onRemove: remover(claude),
            },
        ]
    }, [subscriptions, projectGroup, openSignIn, canRemoveIn, requestRemoval, t])

    return (
        <div className="ph-no-capture">
            <SettingsCatalog
                groups={groups}
                loading={loading}
                empty={
                    <SettingsEmpty
                        plain
                        icon={<MagnifyingGlass size={18} />}
                        title={t("settings.shared.noMatchTitle")}
                        description={t("settings.shared.noMatchBody")}
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
                        {cards ? <SubscriptionCards cards={cards} /> : null}
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

            {/* The views find this group's connections, and sign in on the organization's routes. */}
            <SubscriptionOwnerContext.Provider
                value={
                    signInGroup?.source.organization
                        ? {
                              connections: signInGroup.source.connections,
                              organization: signInGroup.source.organization,
                          }
                        : null
                }
            >
                <ProviderOwnerChoiceContext.Provider value={ownerChoiceFor ?? null}>
                    {views.drawer}
                </ProviderOwnerChoiceContext.Provider>
            </SubscriptionOwnerContext.Provider>

            <ProviderDrawer
                open={!!drawerTarget}
                onClose={() => setDrawerTarget(null)}
                context="settings"
                connections={drawerGroup?.source.connections ?? []}
                connection={drawerConnection}
                onSaved={onSaved}
                subscriptionDocsUrl={subscriptionDocsUrl}
                organization={drawerGroup?.source.organization}
            />
        </div>
    )
}

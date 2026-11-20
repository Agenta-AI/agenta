import {createElement, type ReactNode, useCallback, useMemo, useState} from "react"

import {
    subscriptionConnectionFor,
    subscriptionProviderFamily,
    subscriptionProviderName,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {
    ProviderDrawer,
    providerIconFor,
    SubscriptionOwnerContext,
    subscriptionViewFor,
    type OrganizationConnectionScope,
} from "@agenta/entity-ui/secretProvider"
import {useT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {useViewOpener, type ViewTarget} from "@agenta/ui/view-stack"
import {PencilSimpleLine, Trash, WarningCircle} from "@phosphor-icons/react"

import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
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

/** One owner's group on the page (today the organization's). */
export interface ProvidersGroup {
    key: string
    /** The heading, for example "{org} organization". */
    label: ReactNode
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
    createElement(providerIconFor(kind), {className: "size-[18px]"})

const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ["chatgpt", "claude"]
/** The line of a sign-in not made yet. */
const SUBSCRIPTION_HINT: Record<
    SubscriptionProvider,
    CatalogKey<typeof commonCatalog | typeof settingsProvidersCatalog>
> = {
    chatgpt: "settings.providers.chatgptHint",
    claude: "settings.providers.claudeHint",
}

/**
 * A list of providers held by other owners than the project (the organization's group in
 * Settings › AI providers): one group per owner, with Edit and Delete in each row's menu, and the
 * ChatGPT and Claude sign-ins the owner does not hold yet. The project's own connections are the
 * Model providers list, which opens the shared views.
 */
export const ProvidersPanel = ({
    groups: ownerGroups,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: {
    groups: ProvidersGroup[]
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    subscriptionDocsUrl: string
}) => {
    const t = useT(commonCatalog, settingsProvidersCatalog)
    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const drawerGroup = drawerTarget
        ? (ownerGroups.find((group) => group.key === drawerTarget.groupKey) ?? null)
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

    const signInGroup = ownerGroups.find((group) => group.key === signInGroupKey) ?? null
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
        const source = ownerGroups.find((group) => group.key === pendingRemoval.groupKey)?.source
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
    }, [pendingRemoval, ownerGroups])

    const onSaved = useCallback(() => {
        ownerGroups.forEach((group) => group.source.onSaved?.())
    }, [ownerGroups])

    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        return ownerGroups.map<SettingsCatalogGroup>(({key: groupKey, label, source}) => {
            const canRemove = canRemoveIn(source)
            const open = (connection: ProviderConnection) => {
                const provider = subscriptionProviderOf(connection)
                if (provider) openSignIn(groupKey, provider, connection.id)
                else setDrawerTarget({groupKey, connectionId: connection.id})
            }
            const held = source.rows.map<SettingsCatalogItem>((connection) => ({
                key: connection.id,
                logo: <ProviderLogo kind={connection.kind} />,
                name: connection.name,
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
                          key: `subscription:${provider}`,
                          logo: <ProviderLogo kind={subscriptionProviderFamily(provider)} />,
                          name: subscriptionProviderName(provider),
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
                label,
                items: [...held, ...offered],
                // The count is of what the owner holds, not of what it may connect.
                count: held.length,
                // A group still loading holds its place with one skeleton row.
                pendingRows: source.loading && !held.length ? 1 : 0,
                ...(source.failure
                    ? {footer: source.failure}
                    : source.emptyFooter && !source.loading && !source.connections.length
                      ? {count: 0, footer: source.emptyFooter}
                      : {}),
            }
        })
    }, [ownerGroups, canRemoveIn, requestRemoval, openSignIn, t])

    return (
        <div className="ph-no-capture">
            <SettingsCatalog
                groups={groups}
                notice={
                    removeError ? (
                        <span className="flex items-center gap-1 text-xs text-destructive">
                            <WarningCircle size={14} />
                            {removeError}
                        </span>
                    ) : null
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
                {views.drawer}
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

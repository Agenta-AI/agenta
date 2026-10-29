import {createElement, type ReactNode, useCallback, useMemo, useState} from "react"

import {
    PROVIDER_CATALOG,
    SecretKind,
    subscriptionConnectionFor,
    subscriptionIsReady,
    subscriptionProviderName,
    subscriptionStatusLine,
    type ProviderCatalogEntry,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {
    ProviderDrawer,
    providerIconFor,
    SubscriptionSignInDialog,
    type OrganizationConnectionScope,
    type ProviderOwnerChoice,
} from "@agenta/entity-ui/secretProvider"
import {PencilSimpleLine, Trash, WarningCircle} from "@phosphor-icons/react"

import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {type SubscriptionPlan, SubscriptionsBanner} from "./SubscriptionsBanner"

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
    /** Every connection the drawer and the subscription cards read. */
    connections: ProviderConnection[]
    /** The rows of the Connected list. */
    rows: ProviderConnection[]
    loading: boolean
    describe: (connection: ProviderConnection) => string
    /** Whether a row opens the drawer. Every row does when absent. */
    canOpen?: (connection: ProviderConnection) => boolean
    /** Edit and delete on each row; a read-only list has neither. */
    manage: boolean
    remove: (connection: ProviderConnection) => Promise<void>
    removeFailed: (failure: unknown, connection: ProviderConnection) => string
    /** Under an empty list; without it an empty group hides. */
    emptyFooter?: ReactNode
    /** Set for the organization's connections: the drawer saves to the organization. */
    organization?: OrganizationConnectionScope
    onSaved?: () => void
}

/** One owner's group on the page: the project's, or the organization's. */
export interface ProvidersGroup {
    key: string
    /** The heading: the project switch, or "{org} organization". */
    label: ReactNode
    source: ProvidersSource
}

/**
 * What the drawer is open on. A saved connection is held by id and read from the current list,
 * so a save that lands in part (the projects but not the key) shows the drawer what is stored.
 */
type DrawerTarget = {groupKey: string; connectionId: string} | {kind: string}

/** What a credential-set kind's form asks for, read off its fields in `providerFields.ts`. */
const FORM_FIELDS_BY_KIND: Record<string, string> = {
    bedrock: "AWS region and an API key or access keys",
    azure: "Endpoint, API version and API key",
    vertex_ai: "Project, location and credentials",
}

const MODEL_PROVIDERS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.ProviderKey,
)
const CLOUD_PLATFORMS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.CustomProvider,
)

const catalogDescription = (entry: ProviderCatalogEntry): string | undefined =>
    entry.subtitle ??
    (entry.secretKind === SecretKind.ProviderKey ? "API key" : FORM_FIELDS_BY_KIND[entry.kind])

export const ProviderLogo = ({kind}: {kind: string}) =>
    createElement(providerIconFor(kind), {className: "size-[18px]"})

const CHATGPT_NAME = subscriptionProviderName("chatgpt")
const CLAUDE_NAME = subscriptionProviderName("claude")

/** The ChatGPT and Claude cards above the list, from the connections that hold them. */
const subscriptionPlans = (
    chatgpt: ProviderConnection | null | undefined,
    claude: ProviderConnection | null | undefined,
    open: (provider: "chatgpt" | "claude") => void,
): SubscriptionPlan[] => {
    const chatgptConnected = subscriptionIsReady(chatgpt?.subscription)
    const loginState = chatgpt?.subscription?.loginState
    // A sign-in that once worked and now does not needs attention, not a fresh connect.
    const broken = !chatgptConnected && !!loginState && loginState !== "pending_login"
    // A token is either stored or not: a refused run does not mark the row.
    const claudeConnected = subscriptionIsReady(claude?.subscription)
    return [
        {
            key: "chatgpt",
            logo: <ProviderLogo kind="openai" />,
            name: CHATGPT_NAME,
            detail: subscriptionStatusLine(chatgpt?.subscription) || "Sign in with your account",
            state: chatgptConnected ? "connected" : broken ? "attention" : "available",
            brand: "neutral",
            action: {
                label: chatgptConnected ? "Manage" : broken ? "Sign in again" : "Connect",
                onClick: () => open("chatgpt"),
            },
        },
        {
            key: "claude",
            logo: <ProviderLogo kind="anthropic" />,
            name: CLAUDE_NAME,
            detail: claudeConnected ? "Connected" : "Paste a token from Claude Code",
            state: claudeConnected ? "connected" : "available",
            brand: "clay",
            action: {
                label: claudeConnected ? "Manage" : "Connect",
                onClick: () => open("claude"),
            },
        },
    ]
}

/**
 * The AI providers list: one group per owner, then the catalog, with the subscription cards on
 * top and the drawer. The first group is the project's: a new connection starts there.
 */
export const ProvidersPanel = ({
    groups: ownerGroups,
    catalog,
    subscriptions,
    ownerChoiceFor,
    loading = false,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: {
    groups: ProvidersGroup[]
    /** The providers to connect. Absent hides the catalog. */
    catalog?: {notShareable?: {kinds: Set<string>; note: string}}
    /** The ChatGPT and Claude cards. Absent hides them. */
    subscriptions?: ProviderConnection[]
    /** The drawer's "Who can use it" for a new connection of this kind; absent, it is the project's. */
    ownerChoiceFor?: (kind: string) => ProviderOwnerChoice | undefined
    loading?: boolean
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    subscriptionDocsUrl: string
}) => {
    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const drawerGroup =
        (drawerTarget && "groupKey" in drawerTarget
            ? ownerGroups.find((group) => group.key === drawerTarget.groupKey)
            : ownerGroups[0]) ?? null
    const drawerConnection =
        drawerTarget && "connectionId" in drawerTarget
            ? (drawerGroup?.source.connections.find(
                  (candidate) => candidate.id === drawerTarget.connectionId,
              ) ?? null)
            : null
    const [signInProvider, setSignInProvider] = useState<"chatgpt" | "claude" | null>(null)
    const [pendingRemoval, setPendingRemoval] = useState<{
        groupKey: string
        connection: ProviderConnection
    } | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const projectSource = ownerGroups[0]?.source
    const canRemoveIn = useCallback(
        (source: ProvidersSource) => source.manage && Boolean(renderRemoveDialog),
        [renderRemoveDialog],
    )

    const chatgpt = useMemo(
        () => subscriptionConnectionFor(subscriptions ?? [], "chatgpt"),
        [subscriptions],
    )
    const claude = useMemo(
        () => subscriptionConnectionFor(subscriptions ?? [], "claude"),
        [subscriptions],
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
        const owned = ownerGroups.map<SettingsCatalogGroup>(({key: groupKey, label, source}) => {
            const canRemove = canRemoveIn(source)
            const items = source.rows.map<SettingsCatalogItem>((connection) => ({
                key: connection.id,
                logo: <ProviderLogo kind={connection.kind} />,
                name: connection.name,
                description: source.describe(connection),
                status: "connected",
                statusLabel: "Connected",
                onOpen:
                    (source.canOpen?.(connection) ?? true)
                        ? () => setDrawerTarget({groupKey, connectionId: connection.id})
                        : undefined,
                menu: source.manage ? (
                    <SettingsRowMenu
                        label={`Actions for ${connection.name}`}
                        items={[
                            {
                                key: "edit",
                                label: "Edit",
                                icon: <PencilSimpleLine size={14} />,
                                hidden: !(source.canOpen?.(connection) ?? true),
                                onClick: () =>
                                    setDrawerTarget({groupKey, connectionId: connection.id}),
                            },
                            {type: "divider"},
                            {
                                key: "delete",
                                label: "Delete",
                                icon: <Trash size={14} />,
                                danger: true,
                                hidden: !canRemove,
                                onClick: () => requestRemoval(groupKey, connection),
                            },
                        ]}
                    />
                ) : undefined,
            }))
            return {
                key: groupKey,
                label,
                items,
                // A group still loading holds its place with one skeleton row.
                pendingRows: source.loading && !items.length ? 1 : 0,
                ...(source.emptyFooter && !source.loading && !source.connections.length
                    ? {count: 0, footer: source.emptyFooter}
                    : {}),
            }
        })
        if (!catalog) return owned

        const notShareable = catalog.notShareable
        const catalogRow = (entry: ProviderCatalogEntry): SettingsCatalogItem => {
            const shareable = !notShareable?.kinds.has(entry.kind)
            return {
                key: entry.kind,
                logo: <ProviderLogo kind={entry.kind} />,
                name: entry.title,
                description: shareable ? catalogDescription(entry) : notShareable?.note,
                status: "available",
                statusLabel: `Connect ${entry.title}`,
                disabled: !shareable,
                onOpen: () => setDrawerTarget({kind: entry.kind}),
            }
        }

        return [
            ...owned,
            {
                key: "model-providers",
                label: "Model providers",
                items: MODEL_PROVIDERS.map(catalogRow),
            },
            {
                key: "cloud-platforms",
                label: "Cloud platforms",
                items: CLOUD_PLATFORMS.map(catalogRow),
            },
        ]
    }, [ownerGroups, catalog, canRemoveIn, requestRemoval])

    const plans = useMemo(
        () => subscriptionPlans(chatgpt, claude, setSignInProvider),
        [chatgpt, claude],
    )
    const canRemoveSubscription = projectSource ? canRemoveIn(projectSource) : false
    const removeSubscription = useCallback(
        (connection: ProviderConnection) =>
            ownerGroups[0] && requestRemoval(ownerGroups[0].key, connection),
        [ownerGroups, requestRemoval],
    )

    return (
        <div className="ph-no-capture">
            <SettingsCatalog
                groups={groups}
                loading={loading}
                notice={
                    <>
                        {removeError ? (
                            <span className="flex items-center gap-1 text-xs text-destructive">
                                <WarningCircle size={14} />
                                {removeError}
                            </span>
                        ) : null}
                        {subscriptions ? <SubscriptionsBanner plans={plans} /> : null}
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

            {subscriptions ? (
                <>
                    <SubscriptionSignInDialog
                        open={signInProvider === "chatgpt"}
                        onClose={() => setSignInProvider(null)}
                        provider="chatgpt"
                        connection={chatgpt}
                        logo={<ProviderLogo kind="openai" />}
                        onRemove={canRemoveSubscription ? removeSubscription : undefined}
                        organization={projectSource?.organization}
                    />
                    <SubscriptionSignInDialog
                        open={signInProvider === "claude"}
                        onClose={() => setSignInProvider(null)}
                        provider="claude"
                        connection={claude}
                        logo={<ProviderLogo kind="anthropic" />}
                        onRemove={canRemoveSubscription ? removeSubscription : undefined}
                        organization={projectSource?.organization}
                    />
                </>
            ) : null}

            <ProviderDrawer
                open={!!drawerTarget}
                onClose={() => setDrawerTarget(null)}
                context="settings"
                connections={drawerGroup?.source.connections ?? []}
                connection={drawerConnection}
                kind={drawerTarget && "kind" in drawerTarget ? drawerTarget.kind : null}
                onSaved={onSaved}
                subscriptionDocsUrl={subscriptionDocsUrl}
                organization={drawerGroup?.source.organization}
                ownerChoice={
                    drawerTarget && "kind" in drawerTarget
                        ? ownerChoiceFor?.(drawerTarget.kind)
                        : undefined
                }
            />
        </div>
    )
}

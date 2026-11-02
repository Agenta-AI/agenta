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
    /** The heading: the project switch, or "{org} organization". */
    label: ReactNode
    source: ProvidersSource
}

/**
 * What the drawer is open on. A saved connection is held by id and read from the current list,
 * so a save that lands in part (the projects but not the key) shows the drawer what is stored.
 */
type DrawerTarget = {groupKey: string; connectionId: string} | {kind: string}

type SubscriptionProvider = "chatgpt" | "claude"

/**
 * Which group's ChatGPT or Claude sign-in the dialog shows: the cards open the project's. It
 * stays set while the dialog closes, so the closing dialog keeps its owner.
 */
interface SignInTarget {
    groupKey: string
    provider: SubscriptionProvider
    open: boolean
}

const subscriptionProviderOf = (connection: ProviderConnection): SubscriptionProvider | null => {
    const provider = connection.subscription?.provider
    return provider === "chatgpt" || provider === "claude" ? provider : null
}

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

const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ["chatgpt", "claude"]
const SUBSCRIPTION_LOGO_KIND: Record<SubscriptionProvider, string> = {
    chatgpt: "openai",
    claude: "anthropic",
}
/** The cards' line for a sign-in not made yet. */
const SUBSCRIPTION_HINT: Record<SubscriptionProvider, string> = {
    chatgpt: "Sign in with your account",
    claude: "Paste a token from Claude Code",
}

const CHATGPT_NAME = subscriptionProviderName("chatgpt")
const CLAUDE_NAME = subscriptionProviderName("claude")

/** The ChatGPT and Claude cards above the list, from the connections that hold them. */
const subscriptionPlans = (
    chatgpt: ProviderConnection | null | undefined,
    claude: ProviderConnection | null | undefined,
    open: (provider: SubscriptionProvider) => void,
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
            detail: subscriptionStatusLine(chatgpt?.subscription) || SUBSCRIPTION_HINT.chatgpt,
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
            detail: claudeConnected ? "Connected" : SUBSCRIPTION_HINT.claude,
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
 * The AI providers list: one group per owner, then the catalog, with the project's subscription
 * cards on top and the drawer. The first group is the project's: a new connection starts there.
 */
export const ProvidersPanel = ({
    groups: ownerGroups,
    subscriptions,
    ownerChoiceFor,
    loading = false,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: {
    groups: ProvidersGroup[]
    /** The project's ChatGPT and Claude cards. Absent hides them. */
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
    const [signInTarget, setSignInTarget] = useState<SignInTarget | null>(null)
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

    const chatgpt = useMemo(
        () => subscriptionConnectionFor(subscriptions ?? [], "chatgpt"),
        [subscriptions],
    )
    const claude = useMemo(
        () => subscriptionConnectionFor(subscriptions ?? [], "claude"),
        [subscriptions],
    )
    const signInGroup = signInTarget
        ? (ownerGroups.find((group) => group.key === signInTarget.groupKey) ?? null)
        : null
    const signInConnection =
        signInTarget && signInGroup
            ? subscriptionConnectionFor(signInGroup.source.connections, signInTarget.provider)
            : null
    const openProjectSignIn = useCallback(
        (provider: SubscriptionProvider) =>
            ownerGroups[0] && setSignInTarget({groupKey: ownerGroups[0].key, provider, open: true}),
        [ownerGroups],
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
            const open = (connection: ProviderConnection) => {
                const provider = subscriptionProviderOf(connection)
                if (provider) setSignInTarget({groupKey, provider, open: true})
                else setDrawerTarget({groupKey, connectionId: connection.id})
            }
            const held = source.rows.map<SettingsCatalogItem>((connection) => ({
                key: connection.id,
                logo: <ProviderLogo kind={connection.kind} />,
                name: connection.name,
                description: source.describe(connection),
                status: "connected",
                statusLabel: "Connected",
                onOpen: (source.canOpen?.(connection) ?? true) ? () => open(connection) : undefined,
                menu: source.manage ? (
                    <SettingsRowMenu
                        label={`Actions for ${connection.name}`}
                        items={[
                            {
                                key: "edit",
                                label: "Edit",
                                icon: <PencilSimpleLine size={14} />,
                                hidden: !(source.canOpen?.(connection) ?? true),
                                onClick: () => open(connection),
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
            // Offered once the list is in, so a held sign-in never shows as one to connect.
            const offered =
                source.offersSubscriptions && !source.loading
                    ? SUBSCRIPTION_PROVIDERS.filter(
                          (provider) => !subscriptionConnectionFor(source.connections, provider),
                      ).map<SettingsCatalogItem>((provider) => ({
                          key: `subscription:${provider}`,
                          logo: <ProviderLogo kind={SUBSCRIPTION_LOGO_KIND[provider]} />,
                          name: subscriptionProviderName(provider),
                          description: SUBSCRIPTION_HINT[provider],
                          status: "available",
                          statusLabel: `Connect ${subscriptionProviderName(provider)}`,
                          onOpen: () => setSignInTarget({groupKey, provider, open: true}),
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
        const catalogRow = (entry: ProviderCatalogEntry): SettingsCatalogItem => ({
            key: entry.kind,
            logo: <ProviderLogo kind={entry.kind} />,
            name: entry.title,
            description: catalogDescription(entry),
            status: "available",
            statusLabel: `Connect ${entry.title}`,
            onOpen: () => setDrawerTarget({kind: entry.kind}),
        })

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
    }, [ownerGroups, canRemoveIn, requestRemoval])

    const plans = useMemo(
        () => subscriptionPlans(chatgpt, claude, openProjectSignIn),
        [chatgpt, claude, openProjectSignIn],
    )
    const removeSubscription = useCallback(
        (connection: ProviderConnection) =>
            signInGroup && requestRemoval(signInGroup.key, connection),
        [signInGroup, requestRemoval],
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

            {signInTarget && signInGroup ? (
                <SubscriptionSignInDialog
                    key={`${signInTarget.groupKey}:${signInTarget.provider}`}
                    open={signInTarget.open}
                    onClose={() => setSignInTarget({...signInTarget, open: false})}
                    provider={signInTarget.provider}
                    connection={signInConnection}
                    logo={<ProviderLogo kind={SUBSCRIPTION_LOGO_KIND[signInTarget.provider]} />}
                    onRemove={canRemoveIn(signInGroup.source) ? removeSubscription : undefined}
                    organization={signInGroup.source.organization}
                />
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

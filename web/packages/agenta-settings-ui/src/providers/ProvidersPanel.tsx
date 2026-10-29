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
    /** The providers to connect. Absent hides the catalog. */
    catalog?: {notShareable?: {kinds: Set<string>; note: string}}
    /** The ChatGPT and Claude cards. Absent hides them. */
    subscriptions?: ProviderConnection[]
    /** Under an empty Connected list. */
    emptyFooter?: ReactNode
    organization?: OrganizationConnectionScope
    onSaved?: () => void
}

/**
 * What the drawer is open on. A saved connection is held by id and read from the current list,
 * so a save that lands in part (the projects but not the key) shows the drawer what is stored.
 */
type DrawerTarget = {connectionId: string} | {kind: string}

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

/** One providers list: connected rows, the catalog, the subscription cards and the drawer. */
export const ProvidersPanel = ({
    source,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: {
    source: ProvidersSource
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    subscriptionDocsUrl: string
}) => {
    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const drawerConnection =
        drawerTarget && "connectionId" in drawerTarget
            ? (source.connections.find((candidate) => candidate.id === drawerTarget.connectionId) ??
              null)
            : null
    const [signInProvider, setSignInProvider] = useState<"chatgpt" | "claude" | null>(null)
    const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const {remove, removeFailed} = source
    const canRemove = source.manage && Boolean(renderRemoveDialog)

    const chatgpt = useMemo(
        () => subscriptionConnectionFor(source.subscriptions ?? [], "chatgpt"),
        [source.subscriptions],
    )
    const claude = useMemo(
        () => subscriptionConnectionFor(source.subscriptions ?? [], "claude"),
        [source.subscriptions],
    )

    const requestRemoval = useCallback((connection: ProviderConnection) => {
        setRemoveError(null)
        setPendingRemoval(connection)
    }, [])

    const removeConnection = useCallback(async () => {
        if (!pendingRemoval) return
        setRemoving(true)
        setRemoveError(null)
        try {
            await remove(pendingRemoval)
        } catch (failure) {
            setRemoveError(removeFailed(failure, pendingRemoval))
        } finally {
            setPendingRemoval(null)
            setRemoving(false)
        }
    }, [pendingRemoval, remove, removeFailed])

    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        const connectedRows = source.rows.map<SettingsCatalogItem>((connection) => ({
            key: connection.id,
            logo: <ProviderLogo kind={connection.kind} />,
            name: connection.name,
            description: source.describe(connection),
            status: "connected",
            statusLabel: "Connected",
            onOpen:
                (source.canOpen?.(connection) ?? true)
                    ? () => setDrawerTarget({connectionId: connection.id})
                    : undefined,
            menu: source.manage ? (
                <SettingsRowMenu
                    label={`Actions for ${connection.name}`}
                    items={[
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={14} />,
                            onClick: () => setDrawerTarget({connectionId: connection.id}),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={14} />,
                            danger: true,
                            hidden: !canRemove,
                            onClick: () => requestRemoval(connection),
                        },
                    ]}
                />
            ) : undefined,
        }))

        const connected: SettingsCatalogGroup = {
            key: "connected",
            label: "Connected",
            items: connectedRows,
            ...(source.emptyFooter && !source.connections.length
                ? {count: 0, footer: source.emptyFooter}
                : {}),
        }
        if (!source.catalog) return [connected]

        const notShareable = source.catalog.notShareable
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
            connected,
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
    }, [source, canRemove, requestRemoval])

    const plans = useMemo(
        () => subscriptionPlans(chatgpt, claude, setSignInProvider),
        [chatgpt, claude],
    )

    return (
        <div className="ph-no-capture">
            <SettingsCatalog
                groups={groups}
                loading={source.loading}
                notice={
                    <>
                        {removeError ? (
                            <span className="flex items-center gap-1 text-xs text-destructive">
                                <WarningCircle size={14} />
                                {removeError}
                            </span>
                        ) : null}
                        {source.subscriptions ? <SubscriptionsBanner plans={plans} /> : null}
                    </>
                }
            />

            {renderRemoveDialog?.({
                connection: pendingRemoval,
                open: !!pendingRemoval,
                pending: removing,
                error: removeError,
                onConfirm: () => void removeConnection(),
                onClose: () => setPendingRemoval(null),
            })}

            {source.subscriptions ? (
                <>
                    <SubscriptionSignInDialog
                        open={signInProvider === "chatgpt"}
                        onClose={() => setSignInProvider(null)}
                        provider="chatgpt"
                        connection={chatgpt}
                        logo={<ProviderLogo kind="openai" />}
                        onRemove={canRemove ? requestRemoval : undefined}
                        organization={source.organization}
                    />
                    <SubscriptionSignInDialog
                        open={signInProvider === "claude"}
                        onClose={() => setSignInProvider(null)}
                        provider="claude"
                        connection={claude}
                        logo={<ProviderLogo kind="anthropic" />}
                        onRemove={canRemove ? requestRemoval : undefined}
                        organization={source.organization}
                    />
                </>
            ) : null}

            <ProviderDrawer
                open={!!drawerTarget}
                onClose={() => setDrawerTarget(null)}
                context="settings"
                connections={source.connections}
                connection={drawerConnection}
                kind={drawerTarget && "kind" in drawerTarget ? drawerTarget.kind : null}
                onSaved={source.onSaved}
                subscriptionDocsUrl={subscriptionDocsUrl}
                organization={source.organization}
            />
        </div>
    )
}

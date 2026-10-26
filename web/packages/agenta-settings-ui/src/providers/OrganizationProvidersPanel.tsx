/**
 * AI providers → Organization tab (M5).
 *
 * An organization owner or admin sees every organization connection with who may use it, then
 * today's catalog, and connects a provider once for the projects they choose. Anyone else sees
 * only the connections their project may use, read-only: no catalog, no row menu, and a locked
 * drawer that keeps Test.
 *
 * Design: ~/agenta-sharing-run/M5-UI-DESIGN.md (screens 1-5, 8-10, 14).
 */
import {createElement, useCallback, useMemo, useState, type ReactNode} from "react"

import {
    deleteOrganizationConnectionAtom,
    isSubscriptionConnection,
    managedOrganizationConnectionsAtom,
    organizationConnectionsAccessAtom,
    organizationProviderConnectionsAtom,
    organizationSecretsQueryAtom,
    PROVIDER_CATALOG,
    SecretKind,
    subscriptionConnectionFor,
    subscriptionIsReady,
    subscriptionProviderName,
    subscriptionStatusLine,
    vaultSecretsWithOrganizationQueryAtom,
    type ProviderCatalogEntry,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {
    ProviderDrawer,
    providerIconFor,
    SubscriptionSignInDialog,
    type OrganizationConnectionScope,
} from "@agenta/entity-ui/secretProvider"
import {message} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"
import {PencilSimpleLine, Trash, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import type {ProviderRemovalState} from "./AIProvidersPage"
import {type SubscriptionPlan, SubscriptionsBanner} from "./SubscriptionsBanner"

/** The deployment kinds the LLM gateway does not serve, so they cannot belong to the organization. */
const NOT_SHAREABLE_KINDS = new Set(["bedrock"])

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

const ProviderLogo = ({kind}: {kind: string}) =>
    createElement(providerIconFor(kind), {className: "size-[18px]"})

const CHATGPT_NAME = subscriptionProviderName("chatgpt")
const CLAUDE_NAME = subscriptionProviderName("claude")

type DrawerTarget = {connection: ProviderConnection} | {kind: string}

export interface OrganizationProvidersPanelProps {
    scope: Omit<OrganizationConnectionScope, "readOnly">
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    subscriptionDocsUrl: string
}

/** Who may use a connection, in the row's words. */
const projectsSummary = (
    connection: ProviderConnection,
    names: Map<string, string>,
): string | null => {
    if (connection.availability === "all_projects") return "All projects"
    if (connection.availability !== "selected_projects") return null
    const ids = connection.selectedProjectIds ?? []
    if (!ids.length) return "No projects"
    const picked = ids.flatMap((id) => {
        const name = names.get(id)
        return name ? [name] : []
    })
    // A project this admin does not see in their own list still counts.
    return picked.length === ids.length
        ? picked.join(", ")
        : `${ids.length} ${ids.length === 1 ? "project" : "projects"}`
}

const rowDescription = (connection: ProviderConnection, projects: string | null): string =>
    [connection.title, connection.hasStoredCredential ? "Key saved" : null, projects]
        .filter(Boolean)
        .join(" · ")

const LoadFailed = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex items-center gap-3 text-sm text-colorTextSecondary">
        <span className="flex items-center gap-1.5">
            <WarningCircle size={16} className="text-colorError" />
            Couldn&apos;t load the organization connections.
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

const EmptyNote = ({manage}: {manage: boolean}) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-[14.5px] font-medium leading-5 text-foreground">
            No organization connections yet
        </span>
        {manage ? (
            <span className="text-[13px] leading-[18px] text-muted-foreground">
                Connect a provider below. Then choose which projects can use it.
            </span>
        ) : null}
    </div>
)

export const OrganizationProvidersPanel = ({
    scope,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: OrganizationProvidersPanelProps) => {
    const access = useAtomValue(organizationConnectionsAccessAtom)
    const query = useAtomValue(organizationSecretsQueryAtom)
    // A member's rows come from the project's vault read, so its state is theirs to show.
    const vault = useAtomValue(vaultSecretsWithOrganizationQueryAtom)
    const managed = useAtomValue(managedOrganizationConnectionsAtom)
    const available = useAtomValue(organizationProviderConnectionsAtom)
    const deleteConnection = useSetAtom(deleteOrganizationConnectionAtom)

    const manage = access === "manage"
    const connections = manage ? managed : available
    const drawerScope = useMemo<OrganizationConnectionScope>(
        () => ({...scope, readOnly: !manage}),
        [scope, manage],
    )
    const projectNames = useMemo(
        () => new Map(scope.projects.map((project) => [project.id, project.name])),
        [scope.projects],
    )

    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const [signInProvider, setSignInProvider] = useState<"chatgpt" | "claude" | null>(null)
    const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const canRemove = manage && Boolean(renderRemoveDialog)

    const keyConnections = useMemo(
        () => connections.filter((connection) => !isSubscriptionConnection(connection)),
        [connections],
    )
    const chatgpt = useMemo(() => subscriptionConnectionFor(managed, "chatgpt"), [managed])
    const claude = useMemo(() => subscriptionConnectionFor(managed, "claude"), [managed])

    const requestRemoval = useCallback((connection: ProviderConnection) => {
        setRemoveError(null)
        setPendingRemoval(connection)
    }, [])

    const removeConnection = useCallback(async () => {
        if (!pendingRemoval) return
        setRemoving(true)
        setRemoveError(null)
        try {
            await deleteConnection(pendingRemoval)
            message.success(`${pendingRemoval.name} deleted.`)
            setPendingRemoval(null)
        } catch {
            setRemoveError(`Agenta could not remove ${pendingRemoval.name}. Try again.`)
            setPendingRemoval(null)
        } finally {
            setRemoving(false)
        }
    }, [deleteConnection, pendingRemoval])

    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        const connectedRows = (manage ? keyConnections : connections).map<SettingsCatalogItem>(
            (connection) => {
                const subscription = isSubscriptionConnection(connection)
                return {
                    key: connection.id,
                    logo: <ProviderLogo kind={connection.kind} />,
                    name: connection.name,
                    description: subscription
                        ? [connection.title, subscriptionStatusLine(connection.subscription)]
                              .filter(Boolean)
                              .join(" · ")
                        : rowDescription(
                              connection,
                              manage ? projectsSummary(connection, projectNames) : null,
                          ),
                    status: "connected",
                    statusLabel: "Connected",
                    // A member's subscription row has no drawer: there is nothing to test.
                    onOpen:
                        subscription && !manage ? undefined : () => setDrawerTarget({connection}),
                    menu: manage ? (
                        <SettingsRowMenu
                            label={`Actions for ${connection.name}`}
                            items={[
                                {
                                    key: "edit",
                                    label: "Edit",
                                    icon: <PencilSimpleLine size={14} />,
                                    onClick: () => setDrawerTarget({connection}),
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
                }
            },
        )

        // Empty only when the organization holds nothing at all: a subscription lives in the
        // banner above, not in this list.
        const connected: SettingsCatalogGroup = {
            key: "connected",
            label: "Connected",
            items: connectedRows,
            ...(connections.length ? {} : {count: 0, footer: <EmptyNote manage={manage} />}),
        }
        if (!manage) return [connected]

        const catalogRow = (entry: ProviderCatalogEntry): SettingsCatalogItem => {
            const shareable = !NOT_SHAREABLE_KINDS.has(entry.kind)
            return {
                key: entry.kind,
                logo: <ProviderLogo kind={entry.kind} />,
                name: entry.title,
                description: shareable
                    ? (entry.subtitle ??
                      (entry.secretKind === SecretKind.ProviderKey
                          ? "API key"
                          : FORM_FIELDS_BY_KIND[entry.kind]))
                    : "Can't belong to the organization. Connect Bedrock in each project.",
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
    }, [manage, keyConnections, connections, projectNames, canRemove, requestRemoval])

    const plans = useMemo<SubscriptionPlan[]>(() => {
        const chatgptConnected = subscriptionIsReady(chatgpt?.subscription)
        const loginState = chatgpt?.subscription?.loginState
        const broken = !chatgptConnected && !!loginState && loginState !== "pending_login"
        const claudeConnected = subscriptionIsReady(claude?.subscription)
        return [
            {
                key: "chatgpt",
                logo: <ProviderLogo kind="openai" />,
                name: CHATGPT_NAME,
                detail:
                    subscriptionStatusLine(chatgpt?.subscription) || "Sign in with your account",
                state: chatgptConnected ? "connected" : broken ? "attention" : "available",
                brand: "neutral",
                action: {
                    label: chatgptConnected ? "Manage" : broken ? "Sign in again" : "Connect",
                    onClick: () => setSignInProvider("chatgpt"),
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
                    onClick: () => setSignInProvider("claude"),
                },
            },
        ]
    }, [chatgpt, claude])

    const memberVaultFailed = access === "view" && vault.isError && !vault.data
    if (access === "error" || memberVaultFailed) {
        return (
            <LoadFailed
                onRetry={() => void (memberVaultFailed ? vault.refetch() : query.refetch())}
            />
        )
    }

    return (
        <>
            <SettingsCatalog
                groups={groups}
                loading={access === "loading" || (access === "view" && vault.isPending)}
                notice={
                    <>
                        {removeError ? (
                            <span className="flex items-center gap-1 text-xs text-destructive">
                                <WarningCircle size={14} />
                                {removeError}
                            </span>
                        ) : null}
                        {manage ? <SubscriptionsBanner plans={plans} /> : null}
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

            {manage ? (
                <>
                    <SubscriptionSignInDialog
                        open={signInProvider === "chatgpt"}
                        onClose={() => setSignInProvider(null)}
                        provider="chatgpt"
                        connection={chatgpt}
                        logo={<ProviderLogo kind="openai" />}
                        onRemove={canRemove ? requestRemoval : undefined}
                        organization={drawerScope}
                    />
                    <SubscriptionSignInDialog
                        open={signInProvider === "claude"}
                        onClose={() => setSignInProvider(null)}
                        provider="claude"
                        connection={claude}
                        logo={<ProviderLogo kind="anthropic" />}
                        onRemove={canRemove ? requestRemoval : undefined}
                        organization={drawerScope}
                    />
                </>
            ) : null}

            <ProviderDrawer
                open={!!drawerTarget}
                onClose={() => setDrawerTarget(null)}
                context="settings"
                connections={connections}
                connection={
                    drawerTarget && "connection" in drawerTarget ? drawerTarget.connection : null
                }
                kind={drawerTarget && "kind" in drawerTarget ? drawerTarget.kind : null}
                subscriptionDocsUrl={subscriptionDocsUrl}
                organization={drawerScope}
            />
        </>
    )
}

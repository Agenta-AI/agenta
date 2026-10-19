import {createElement, type ReactNode, useCallback, useMemo, useState} from "react"

import {
    activeModelsSummary,
    credentialSummary,
    deleteSecretAtom,
    isSubscriptionConnection,
    PROVIDER_CATALOG,
    SecretKind,
    SecretManagementPolicy,
    subscriptionConnectionFor,
    subscriptionIsReady,
    subscriptionProviderName,
    subscriptionStatusLine,
    providerConnectionsAtom,
    useVaultSecret,
    type ProviderCatalogEntry,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {
    ProviderDrawer,
    providerIconFor,
    SubscriptionSignInDialog,
} from "@agenta/entity-ui/secretProvider"
import {PencilSimpleLine, Trash, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {type SubscriptionPlan, SubscriptionsBanner} from "./SubscriptionsBanner"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

export const SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** What the host needs to render its own confirm chrome; the page owns the removal itself. */
export interface ProviderRemovalState {
    connection: ProviderConnection | null
    open: boolean
    pending: boolean
    error: string | null
    onConfirm: () => void
    onClose: () => void
}

export interface AIProvidersPageProps {
    /** The host's confirm surface; the page runs the delete. Absent hides the Delete verb. */
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    /** Where "configured in the deployment" points. */
    subscriptionDocsUrl?: string
}

type DrawerTarget = {connection: ProviderConnection} | {kind: string}

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

const ProviderLogo = ({kind}: {kind: string}) =>
    createElement(providerIconFor(kind), {className: "size-[18px]"})

const CHATGPT_NAME = subscriptionProviderName("chatgpt")
const CLAUDE_NAME = subscriptionProviderName("claude")

/** Settings → AI providers: one row per connection, and every provider stays connectable again. */
export const AIProvidersPage = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
}: AIProvidersPageProps) => {
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const [signInProvider, setSignInProvider] = useState<"chatgpt" | "claude" | null>(null)
    const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const canRemove = Boolean(renderRemoveDialog)

    // Manager-only rows 409 on edit; the drawer still gets every connection so none look keyless.
    const userConnections = useMemo(
        () =>
            connections.filter(
                (connection) =>
                    connection.managementPolicy !== SecretManagementPolicy.ManagerOnly &&
                    !isSubscriptionConnection(connection),
            ),
        [connections],
    )

    const chatgpt = useMemo(() => subscriptionConnectionFor(connections, "chatgpt"), [connections])
    const claude = useMemo(() => subscriptionConnectionFor(connections, "claude"), [connections])

    const requestRemoval = useCallback((connection: ProviderConnection) => {
        setRemoveError(null)
        setPendingRemoval(connection)
    }, [])

    const removeConnection = useCallback(async () => {
        if (!pendingRemoval) return
        setRemoving(true)
        setRemoveError(null)
        try {
            await deleteSecret(pendingRemoval.source)
            mutate()
            setPendingRemoval(null)
        } catch {
            setRemoveError(`Agenta could not remove ${pendingRemoval.name}. Try again.`)
            setPendingRemoval(null)
        } finally {
            setRemoving(false)
        }
    }, [deleteSecret, mutate, pendingRemoval])

    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        const connectedRows = userConnections.map<SettingsCatalogItem>((connection) => ({
            key: connection.id,
            logo: <ProviderLogo kind={connection.kind} />,
            name: connection.name,
            description: [
                connection.title !== connection.name ? connection.title : null,
                credentialSummary(connection),
                activeModelsSummary(connection, capabilities),
            ]
                .filter(Boolean)
                .join(" · "),
            status: "connected",
            statusLabel: "Connected",
            onOpen: () => setDrawerTarget({connection}),
            menu: (
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
            ),
        }))

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
            {key: "connected", label: "Connected", items: connectedRows},
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
    }, [userConnections, capabilities, canRemove, requestRemoval])

    const plans = useMemo<SubscriptionPlan[]>(() => {
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

    return (
        <div className="ph-no-capture">
            <SettingsCatalog
                groups={groups}
                loading={loading && userConnections.length === 0}
                notice={
                    <>
                        {removeError ? (
                            <span className="flex items-center gap-1 text-xs text-destructive">
                                <WarningCircle size={14} />
                                {removeError}
                            </span>
                        ) : null}
                        <SubscriptionsBanner plans={plans} />
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

            <SubscriptionSignInDialog
                open={signInProvider === "chatgpt"}
                onClose={() => setSignInProvider(null)}
                provider="chatgpt"
                connection={chatgpt}
                logo={<ProviderLogo kind="openai" />}
                onRemove={canRemove ? requestRemoval : undefined}
            />
            <SubscriptionSignInDialog
                open={signInProvider === "claude"}
                onClose={() => setSignInProvider(null)}
                provider="claude"
                connection={claude}
                logo={<ProviderLogo kind="anthropic" />}
                onRemove={canRemove ? requestRemoval : undefined}
            />

            <ProviderDrawer
                open={!!drawerTarget}
                onClose={() => setDrawerTarget(null)}
                context="settings"
                connections={connections}
                connection={
                    drawerTarget && "connection" in drawerTarget ? drawerTarget.connection : null
                }
                kind={drawerTarget && "kind" in drawerTarget ? drawerTarget.kind : null}
                onSaved={mutate}
                subscriptionDocsUrl={subscriptionDocsUrl}
            />
        </div>
    )
}

import {createElement, type ReactNode, useCallback, useMemo, useState} from "react"

import {
    activeModelsSummary,
    credentialSummary,
    deleteSecretAtom,
    isSubscriptionConnection,
    PROVIDER_CATALOG,
    SecretKind,
    SecretManagementPolicy,
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
    /** Agenta Cloud: Claude reads a login mounted into the deployment, which the cloud has none of. */
    isCloud?: boolean
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

/** Settings → AI providers: one row per connection, and every provider stays connectable again. */
export const AIProvidersPage = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
    isCloud = false,
}: AIProvidersPageProps) => {
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null)
    const [signInOpen, setSignInOpen] = useState(false)
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

    const subscription = useMemo(
        () => connections.find(isSubscriptionConnection) ?? null,
        [connections],
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
        const connected = subscriptionIsReady(subscription?.subscription)
        const loginState = subscription?.subscription?.loginState
        // A sign-in that once worked and now does not needs attention, not a fresh connect.
        const broken = !connected && !!loginState && loginState !== "pending_login"
        return [
            {
                key: "chatgpt",
                logo: <ProviderLogo kind="openai" />,
                name: CHATGPT_NAME,
                detail:
                    subscriptionStatusLine(subscription?.subscription) ||
                    "Sign in with your account",
                state: connected ? "connected" : broken ? "attention" : "available",
                brand: "neutral",
                action: {
                    label: connected ? "Manage" : broken ? "Sign in again" : "Connect",
                    onClick: () => setSignInOpen(true),
                },
            },
            {
                key: "claude",
                logo: <ProviderLogo kind="anthropic" />,
                name: "Claude",
                detail: "Read from your deployment's login",
                state: "available",
                brand: "clay",
                action: {
                    label: "Set up",
                    external: true,
                    onClick: () =>
                        window.open(subscriptionDocsUrl, "_blank", "noopener,noreferrer"),
                },
                unavailable: isCloud ? "Self-hosted only" : undefined,
            },
        ]
    }, [subscription, subscriptionDocsUrl, isCloud])

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
                open={signInOpen}
                onClose={() => setSignInOpen(false)}
                connection={subscription}
                logo={<ProviderLogo kind="openai" />}
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

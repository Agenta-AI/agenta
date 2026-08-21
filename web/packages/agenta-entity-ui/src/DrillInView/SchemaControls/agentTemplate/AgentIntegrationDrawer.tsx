/**
 * AgentIntegrationDrawer
 *
 * The agent-playground tools catalog drawer. Its body renders the SAME {@link CatalogChooser}
 * the subscription drawer's "Choose a trigger" step uses (the 2-column app grid + connections
 * rail + detail), pointed at the `@agenta/entities/gatewayTool` catalog hooks with an
 * "add the action as a tool" leaf. No bespoke catalog UI here.
 *
 * Built on the shared `EnhancedDrawer` (like every other agent-playground drawer): an intent-based
 * header, `closeOnLayoutClick={false}` so an accidental backdrop click mid-connect never drops the
 * flow, and a footer whose count reflects the app tools added so far + a Done exit.
 */
import {useCallback, useState} from "react"

import {
    buildToolSlug,
    fetchToolActionDetail,
    isConnectionValid,
    toolIntegrationsSearchAtom,
    useToolCatalogActions,
    useToolCatalogCategories,
    useToolCatalogIntegrations,
    useToolConnectionsQuery,
    type ToolCatalogAction,
    type ToolCatalogActionDetails,
    type ToolCatalogIntegration,
    type ToolCatalogIntegrationDetails,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {message} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Segmented} from "@agenta/ui/ui"
import {Check, Plugs} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {CatalogChooser} from "../../../drawers/shared/CatalogChooser"
import ConnectDrawer from "../../../gatewayTool/drawers/ConnectDrawer"
import {useReconnectToolConnection} from "../../../gatewayTool/hooks/useReconnectToolConnection"
import type {ToolPermission} from "../toolPermission"
import type {ToolSelectionMeta} from "../ToolSelectorPopover"
import {
    buildGatewayToolkit,
    gatewayToolIdentity,
    gatewayToolkitIdentity,
    type ToolObj,
} from "../toolUtils"

import {PermissionPolicySelect} from "./PermissionPolicySelect"

type CatalogIntegrationItem = ToolCatalogIntegration | ToolCatalogIntegrationDetails

// The catalog offers two ways to add: per action (legacy, one tool per action) or the whole app
// (one `gateway_toolkit` entry, resolved server-side into a search + execute meta-tool).
type CatalogMode = "actions" | "toolkit"

// When the whole app is picked, either every action is allowed, or a chosen subset.
type ToolkitScope = "all" | "include"

// Per-connection toolkit draft — the sub-scope, the chosen actions (subset), and the permission
// default the entry carries. Keyed by connection id so switching accounts keeps each draft.
interface ToolkitDraft {
    scope: ToolkitScope
    actions: Set<string>
    permission: ToolPermission
}

const DEFAULT_TOOLKIT_PERMISSION: ToolPermission = "ask"

const TOOLKIT_PERMISSION_OPTIONS = [
    {value: "allow", title: "Allow", help: "Every action runs without asking"},
    {value: "ask", title: "Ask", help: "A human approves each action call"},
    {value: "deny", title: "Deny", help: "Every action call is refused"},
]

export interface AgentIntegrationDrawerProps {
    open: boolean
    onClose: () => void
    onAddTool: (tool: ToolObj, meta?: ToolSelectionMeta) => void
    onRemoveToolByIdentity?: (identity: string) => void
    selectedGatewayIds: Set<string>
    /** Preselect this app on open (a provider group's "Add {app} tool" → its actions directly). */
    defaultIntegrationKey?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Composio's per-action detail endpoint is flaky under bursts (rate limits / transient 5xx), which
// is what surfaced as "Failed to add action". Retry a couple of times with backoff so an action
// whose schema IS available doesn't fall back to a blank, guidance-less editor.
async function fetchActionDetailWithRetry(
    provider: string,
    integrationKey: string,
    actionKey: string,
    retries = 2,
) {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetchToolActionDetail(provider, integrationKey, actionKey)
        } catch (error) {
            lastError = error
            if (attempt < retries) {
                await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
            }
        }
    }
    throw lastError
}

function normalizeParameters(inputs: unknown): Record<string, unknown> {
    if (!isRecord(inputs)) {
        return {type: "object", properties: {}, required: [], additionalProperties: false}
    }
    const schema = {...inputs}
    if (schema.type !== "object") schema.type = "object"
    if (!isRecord(schema.properties)) schema.properties = {}
    if (!Array.isArray(schema.required)) schema.required = []
    if (typeof schema.additionalProperties !== "boolean") schema.additionalProperties = false
    return schema
}

// Catalog data wrappers (custom hooks) adapting the tool catalog hooks to CatalogChooser's shape.
function useToolIntegrationsList() {
    const setSearch = useSetAtom(toolIntegrationsSearchAtom)
    const r = useToolCatalogIntegrations()
    return {
        integrations: r.integrations,
        total: r.total,
        hasNextPage: r.hasNextPage,
        isFetchingNextPage: r.isFetchingNextPage,
        isLoading: r.isLoading,
        requestMore: r.requestMore,
        setSearch,
        setCategory: r.setCategory,
        error: r.error,
        refetch: r.refetch,
    }
}

function useToolCategoriesList() {
    const r = useToolCatalogCategories()
    return {categories: r.categories, isLoading: r.isLoading, error: r.error, refetch: r.refetch}
}

function useToolActionList(integrationKey: string) {
    const r = useToolCatalogActions(integrationKey)
    return {
        items: r.actions,
        isLoading: r.isLoading,
        hasNextPage: r.hasNextPage,
        isFetchingNextPage: r.isFetchingNextPage,
        requestMore: r.requestMore,
        setSearch: r.setSearch,
    }
}

/**
 * ToolkitAddPanel — the connection-level "add the whole app" affordance, rendered inside the
 * selected-connection detail (via {@link CatalogChooser}'s `renderConnectionExtra`). It writes ONE
 * `gateway_toolkit` entry instead of one tool per action. When the scope is "Choose actions" the
 * action list below doubles as the picker (each pick toggles the subset).
 */
function ToolkitAddPanel({
    integrationName,
    draft,
    added,
    onScopeChange,
    onPermissionChange,
    onAdd,
    onRemove,
}: {
    integrationName: string
    draft: ToolkitDraft
    added: boolean
    onScopeChange: (scope: ToolkitScope) => void
    onPermissionChange: (permission: ToolPermission) => void
    onAdd: () => void
    onRemove: () => void
}) {
    const includeEmpty = draft.scope === "include" && draft.actions.size === 0
    return (
        <div className="ag-drawer-card mt-4 flex flex-col gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorder)] p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium">
                    Add the whole {integrationName} app
                </span>
                {added && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--ag-colorSuccess)]">
                        <Check size={12} /> Added
                    </span>
                )}
            </div>
            <Segmented
                block
                size="sm"
                value={draft.scope}
                onChange={(value) => onScopeChange(value as ToolkitScope)}
                options={[
                    {label: "All actions", value: "all"},
                    {label: "Choose actions", value: "include"},
                ]}
            />
            {draft.scope === "include" && (
                <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                    {draft.actions.size > 0
                        ? `${draft.actions.size} selected — tap actions in the list below to change.`
                        : "Pick the allowed actions from the list below."}
                </span>
            )}
            <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-[var(--ag-colorTextSecondary)]">
                    On an action call
                </span>
                <div className="min-w-0 flex-1">
                    <PermissionPolicySelect
                        value={draft.permission}
                        onChange={(value) => onPermissionChange(value as ToolPermission)}
                        options={TOOLKIT_PERMISSION_OPTIONS}
                        aria-label="Toolkit permission"
                    />
                </div>
            </div>
            {added ? (
                <Button variant="outline" onClick={onRemove}>
                    Remove app
                </Button>
            ) : (
                <Button variant="default" disabled={includeEmpty} onClick={onAdd}>
                    Add app
                </Button>
            )}
        </div>
    )
}

// Body — mounted only while the drawer is open (Drawer destroyOnClose), so catalog queries don't
// run in the background.
function ToolCatalogContent({
    onAddTool,
    onRemoveToolByIdentity,
    selectedGatewayIds,
    defaultIntegrationKey,
}: Omit<AgentIntegrationDrawerProps, "open" | "onClose">) {
    const [pending, setPending] = useState<string | null>(null)
    const [mode, setMode] = useState<CatalogMode>("actions")
    // Per-connection toolkit drafts (scope / chosen subset / permission), keyed by connection id.
    const [drafts, setDrafts] = useState<Record<string, ToolkitDraft>>({})
    const {connections} = useToolConnectionsQuery()
    const {reconnect, reconnectingId} = useReconnectToolConnection()

    // A stable key per connection for the draft map (id, else slug, else the integration key).
    const connKey = useCallback(
        (conn: ToolConnection) => conn.id ?? conn.slug ?? conn.integration_key,
        [],
    )
    const draftFor = useCallback(
        (conn: ToolConnection): ToolkitDraft =>
            drafts[connKey(conn)] ?? {
                scope: "all",
                actions: new Set<string>(),
                permission: DEFAULT_TOOLKIT_PERMISSION,
            },
        [drafts, connKey],
    )
    const updateDraft = useCallback(
        (conn: ToolConnection, patch: (draft: ToolkitDraft) => ToolkitDraft) => {
            const key = connKey(conn)
            setDrafts((prev) => {
                const current = prev[key] ?? {
                    scope: "all" as ToolkitScope,
                    actions: new Set<string>(),
                    permission: DEFAULT_TOOLKIT_PERMISSION,
                }
                return {...prev, [key]: patch(current)}
            })
        },
        [connKey],
    )
    // Identity of the `gateway_toolkit` entry for a connection — the added-state and remove key.
    const toolkitIdFor = useCallback(
        (conn: ToolConnection) =>
            gatewayToolkitIdentity({
                provider: conn.provider_key ?? "composio",
                integration: conn.integration_key,
                connection: conn.slug ?? "",
            }),
        [],
    )
    const addToolkit = useCallback(
        (conn: ToolConnection) => {
            const draft = draftFor(conn)
            onAddTool(
                buildGatewayToolkit({
                    provider: conn.provider_key ?? "composio",
                    integration: conn.integration_key,
                    connection: conn.slug ?? "",
                    mode: draft.scope,
                    actions: [...draft.actions],
                    permission: draft.permission,
                }) as ToolObj,
            )
        },
        [draftFor, onAddTool],
    )

    // The in-flight spinner is still keyed by slug; the added-state is keyed by identity.
    const slugFor = useCallback(
        (conn: ToolConnection, actionKey: string) =>
            buildToolSlug(
                conn.provider_key ?? "composio",
                conn.integration_key,
                actionKey,
                conn.slug ?? "",
            ),
        [],
    )

    // Encoding-independent identity — matches a canonical or legacy entry already in the config.
    const idFor = useCallback(
        (conn: ToolConnection, actionKey: string) =>
            gatewayToolIdentity({
                provider: conn.provider_key ?? "composio",
                integration: conn.integration_key,
                action: actionKey,
                connection: conn.slug ?? "",
                encoding: "legacy",
            }),
        [],
    )

    // Add the chosen action as a function tool (toggles off if already added).
    const toggle = useCallback(
        async (conn: ToolConnection, action: ToolCatalogAction) => {
            const id = idFor(conn, action.key)
            if (selectedGatewayIds.has(id)) {
                onRemoveToolByIdentity?.(id)
                return
            }
            const slug = slugFor(conn, action.key)
            setPending(slug)
            // The model-facing input schema comes from the per-action detail endpoint, which
            // errors provider-side for some actions. That must NOT block the add: the tool
            // resolves server-side by slug regardless. When the schema resolves we add straight
            // away (gateway is multi-select); when it doesn't, `needsConfig` opens the tool
            // editor so the user defines the parameters instead of getting a schema-less tool.
            let inputs: unknown
            let fetchFailed = false
            try {
                const detail = await fetchActionDetailWithRetry(
                    conn.provider_key ?? "composio",
                    conn.integration_key,
                    action.key,
                )
                const detailed =
                    detail.action && "schemas" in detail.action
                        ? (detail.action as ToolCatalogActionDetails)
                        : null
                inputs = detailed?.schemas?.inputs
            } catch {
                fetchFailed = true
            }
            try {
                onAddTool(
                    {
                        type: "function",
                        function: {
                            name: slug,
                            description: action.description || action.name || action.key,
                            parameters: normalizeParameters(inputs),
                        },
                    },
                    {
                        source: "gateway",
                        provider: conn.provider_key ?? "composio",
                        toolCode: action.key,
                        toolLabel: action.key,
                        integrationKey: conn.integration_key,
                        connectionSlug: conn.slug ?? "",
                        needsConfig: fetchFailed,
                    },
                )
            } catch {
                message.error("Couldn't add this tool")
            } finally {
                setPending(null)
            }
        },
        [slugFor, idFor, selectedGatewayIds, onAddTool, onRemoveToolByIdentity],
    )

    const toolkitMode = mode === "toolkit"

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 px-6 pb-1 pt-4">
                <Segmented
                    size="sm"
                    value={mode}
                    onChange={(value) => setMode(value as CatalogMode)}
                    options={[
                        {label: "Individual actions", value: "actions"},
                        {label: "Whole app", value: "toolkit"},
                    ]}
                />
            </div>
            <CatalogChooser<CatalogIntegrationItem, ToolCatalogAction, ToolConnection>
                connections={connections}
                cardVariant="subtle"
                fullBleedRail
                useCategories={useToolCategoriesList}
                defaultIntegrationKey={defaultIntegrationKey}
                isConnectionReady={isConnectionValid}
                onReconnect={(c) => c.id && reconnect(c.id)}
                isReconnecting={(c) => !!c.id && c.id === reconnectingId}
                useIntegrations={useToolIntegrationsList}
                useItems={useToolActionList}
                integration={{
                    key: (i) => i.key,
                    name: (i) => i.name,
                    logo: (i) => i.logo,
                    description: (i) => i.description,
                    categories: (i) =>
                        (i as {categories?: string[] | null}).categories ?? undefined,
                    actionsCount: (i) => (i as {actions_count?: number | null}).actions_count,
                }}
                connection={{
                    id: (c) => c.id ?? undefined,
                    name: (c) => c.name ?? undefined,
                    slug: (c) => c.slug ?? undefined,
                    integrationKey: (c) => c.integration_key,
                }}
                item={{
                    key: (a) => a.key,
                    name: (a) => a.name ?? undefined,
                    description: (a) => a.description ?? undefined,
                    categories: (a) => a.categories ?? undefined,
                    readOnly: (a) => a.read_only ?? undefined,
                    deprecated: (a) => /^\s*deprecated\b/i.test(a.description ?? ""),
                }}
                itemsLabel={toolkitMode ? "Actions in this app" : "Choose an action"}
                itemsSearchPlaceholder="Search actions"
                emptyItemsText="No actions for this app"
                onPickItem={(conn, action) => {
                    // Whole-app mode: a pick toggles the subset (include scope) or is inert (all scope).
                    // Individual mode: add/remove the action as its own tool.
                    if (toolkitMode) {
                        if (draftFor(conn).scope !== "include") return
                        updateDraft(conn, (draft) => {
                            const actions = new Set(draft.actions)
                            if (actions.has(action.key)) actions.delete(action.key)
                            else actions.add(action.key)
                            return {...draft, actions}
                        })
                        return
                    }
                    void toggle(conn, action)
                }}
                itemState={(conn, action) => {
                    if (toolkitMode) {
                        const draft = draftFor(conn)
                        if (draft.scope === "all") return "selected"
                        return draft.actions.has(action.key) ? "selected" : "add"
                    }
                    if (pending === slugFor(conn, action.key)) return "pending"
                    return selectedGatewayIds.has(idFor(conn, action.key)) ? "selected" : "add"
                }}
                renderConnectionExtra={
                    toolkitMode
                        ? (conn, integration) => (
                              <ToolkitAddPanel
                                  integrationName={integration?.name ?? conn.integration_key}
                                  draft={draftFor(conn)}
                                  added={selectedGatewayIds.has(toolkitIdFor(conn))}
                                  onScopeChange={(scope) =>
                                      updateDraft(conn, (draft) => ({...draft, scope}))
                                  }
                                  onPermissionChange={(permission) =>
                                      updateDraft(conn, (draft) => ({...draft, permission}))
                                  }
                                  onAdd={() => addToolkit(conn)}
                                  onRemove={() => onRemoveToolByIdentity?.(toolkitIdFor(conn))}
                              />
                          )
                        : undefined
                }
                renderConnect={(integration, handlers) => (
                    <ConnectDrawer
                        open
                        integrationKey={integration.key}
                        integrationName={integration.name}
                        integrationLogo={integration.logo ?? undefined}
                        integrationDescription={integration.description ?? undefined}
                        authSchemes={
                            (integration as {auth_schemes?: string[] | null}).auth_schemes ?? []
                        }
                        onClose={handlers.onClose}
                        onSuccess={handlers.onSuccess}
                    />
                )}
            />
        </div>
    )
}

export function AgentIntegrationDrawer({
    open,
    onClose,
    onAddTool,
    onRemoveToolByIdentity,
    selectedGatewayIds,
    defaultIntegrationKey,
}: AgentIntegrationDrawerProps) {
    // App tools already added — the footer count so the multi-add flow shows progress.
    const addedCount = selectedGatewayIds.size

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={960}
            // Explicit exit only — an accidental backdrop click mid-connect must not drop the flow.
            closeOnLayoutClick={false}
            destroyOnClose
            title={
                <div className="flex items-center gap-2">
                    <Plugs size={16} />
                    <span className="text-sm font-medium">Add app tools</span>
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-xs text-[var(--ag-zinc-5)]">
                        {addedCount > 0
                            ? `${addedCount} app ${addedCount === 1 ? "tool" : "tools"} added`
                            : "Pick actions from a connected app — added instantly."}
                    </span>
                    <Button variant="default" onClick={onClose}>
                        Done
                    </Button>
                </div>
            }
        >
            <ToolCatalogContent
                onAddTool={onAddTool}
                onRemoveToolByIdentity={onRemoveToolByIdentity}
                selectedGatewayIds={selectedGatewayIds}
                defaultIntegrationKey={defaultIntegrationKey}
            />
        </EnhancedDrawer>
    )
}

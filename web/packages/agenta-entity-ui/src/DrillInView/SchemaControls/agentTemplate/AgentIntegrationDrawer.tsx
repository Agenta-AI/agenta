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
import {useCallback, useMemo, useState} from "react"

import {
    buildToolSlug,
    fetchToolActionDetail,
    isConnectionValid,
    toolIntegrationsSearchAtom,
    useToolCatalogActions,
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
import {Plugs} from "@phosphor-icons/react"
import {Button} from "antd"
import {useSetAtom} from "jotai"

import {CatalogChooser} from "../../../drawers/shared/CatalogChooser"
import ConnectDrawer from "../../../gatewayTool/drawers/ConnectDrawer"
import type {ToolSelectionMeta} from "../ToolSelectorPopover"
import {parseGatewayFunctionName, type ToolObj} from "../toolUtils"

type CatalogIntegrationItem = ToolCatalogIntegration | ToolCatalogIntegrationDetails

export interface AgentIntegrationDrawerProps {
    open: boolean
    onClose: () => void
    onAddTool: (tool: ToolObj, meta?: ToolSelectionMeta) => void
    onRemoveTool?: (toolName: string) => void
    selectedToolNames: Set<string>
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
        hasNextPage: r.hasNextPage,
        isFetchingNextPage: r.isFetchingNextPage,
        isLoading: r.isLoading,
        requestMore: r.requestMore,
        setSearch,
    }
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

// Body — mounted only while the drawer is open (Drawer destroyOnClose), so catalog queries don't
// run in the background.
function ToolCatalogContent({
    onAddTool,
    onRemoveTool,
    selectedToolNames,
    defaultIntegrationKey,
}: Omit<AgentIntegrationDrawerProps, "open" | "onClose">) {
    const [pending, setPending] = useState<string | null>(null)
    const {connections} = useToolConnectionsQuery()

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

    // Add the chosen action as a function tool (toggles off if already added).
    const toggle = useCallback(
        async (conn: ToolConnection, action: ToolCatalogAction) => {
            const slug = slugFor(conn, action.key)
            if (selectedToolNames.has(slug)) {
                onRemoveTool?.(slug)
                return
            }
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
        [slugFor, selectedToolNames, onAddTool, onRemoveTool],
    )

    return (
        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
            <CatalogChooser<CatalogIntegrationItem, ToolCatalogAction, ToolConnection>
                connections={connections}
                cardVariant="subtle"
                defaultIntegrationKey={defaultIntegrationKey}
                isConnectionReady={isConnectionValid}
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
                itemsLabel="Choose an action"
                itemsSearchPlaceholder="Search actions"
                emptyItemsText="No actions for this app"
                onPickItem={(conn, action) => void toggle(conn, action)}
                itemState={(conn, action) => {
                    const slug = slugFor(conn, action.key)
                    if (pending === slug) return "pending"
                    return selectedToolNames.has(slug) ? "selected" : "add"
                }}
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
    onRemoveTool,
    selectedToolNames,
    defaultIntegrationKey,
}: AgentIntegrationDrawerProps) {
    // App tools already added — the footer count so the multi-add flow shows progress.
    const addedCount = useMemo(() => {
        let n = 0
        for (const name of selectedToolNames) if (parseGatewayFunctionName(name)) n++
        return n
    }, [selectedToolNames])

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
                    <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        {addedCount > 0
                            ? `${addedCount} app ${addedCount === 1 ? "tool" : "tools"} added`
                            : "Pick actions from a connected app — added instantly."}
                    </span>
                    <Button type="primary" onClick={onClose}>
                        Done
                    </Button>
                </div>
            }
        >
            <ToolCatalogContent
                onAddTool={onAddTool}
                onRemoveTool={onRemoveTool}
                selectedToolNames={selectedToolNames}
                defaultIntegrationKey={defaultIntegrationKey}
            />
        </EnhancedDrawer>
    )
}

/**
 * Gateway-tool entity module.
 *
 * Browser-side state, queries, and mutations for the `/tools/*` endpoint
 * family. API calls go through the Fern-generated `@agentaai/api-client`
 * (resolved via `@agenta/sdk`) so request/response shapes stay in sync with
 * the backend OpenAPI definition.
 *
 * Lifted from `web/oss/src/features/gateway-tools/` (the hand-rolled
 * services + hooks layer is going away; the OSS feature folder shrinks to
 * just orchestration glue).
 */

// ---------------------------------------------------------------------------
// CORE — domain types
// ---------------------------------------------------------------------------

export type {
    Status,
    ToolAuthScheme,
    ToolCall,
    ToolCallData,
    ToolCallFunction,
    ToolCallResponse,
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogActionResponse,
    ToolCatalogActionsResponse,
    ToolCatalogCategory,
    ToolCatalogCategoriesResponse,
    ToolCatalogIntegration,
    ToolCatalogIntegrationDetails,
    ToolCatalogIntegrationResponse,
    ToolCatalogIntegrationsResponse,
    ToolCatalogProvider,
    ToolCatalogProviderDetails,
    ToolCatalogProviderResponse,
    ToolCatalogProvidersResponse,
    ToolConnection,
    ToolConnectionCreate,
    ToolConnectionCreateData,
    ToolConnectionCreatePayload,
    ToolConnectionCreatePayloadData,
    ToolConnectionResponse,
    ToolConnectionStatus,
    ToolConnectionsResponse,
    ToolProviderKind,
    ToolResult,
    ToolResultData,
} from "./core"
export {isConnectionActive, isConnectionValid} from "./core"

// ---------------------------------------------------------------------------
// API — Fern-backed HTTP wrappers
// ---------------------------------------------------------------------------

export {
    createToolConnection,
    deleteToolConnection,
    executeToolCall,
    fetchToolActionDetail,
    fetchToolActions,
    fetchToolConnection,
    fetchToolIntegrationDetail,
    fetchToolIntegrations,
    fetchToolProviders,
    getToolsClient,
    projectScopedRequest,
    queryToolConnections,
    refreshToolConnection,
    revokeToolConnection,
} from "./api"

// ---------------------------------------------------------------------------
// STATE — drawer + selection atoms
// ---------------------------------------------------------------------------

export {
    actionSearchAtom,
    catalogSearchAtom,
    connectionDrawerAtom,
    selectedCatalogActionAtom,
    selectedCatalogIntegrationAtom,
    toolCatalogDrawerOpenAtom,
    toolExecutionDrawerAtom,
} from "./state"
export type {ConnectionDrawerState, ExecutionDrawerState} from "./state"

// ---------------------------------------------------------------------------
// HOOKS — query/mutation hooks for React consumers
// ---------------------------------------------------------------------------

export {
    buildToolSlug,
    toolActionAvailabilityKey,
    toolActionDetailQueryFamily,
    toolActionsSearchAtom,
    toolCatalogActionsInfiniteFamily,
    toolCatalogCategoriesQueryAtom,
    toolCatalogIntegrationsInfiniteAtom,
    toolConnectionQueryAtomFamily,
    toolConnectionsQueryAtom,
    toolIntegrationConnectionsAtomFamily,
    toolIntegrationDetailQueryFamily,
    toolIntegrationsCategoryAtom,
    toolIntegrationsSearchAtom,
    useToolActionAvailability,
    useToolActionDetail,
    useToolCatalogActions,
    useToolCatalogCategories,
    useToolCatalogIntegrations,
    useToolConnectionActions,
    useToolConnectionQuery,
    useToolConnectionsQuery,
    useToolExecution,
    useToolIntegrationConnections,
    useToolIntegrationDetail,
} from "./hooks"

// ---------------------------------------------------------------------------
// PROMPT — cross-entity bridge (workflow-aware tool removal)
// ---------------------------------------------------------------------------

export {removePromptToolByNameAtomFamily} from "./prompt"

// ---------------------------------------------------------------------------
// SLUG HELPERS — re-exported from @agenta/shared for ergonomic single-import
// ---------------------------------------------------------------------------

export {buildGatewayToolSlug, isGatewayToolSlug, parseGatewayToolSlug} from "@agenta/shared/utils"

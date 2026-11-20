/**
 * Gateway-tool entity UI.
 *
 * Atom-driven drawers and presentational components for browsing
 * integrations, managing connections, and executing tools. State and data
 * come from `@agenta/entities/gatewayTool`; this layer is purely the UI.
 */

export {default as CatalogDrawer} from "./drawers/CatalogDrawer"
export {default as ConnectDrawer} from "./drawers/ConnectDrawer"
export {
    integrationConnectView,
    type IntegrationConnectViewParams,
} from "../DrillInView/SchemaControls/agentTemplate/views/integrationConnectView"
// The one integration list: the "Add integration" view body, and the Settings page.
export {
    IntegrationCatalog,
    type IntegrationCatalogProps,
    type IntegrationCatalogRun,
    type IntegrationCatalogYours,
} from "../DrillInView/SchemaControls/agentTemplate/IntegrationCatalog"
export type {ConnectionAction} from "../DrillInView/SchemaControls/agentTemplate/ConnectionActionConfirm"
export {default as ConnectionManagerDrawer} from "./drawers/ConnectionManagerDrawer"
export {default as ToolExecutionDrawer} from "./drawers/ToolExecutionDrawer"

export {default as ConnectionStatusBadge} from "./components/ConnectionStatusBadge"
export {FinishConnectionDialog} from "./components/FinishConnectionDialog"
export {useRefreshToolConnection} from "./hooks/useRefreshToolConnection"
export {default as ResultViewer} from "./components/ResultViewer"
export {
    default as SchemaForm,
    type SchemaFormHandle,
    type StepInfo,
    formatReviewValue,
} from "./components/SchemaForm"
export {
    ChipsInput,
    DateTimeInput,
    MultiSelect,
    SelectControl,
} from "./components/schemaFormControls"
export {useDirectToolConnect, type DirectConnectInput} from "./hooks/useDirectToolConnect"

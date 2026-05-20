/**
 * Gateway-tool entity UI.
 *
 * Atom-driven drawers and presentational components for browsing
 * integrations, managing connections, and executing tools. State and data
 * come from `@agenta/entities/gatewayTool`; this layer is purely the UI.
 */

export {default as CatalogDrawer} from "./drawers/CatalogDrawer"
export {default as ConnectDrawer} from "./drawers/ConnectDrawer"
export {default as ConnectionManagerDrawer} from "./drawers/ConnectionManagerDrawer"
export {default as ToolExecutionDrawer} from "./drawers/ToolExecutionDrawer"

export {default as ConnectionStatusBadge} from "./components/ConnectionStatusBadge"
export {default as ResultViewer} from "./components/ResultViewer"
export {default as SchemaForm, type SchemaFormHandle} from "./components/SchemaForm"

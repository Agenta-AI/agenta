import {buildGatewayToolSlug, isGatewayToolSlug, parseGatewayToolSlug} from "@agenta/shared/utils"

// State
export {
    actionSearchAtom,
    catalogDrawerOpenAtom,
    catalogSearchAtom,
    executionDrawerAtom,
    selectedCatalogActionAtom,
    selectedCatalogIntegrationAtom,
} from "./state/atoms"
export type {ExecutionDrawerState} from "./state/atoms"

// Hooks
export {buildGatewayToolSlug, isGatewayToolSlug, parseGatewayToolSlug}
export {useActionDetail} from "./hooks/useActionDetail"
export {useCatalogActions} from "./hooks/useCatalogActions"
export {useCatalogIntegrations} from "./hooks/useCatalogIntegrations"
export {useConnectionActions} from "./hooks/useConnectionActions"
export {useConnectionQuery} from "./hooks/useConnectionQuery"
export {useConnectionsQuery} from "./hooks/useConnectionsQuery"
export {useIntegrationDetail} from "./hooks/useIntegrationDetail"
export {buildToolSlug, useToolExecution} from "./hooks/useToolExecution"

// Prompt integration atoms (OSS playground prompt editor wiring)
export {removePromptToolByNameAtomFamily} from "./prompt/atoms"

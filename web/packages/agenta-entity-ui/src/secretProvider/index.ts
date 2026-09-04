/**
 * Custom-provider (vault secret) form UI — the add/edit form shared by the
 * "Configure provider" drawer and any inline drawer pane that needs the same flow.
 */

export {
    default as CustomProviderForm,
    type CustomProviderFormHandle,
    type CustomProviderFormProps,
} from "./CustomProviderForm"
export {default as ModelNameInput, type ModelNameInputProps} from "./ModelNameInput"

/**
 * The AI-providers drawer and its levels — the catalog, the connection card, and the card's two
 * sections. The drawer is the whole surface; the parts are exported for the playground context
 * (pull request 3) and for tests.
 */
export {
    default as ProviderDrawer,
    type ProviderDrawerContext,
    type ProviderDrawerProps,
} from "./ProviderDrawer"
export {default as ProviderCatalogList, type ProviderCatalogListProps} from "./ProviderCatalogList"
export {providerIconFor} from "./providerIcon"
export {
    default as ProviderConnectionCard,
    type ProviderCardSaveState,
    type ProviderConnectionCardProps,
} from "./ProviderConnectionCard"
export {default as ActiveModelsSection, type ActiveModelsSectionProps} from "./ActiveModelsSection"
export {
    default as HarnessesSection,
    type HarnessChoice,
    type HarnessesSectionProps,
} from "./HarnessesSection"
export {
    default as SubscriptionPairCard,
    type SubscriptionPairCardProps,
    type SubscriptionPairCardSaveState,
} from "./SubscriptionPairCard"
export {default as ScrollScrim, type ScrollScrimProps} from "./ScrollScrim"

/**
 * The "Configure provider" drawer and the drill-in `llmProviderConfig` bridge that opens it —
 * host-neutral, so the desktop playground and `/m` share one model-picker footer and one vault
 * provider group builder.
 */
export {
    default as ConfigureProviderDrawer,
    type ConfigureProviderDrawerProps,
} from "./ConfigureProviderDrawer"
export {useLLMProviderConfig, type LLMProviderConfig} from "./useLLMProviderConfig"

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
    type ProviderOwnerChoice,
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
export {
    default as SubscriptionConnectionCard,
    type SubscriptionConnectionCardProps,
} from "./SubscriptionConnectionCard"
export {
    default as SubscriptionSignInDialog,
    type SubscriptionSignInDialogProps,
} from "./SubscriptionSignInDialog"
export {
    default as SubscriptionTokenCard,
    type SubscriptionTokenCardProps,
} from "./SubscriptionTokenCard"
export {default as ScrollScrim, type ScrollScrimProps} from "./ScrollScrim"
export {
    default as OrganizationProjectsSection,
    type OrganizationConnectionScope,
    type OrganizationProjectChoice,
    type OrganizationProjectOption,
    type OrganizationProjectsSectionProps,
} from "./OrganizationProjectsSection"
export {organizationRefusal, organizationSaveError} from "./useOrganizationProjectsDraft"

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

/** Saving one API key without the drawer, for inline add-key forms. */
export {
    KEY_PROVIDERS,
    keyPlaceholderFor,
    newProviderKeyDraft,
    useSaveProviderKey,
} from "./useSaveProviderKey"

/**
 * The model providers views (target `project`): the list, "Add a provider or subscription", one
 * connection's form and the built-in models card. `ProviderListBody` is the list for a host that
 * shows it as its root (Settings › AI providers).
 */
export {
    builtinModelsView,
    providerAddView,
    providerConnectionView,
    providerListView,
    type BuiltinModelsParams,
    type ProviderAddParams,
    type ProviderConnectionParams,
    type ProviderListParams,
} from "./views/providerViews"
export {ProviderListBody, type ProviderListBodyProps} from "./views/ProviderListBody"
export {ProviderOwnerChoiceContext} from "./views/providerOwnerChoice"

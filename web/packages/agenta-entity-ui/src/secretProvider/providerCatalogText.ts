/**
 * The provider catalog's groups and row text, shared by Settings › AI providers and the agent
 * panel's Model providers view, so both list the same providers with the same words.
 */
import {PROVIDER_CATALOG, SecretKind, type ProviderCatalogEntry} from "@agenta/entities/secret"
import type {CatalogKey} from "@agenta/i18n"
import type settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"

type ProvidersKey = CatalogKey<typeof settingsProvidersCatalog>
type ProvidersT = (key: ProvidersKey) => string

export type SubscriptionProduct = "chatgpt" | "claude"

/** The subscriptions a project can sign in, in catalog order. */
export const SUBSCRIPTION_PRODUCTS: SubscriptionProduct[] = ["chatgpt", "claude"]

/** The line under a subscription that is not signed in yet. */
export const SUBSCRIPTION_HINT: Record<SubscriptionProduct, ProvidersKey> = {
    chatgpt: "settings.providers.chatgptHint",
    claude: "settings.providers.claudeHint",
}

/** Providers that take one API key. */
export const MODEL_PROVIDERS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.ProviderKey,
)

/** Providers whose form asks for more than a key (cloud platforms, a custom endpoint). */
export const CLOUD_PLATFORMS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.CustomProvider,
)

/** What a credential-set kind's form asks for, read off its fields in `providerFields.ts`. */
const FORM_FIELDS_BY_KIND: Record<string, ProvidersKey> = {
    bedrock: "settings.providers.bedrockFields",
    azure: "settings.providers.azureFields",
    vertex_ai: "settings.providers.vertexFields",
}

/** A catalog entry's name; the OpenAI-compatible kind's name is translated. */
export const providerCatalogTitle = (entry: ProviderCatalogEntry, t: ProvidersT): string =>
    entry.kind === "custom" ? t("settings.providers.customEndpoint") : entry.title

/** A catalog entry's one line: what its form asks for. */
export const providerCatalogDescription = (
    entry: ProviderCatalogEntry,
    t: ProvidersT,
): string | undefined => {
    if (entry.kind === "custom") return t("settings.providers.customEndpointHint")
    if (entry.subtitle) return entry.subtitle
    if (entry.secretKind === SecretKind.ProviderKey) return t("settings.providers.apiKey")
    const fields = FORM_FIELDS_BY_KIND[entry.kind]
    return fields ? t(fields) : undefined
}

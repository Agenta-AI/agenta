/** Saving one API key without the drawer, as the untouched connection card would. */
import {useCallback} from "react"

import {
    connectionPolicyForSave,
    defaultNamePreview,
    harnessSupportsProviderKind,
    PROVIDER_CATALOG,
    providerConnectionsAtom,
    saveProviderConnectionAtom,
    SecretKind,
    type ConnectionDraft,
    type HarnessCapabilityMap,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {useAtomValue, useSetAtom} from "jotai"
import {createT} from "@agenta/i18n"
import providerConnectionCatalog from "@agenta/i18n/catalogs/entityUi.providerConnection"

/** The harness a new API key is checked for by default, when the provider can reach it. */
export const DEFAULT_KEY_HARNESS = "pi_core"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

const t = createT(providerConnectionCatalog)

/** Each single-key provider's key shape, most-used first: the order a key picker lists them in. */
const KEY_PLACEHOLDERS: Record<string, string | {provider: string}> = {
    openai: "sk-…",
    anthropic: "sk-ant-…",
    gemini: "AIza…",
    mistral: {provider: "Mistral"},
    xai: "xai-…",
    groq: "gsk_…",
    openrouter: "sk-or-…",
    perplexityai: "pplx-…",
    cohere: {provider: "Cohere"},
    together_ai: {provider: "Together"},
    deepinfra: {provider: "DeepInfra"},
    anyscale: "esecret_…",
    minimax: {provider: "MiniMax"},
}

const KEY_ORDER = Object.keys(KEY_PLACEHOLDERS)
const keyRank = (kind: string) => {
    const index = KEY_ORDER.indexOf(kind)
    return index === -1 ? KEY_ORDER.length : index
}

/** The catalog's providers that take one API key and nothing else. */
export const KEY_PROVIDERS = PROVIDER_CATALOG.filter(
    (entry) => entry.secretKind === SecretKind.ProviderKey,
).sort((a, b) => keyRank(a.kind) - keyRank(b.kind))

/** What a key for this provider looks like, as an input placeholder. */
export const keyPlaceholderFor = (kind: string, title: string): string => {
    const placeholder = KEY_PLACEHOLDERS[kind]
    if (typeof placeholder === "string") return placeholder
    return t("entityUi.providerConnection.apiKeyPlaceholder", {
        provider: placeholder?.provider ?? title,
    })
}

/** The draft an untouched card sends: models omitted (the recommended set), default harness. */
export const newProviderKeyDraft = (
    kind: string,
    apiKey: string,
    capabilities: HarnessCapabilityMap | null | undefined,
): ConnectionDraft => ({
    kind,
    name: "",
    credential: {apiKey},
    ...connectionPolicyForSave({
        checkedModels: null,
        modelIds: [],
        harnesses: null,
        defaultHarness: harnessSupportsProviderKind(capabilities, DEFAULT_KEY_HARNESS, kind)
            ? DEFAULT_KEY_HARNESS
            : null,
    }),
})

/** Saves a new API key for `kind` and resolves to the new connection's id. */
export function useSaveProviderKey() {
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const connections = useAtomValue(providerConnectionsAtom)
    const save = useSetAtom(saveProviderConnectionAtom)

    return useCallback(
        (kind: string, apiKey: string) =>
            save({
                draft: newProviderKeyDraft(kind, apiKey, capabilities),
                fallbackName: defaultNamePreview(kind, connections),
            }),
        [save, capabilities, connections],
    )
}

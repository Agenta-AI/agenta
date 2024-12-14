import cloneDeep from "lodash/cloneDeep"
import {SecretDTOProvider, VaultSecretDTO} from "../types_ee"

const llmAvailableProvidersToken = "llmAvailableProvidersToken"

export type LlmProvider = {
    title: string
    key: string
    name: string
    id?: string
}

export const llmAvailableProviders: LlmProvider[] = [
    {title: "OpenAI", key: "", name: "OPENAI_API_KEY"},
    {title: "Mistral AI", key: "", name: "MISTRAL_API_KEY"},
    {title: "Cohere", key: "", name: "COHERE_API_KEY"},
    {title: "Anthropic", key: "", name: "ANTHROPIC_API_KEY"},
    {title: "Anyscale", key: "", name: "ANYSCALE_API_KEY"},
    {title: "Perplexity AI", key: "", name: "PERPLEXITYAI_API_KEY"},
    {title: "DeepInfra", key: "", name: "DEEPINFRA_API_KEY"},
    {title: "TogetherAI", key: "", name: "TOGETHERAI_API_KEY"},
    {title: "Aleph Alpha", key: "", name: "ALEPHALPHA_API_KEY"},
    {title: "OpenRouter", key: "", name: "OPENROUTER_API_KEY"},
    {title: "Groq", key: "", name: "GROQ_API_KEY"},
    {title: "Gemini", key: "", name: "GEMINI_API_KEY"},
]

export const getApikeys = () => {
    if (typeof window !== "undefined") {
        const llmAvailableProvidersTokenString = localStorage.getItem(llmAvailableProvidersToken)
        const apiKeys: Array<LlmProvider> = []

        if (llmAvailableProvidersTokenString !== null) {
            const llmAvailableProvidersTokenArray = JSON.parse(llmAvailableProvidersTokenString)

            if (
                Array.isArray(llmAvailableProvidersTokenArray) &&
                llmAvailableProvidersTokenArray.length > 0
            ) {
                for (let i = 0; i < llmAvailableProvidersTokenArray.length; i++) {
                    if (llmAvailableProvidersTokenArray[i].key !== "") {
                        apiKeys.push(llmAvailableProvidersTokenArray[i])
                    }
                }
            }
        }
        return apiKeys
    }
}

export const saveLlmProviderKey = (providerName: string, keyValue: string) => {
    // TODO: add encryption here
    const keys = getAllProviderLlmKeys()
    const item = keys.find((item: LlmProvider) => item.title === providerName)
    if (item) item.key = keyValue
    localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(keys))
}

export const getLlmProviderKey = (providerName: string) =>
    getAllProviderLlmKeys().find((item: LlmProvider) => item.title === providerName)?.key

export const transformSecret = (secrets: VaultSecretDTO[]) => {
    return secrets.reduce((acc, curr) => {
        const name = curr.header?.name
        const {key, provider} = curr.secret.data

        const envNameMap: Record<string, string> = {
            [SecretDTOProvider.OPENAI]: "OPENAI_API_KEY",
            [SecretDTOProvider.COHERE]: "COHERE_API_KEY",
            [SecretDTOProvider.ANYSCALE]: "ANYSCALE_API_KEY",
            [SecretDTOProvider.DEEPINFRA]: "DEEPINFRA_API_KEY",
            [SecretDTOProvider.ALEPHALPHA]: "ALEPHALPHA_API_KEY",
            [SecretDTOProvider.GROQ]: "GROQ_API_KEY",
            [SecretDTOProvider.MISTRALAI]: "MISTRAL_API_KEY",
            [SecretDTOProvider.ANTHROPIC]: "ANTHROPIC_API_KEY",
            [SecretDTOProvider.PERPLEXITYAI]: "PERPLEXITYAI_API_KEY",
            [SecretDTOProvider.TOGETHERAI]: "TOGETHERAI_API_KEY",
            [SecretDTOProvider.OPENROUTER]: "OPENROUTER_API_KEY",
            [SecretDTOProvider.GEMINI]: "GEMINI_API_KEY",
        }

        acc.push({
            title: name || "",
            key: key,
            name: envNameMap[provider] || "",
            id: curr.id,
        })

        return acc
    }, [] as LlmProvider[])
}

export const getAllProviderLlmKeys = () => {
    const providers = cloneDeep(llmAvailableProviders)
    try {
        if (typeof window !== "undefined") {
            const providersInStorage: LlmProvider[] = JSON.parse(
                localStorage.getItem(llmAvailableProvidersToken) || "[{}]",
            )
            for (const provider of providers) {
                provider.key = providersInStorage.find((p) => p.title === provider.title)?.key || ""
            }
        }
    } catch (error) {
        console.error(error)
    }
    return providers
}

export const removeSingleLlmProviderKey = (providerName: string) => {
    const keys = getAllProviderLlmKeys()
    const item = keys.find((item: LlmProvider) => item.title === providerName)
    if (item) item.key = ""
    localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(keys))
}

export const removeLlmProviderKey = () => {
    if (typeof window !== "undefined") {
        localStorage.removeItem(llmAvailableProvidersToken)
    }
}

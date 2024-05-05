import _ from "lodash"
import {camelToSnake} from "./utils"

const llmAvailableProvidersToken = "llmAvailableProvidersToken"

export type LlmProvider = {
    title: string
    key: string
    name: string
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

export const getAllProviderLlmKeys = () => {
    const providers = _.cloneDeep(llmAvailableProviders)
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
        console.log(error)
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

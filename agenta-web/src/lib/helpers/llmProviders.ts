import _ from "lodash"

const llmAvailableProvidersToken = "llmAvailableProvidersToken"

export type LlmProvider = {
    title: string
    key: string
    name: string
}

export const llmAvailableProviders: LlmProvider[] = [
    {title: "OpenAI", key: "", name: "OPENAI_API_KEY"},
    {title: "Replicate", key: "", name: "REPLICATE_API_KEY"},
    {title: "Hugging Face", key: "", name: "HUGGING_FACE_API_KEY"},
    {title: "Cohere", key: "", name: "COHERE_API_KEY"},
    {title: "Anthropic", key: "", name: "ANTHROPIC_API_KEY"},
    {title: "Azure", key: "", name: "AZURE_API_KEY"},
    {title: "TogetherAI", key: "", name: "TOGETHERAI_API_KEY"},
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

export const saveLlmProviderKey = (providerIdx: number, keyValue: string) => {
    if (typeof window !== "undefined") {
        // TODO: add encryption here
        const keys = JSON.parse(localStorage.getItem(llmAvailableProvidersToken) ?? "[{}]")
        keys[providerIdx].key = keyValue
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(keys))
    }
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

export const removeSingleLlmProviderKey = (providerIdx: number) => {
    if (typeof window !== "undefined") {
        const keys = JSON.parse(localStorage.getItem(llmAvailableProvidersToken) ?? "[{}]")
        keys[providerIdx].key = ""
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(keys))
    }
}

export const removeLlmProviderKey = () => {
    if (typeof window !== "undefined") {
        localStorage.removeItem(llmAvailableProvidersToken)
    }
}

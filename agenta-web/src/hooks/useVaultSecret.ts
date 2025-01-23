import {useEffect, useRef, useState} from "react"
import {
    getAllProviderLlmKeys,
    llmAvailableProviders,
    llmAvailableProvidersToken,
    LlmProvider,
    removeSingleLlmProviderKey,
    saveLlmProviderKey,
} from "@/lib/helpers/llmProviders"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicLib, dynamicService} from "@/lib/helpers/dynamic"

export const useVaultSecret = () => {
    const [secrets, setSecrets] = useState<LlmProvider[]>(llmAvailableProviders)
    const shouldRunMigration = useRef(true)

    const getVaultSecrets = async () => {
        try {
            if (isDemo()) {
                const {fetchVaultSecret} = await dynamicService("vault/api")
                const data = await fetchVaultSecret()

                setSecrets((prevSecret) => {
                    return prevSecret.map((secret) => {
                        const match = data.find((item: LlmProvider) => item.name === secret.name)
                        if (match) {
                            return {
                                ...secret,
                                key: match.key,
                                id: match.id,
                            }
                        } else {
                            return secret
                        }
                    })
                })
            } else {
                setSecrets(getAllProviderLlmKeys())
            }
        } catch (error) {
            console.error(error)
        }
    }

    useEffect(() => {
        getVaultSecrets()
    }, [])

    const migrateProviderKeys = async () => {
        try {
            const localStorageProviders = localStorage.getItem(llmAvailableProvidersToken)

            if (localStorageProviders) {
                const providers = JSON.parse(localStorageProviders)

                for (const provider of providers) {
                    if (provider.key) {
                        await handleModifyVaultSecret(provider as LlmProvider)
                    }
                }

                localStorage.setItem(`${llmAvailableProvidersToken}Backup`, localStorageProviders)

                localStorage.removeItem(llmAvailableProvidersToken)
            }
        } catch (error) {
            console.error(error)
        }
    }

    useEffect(() => {
        if (shouldRunMigration.current) {
            shouldRunMigration.current = false
            if (isDemo()) {
                migrateProviderKeys()
            }
        }
    }, [])

    const handleModifyVaultSecret = async (provider: LlmProvider) => {
        try {
            if (isDemo()) {
                const {updateVaultSecret, createVaultSecret} = await dynamicService("vault/api")
                const {SecretDTOProvider, SecretDTOKind} = await dynamicLib("types_ee")

                const envNameMap: Record<string, any> = {
                    OPENAI_API_KEY: SecretDTOProvider.OPENAI,
                    COHERE_API_KEY: SecretDTOProvider.COHERE,
                    ANYSCALE_API_KEY: SecretDTOProvider.ANYSCALE,
                    DEEPINFRA_API_KEY: SecretDTOProvider.DEEPINFRA,
                    ALEPHALPHA_API_KEY: SecretDTOProvider.ALEPHALPHA,
                    GROQ_API_KEY: SecretDTOProvider.GROQ,
                    MISTRAL_API_KEY: SecretDTOProvider.MISTRAL,
                    ANTHROPIC_API_KEY: SecretDTOProvider.ANTHROPIC,
                    PERPLEXITYAI_API_KEY: SecretDTOProvider.PERPLEXITYAI,
                    TOGETHERAI_API_KEY: SecretDTOProvider.TOGETHERAI,
                    OPENROUTER_API_KEY: SecretDTOProvider.OPENROUTER,
                    GEMINI_API_KEY: SecretDTOProvider.GEMINI,
                }

                const payload = {
                    header: {
                        name: provider.title,
                        description: "",
                    },
                    secret: {
                        kind: SecretDTOKind.PROVIDER_KEY,
                        data: {
                            provider: envNameMap[provider.name],
                            key: provider.key,
                        },
                    },
                }

                const findSecret = secrets.find((s) => s.name === provider.name)

                if (findSecret && provider.id) {
                    await updateVaultSecret({secret_id: provider.id, payload})
                } else {
                    await createVaultSecret({payload})
                }

                await getVaultSecrets()
            } else {
                saveLlmProviderKey(provider.title, provider.key)
            }
        } catch (error) {
            console.error(error)
        }
    }

    const handleDeleteVaultSecret = async (provider: LlmProvider) => {
        try {
            if (isDemo() && provider.id) {
                const {deleteVaultSecret} = await dynamicService("vault/api")
                await deleteVaultSecret({secret_id: provider.id})
                await getVaultSecrets()
            } else {
                removeSingleLlmProviderKey(provider.title)
            }
        } catch (error) {
            console.error(error)
        }
    }

    return {
        secrets,
        handleModifyVaultSecret,
        handleDeleteVaultSecret,
    }
}

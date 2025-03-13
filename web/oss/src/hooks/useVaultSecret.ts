import {useEffect, useRef, useState} from "react"

import {
    llmAvailableProviders,
    llmAvailableProvidersToken,
    LlmProvider,
} from "@/oss/lib/helpers/llmProviders"
import {SecretDTOProvider, SecretDTOKind} from "@/oss/lib/Types"
import {
    fetchVaultSecret,
    createVaultSecret,
    updateVaultSecret,
    deleteVaultSecret,
} from "@/oss/services/vault/api"

export const useVaultSecret = () => {
    const [secrets, setSecrets] = useState<LlmProvider[]>(llmAvailableProviders)
    const shouldRunMigration = useRef(true)

    const getVaultSecrets = async () => {
        try {
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
            migrateProviderKeys()
        }
    }, [])

    const handleModifyVaultSecret = async (provider: LlmProvider) => {
        try {
            const envNameMap: Record<string, any> = {
                OPENAI_API_KEY: SecretDTOProvider.OPENAI,
                COHERE_API_KEY: SecretDTOProvider.COHERE,
                ANYSCALE_API_KEY: SecretDTOProvider.ANYSCALE,
                DEEPINFRA_API_KEY: SecretDTOProvider.DEEPINFRA,
                ALEPHALPHA_API_KEY: SecretDTOProvider.ALEPHALPHA,
                GROQ_API_KEY: SecretDTOProvider.GROQ,
                MISTRAL_API_KEY: SecretDTOProvider.MISTRALAI,
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
        } catch (error) {
            console.error(error)
        }
    }

    const handleDeleteVaultSecret = async (provider: LlmProvider) => {
        try {
            if (provider.id) {
                await deleteVaultSecret({secret_id: provider.id})
                await getVaultSecrets()
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

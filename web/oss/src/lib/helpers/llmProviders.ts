import {StandardSecretDTO, CustomSecretDTO, SecretDTOKind} from "../Types"

export const llmAvailableProvidersToken = "llmAvailableProvidersToken"

export interface LlmProvider {
    title?: string
    key?: string
    provider?: string
    name?: string
    apiKey?: string
    apiBaseUrl?: string
    version?: string
    region?: string
    vertexProject?: string
    vertexLocation?: string
    vertexCredentials?: string
    accessKeyId?: string
    accessKey?: string
    sessionToken?: string
    models?: string[]
    modelKeys?: string[]
    id?: string
    type?: `${SecretDTOKind}`
    created_at?: string
}

export const transformSecret = (secrets: CustomSecretDTO[] | StandardSecretDTO[]) => {
    return secrets.reduce((acc, curr) => {
        if (curr.kind == SecretDTOKind.PROVIDER_KEY) {
            const secret = curr as StandardSecretDTO

            const name = secret.data.kind
            const key = secret.data.provider.key
            const provider = secret.data.kind

            const envNameMap: Record<string, string> = {
                openai: "OPENAI_API_KEY",
                cohere: "COHERE_API_KEY",
                anyscale: "ANYSCALE_API_KEY",
                deepinfra: "DEEPINFRA_API_KEY",
                alephalpha: "ALEPHALPHA_API_KEY",
                groq: "GROQ_API_KEY",
                mistralai: "MISTRAL_API_KEY",
                anthropic: "ANTHROPIC_API_KEY",
                perplexityai: "PERPLEXITYAI_API_KEY",
                together_ai: "TOGETHERAI_API_KEY",
                openrouter: "OPENROUTER_API_KEY",
                gemini: "GEMINI_API_KEY",
            }

            acc.push({
                title: name || "",
                key: key,
                name: envNameMap[provider] || "",
                id: secret.id,
                type: secret.kind,
                created_at: secret.lifecycle.created_at,
            })
        } else if (curr.kind === SecretDTOKind.CUSTOM_PROVIDER_KEY) {
            const secret = curr as CustomSecretDTO
            acc.push({
                name: secret.header.name || "",
                id: secret.id,
                type: secret.kind,
                provider: secret.data?.kind,
                apiKey: secret.data.provider.extras?.api_key || "",
                apiBaseUrl: secret.data.provider.url || "",
                region: secret.data.provider.extras?.aws_region_name || "",
                vertexProject: secret.data.provider.extras?.vertex_ai_project || "",
                vertexLocation: secret.data.provider.extras?.vertex_ai_location || "",
                vertexCredentials: secret.data.provider.extras?.vertex_ai_credentials || "",
                accessKeyId: secret.data.provider.extras?.aws_access_key_id || "",
                accessKey: secret.data.provider.extras?.aws_secret_access_key || "",
                sessionToken: secret.data.provider.extras?.aws_session_token || "",
                models: secret?.data.models.map((model) => model.slug),
                modelKeys: secret?.data.model_keys,
                version: secret.data.provider?.version || "",
                created_at: secret.lifecycle?.created_at || "",
            })
        }
        return acc
    }, [] as LlmProvider[])
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

export const transformCustomProviderPayloadData = (values: LlmProvider) => {
    return {
        header: {
            name: values.name,
            description: values.name,
        },
        secret: {
            kind: SecretDTOKind.CUSTOM_PROVIDER_KEY,
            data: {
                kind: values.provider?.toLowerCase(),
                provider: {
                    url: values.apiBaseUrl,
                    version: values.version,
                    extras: {
                        api_key: values.apiKey,
                        vertex_ai_location: values.vertexLocation,
                        vertex_ai_project: values.vertexProject,
                        vertex_ai_credentials: values.vertexCredentials,
                        aws_region_name: values.region,
                        aws_access_key_id: values.accessKeyId,
                        aws_secret_access_key: values.accessKey,
                        aws_session_token: values.sessionToken,
                    },
                },
                models: values.models?.map((slug) => ({slug})),
            },
        },
    } as CustomSecretDTO<"payload">
}

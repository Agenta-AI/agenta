import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {SecretDTOProvider} from "@/oss/lib/Types"

export const PROVIDER_FIELDS: {
    key: keyof LlmProvider
    label: string
    placeholder: string
    note?: string
    required?: boolean
    model?: string[]
}[] = [
    {key: "name", label: "Name", placeholder: "Enter unique name", required: true},
    {
        key: "apiKey",
        label: "API key",
        placeholder: "Enter API key",
        note: "This secret will be encrypted in transit and at rest.",
        model: ["azure", "custom", ...Object.values(SecretDTOProvider)],
        required: false,
    },
    {
        key: "apiBaseUrl",
        label: "API base URL",
        placeholder: "https://api.openai.com/v1",
        note: "Include /v1 in the base URL (e.g. https://api.openai.com/v1)",
        model: ["azure", "custom"],
        required: false,
    },
    {
        key: "version",
        label: "API version",
        placeholder: "Enter API version",
        model: ["azure"],
        required: false,
    },
    {
        key: "accessKeyId",
        label: "Access key ID",
        placeholder: "Enter access key ID",
        model: ["bedrock", "sagemaker"],
        required: false,
    },
    {
        key: "accessKey",
        label: "Secret Access Key",
        placeholder: "Enter secret access key",
        model: ["bedrock", "sagemaker"],
        required: false,
    },
    {
        key: "region",
        label: "AWS region",
        placeholder: "Enter aws region",
        model: ["bedrock", "sagemaker"],
        required: false,
    },
    {
        key: "sessionToken",
        label: "Session token",
        placeholder: "Enter session token",
        model: [],
        required: false,
    },
]

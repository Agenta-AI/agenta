import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {SecretDTOProvider} from "@/oss/lib/Types"

export const PROVIDER_FIELDS: {
    key: keyof LlmProvider
    label: string
    placeholder: string
    note?: string
    required?: boolean
    model?: string[]
    attributes?: Record<string, any>
}[] = [
    {
        key: "name",
        label: "Name",
        placeholder: "Enter unique name",
        required: true,
    },
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
        placeholder: "Enter API base URL",
        note: "Include version (e.g. /v1) in the base URL (e.g. https://api.openai.com/v1)",
        model: ["azure", "vertex_ai", "custom"],
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
        key: "region",
        label: "AWS region",
        placeholder: "Enter AWS region",
        model: ["bedrock", "sagemaker"],
        required: false,
    },
    {
        key: "vertexProject",
        label: "Vertex project",
        placeholder: "Enter Vertex project",
        model: ["vertex_ai"],
        required: false,
    },
    {
        key: "vertexLocation",
        label: "Vertex location",
        placeholder: "Enter Vertex location",
        model: ["vertex_ai"],
        required: false,
    },
    {
        key: "vertexCredentials",
        label: "Vertex credentials",
        placeholder: "Enter Vertex credentials",
        note: "This secret will be encrypted in transit and at rest.",
        model: ["vertex_ai"],
        required: false,
        attributes: {kind: "json", rows: 10, monospace: true, strict: true},
    },
    {
        key: "accessKeyId",
        label: "Access key ID",
        placeholder: "Enter access key ID",
        note: "This secret will be encrypted in transit and at rest.",
        model: ["bedrock", "sagemaker"],
        required: false,
    },
    {
        key: "accessKey",
        label: "Secret Access Key",
        placeholder: "Enter secret access key",
        note: "This secret will be encrypted in transit and at rest.",
        model: ["bedrock", "sagemaker"],
        required: false,
    },
    {
        key: "sessionToken",
        label: "Session token",
        placeholder: "Enter session token",
        note: "This secret will be encrypted in transit and at rest.",
        model: [],
        required: false,
    },
]

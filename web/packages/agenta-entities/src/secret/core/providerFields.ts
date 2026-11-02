/**
 * Custom-provider form field catalog — declarative field list + per-provider auth
 * requirements for the "Configure provider" drawer. Data-driven so the form component
 * has no provider-specific branching.
 */

import type {LlmProvider} from "@agenta/shared/types"

import {LlmEndpointProtocol, STANDARD_PROVIDER_KINDS} from "./types"

/**
 * Render metadata attached to a `PROVIDER_FIELDS` item, e.g.
 * `{kind: "json", rows: 10, monospace: true, strict: true}`.
 */
export type ProviderFieldAttributes =
    | {kind: "text"; type?: "text" | "password" | "url"; inputType?: "text" | "password" | "url"}
    | {kind: "textarea"; rows?: number; monospace?: boolean}
    | {kind: "json"; rows?: number; monospace?: boolean; strict?: boolean}

export interface ProviderFieldConfig {
    key: keyof LlmProvider
    label: string
    placeholder: string
    note?: string
    /**
     * Per-kind override of `note`, for fields whose hint is only true of one provider. A kind
     * absent here falls back to `note`; a field with neither shows none.
     */
    notesByKind?: Record<string, string>
    required?: boolean
    model?: string[]
    attributes?: ProviderFieldAttributes
}

/** Model families each custom-provider kind can host ("*" = any) — pragmatic map, pending owner confirmation. */
export const CUSTOM_PROVIDER_KIND_FAMILIES: Record<string, readonly string[] | "*"> = {
    azure: ["openai"],
    bedrock: ["anthropic", "meta", "amazon", "mistral"],
    vertex_ai: ["google", "gemini", "anthropic"],
    sagemaker: "*",
    custom: "*",
}

/** A field's hint for one provider kind: the per-kind override when it has one, else the shared note. */
export const fieldNoteForKind = (field: ProviderFieldConfig, kind: string): string | undefined =>
    field.notesByKind ? field.notesByKind[kind] : field.note

export const PROVIDER_FIELDS: ProviderFieldConfig[] = [
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
        model: ["azure", "custom", ...STANDARD_PROVIDER_KINDS],
        required: false,
        attributes: {kind: "text", type: "password"},
    },
    {
        key: "apiBaseUrl",
        label: "API base URL",
        placeholder: "Enter API base URL",
        // No shared note: the OpenAI-style `/v1` example is true of an OpenAI-compatible endpoint
        // and misleading under Azure (a resource endpoint) or Vertex (project + location).
        notesByKind: {
            custom: "Include the version path, e.g. /v1.",
            azure: "Your resource endpoint, e.g. https://YOUR-RESOURCE.openai.azure.com",
        },
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
        key: "bearerToken",
        label: "Bedrock API key",
        placeholder: "Enter Bedrock API key",
        note: "Use a Bedrock API key, or an access key ID + secret access key below.",
        model: ["bedrock"],
        required: false,
        attributes: {kind: "text", type: "password"},
    },
    {
        key: "accessKeyId",
        label: "Access key ID",
        placeholder: "Enter access key ID",
        note: "This secret will be encrypted in transit and at rest.",
        model: ["bedrock", "sagemaker"],
        required: false,
        attributes: {kind: "text", type: "password"},
    },
    {
        key: "accessKey",
        label: "Secret Access Key",
        placeholder: "Enter secret access key",
        note: "This secret will be encrypted in transit and at rest.",
        model: ["bedrock", "sagemaker"],
        required: false,
        attributes: {kind: "text", type: "password"},
    },
    {
        key: "sessionToken",
        label: "Session token",
        placeholder: "Enter session token",
        note: "This secret will be encrypted in transit and at rest.",
        model: [],
        required: false,
        attributes: {kind: "text", type: "password"},
    },
]

/** One option of a declarative choice control. */
export interface ProviderChoiceOption {
    value: string
    label: string
}

/** A choice the card asks for that is not a credential — today, the endpoint's protocol. */
export interface ProviderChoiceFieldConfig {
    key: string
    label: string
    options: ProviderChoiceOption[]
}

/**
 * The protocol an endpoint speaks.
 *
 * Two options, because a third would change nothing: the relay serves all three route suffixes on
 * any custom endpoint, and only the OpenAI-vs-Anthropic family changes behaviour.
 */
/**
 * What the protocol control starts on. The form always writes a protocol, so a record saved through
 * the card declares one even when the user never touched the control — which is what narrows it.
 * A record that predates the field declares nothing, and nothing here supplies a value for it.
 */
export const DEFAULT_ENDPOINT_PROTOCOL: LlmEndpointProtocol = LlmEndpointProtocol.Openai

// TODO(copy: owner)
export const ENDPOINT_PROTOCOL_FIELD: ProviderChoiceFieldConfig = {
    key: "protocol",
    label: "Protocol",
    options: [
        {value: LlmEndpointProtocol.Openai, label: "OpenAI-compatible"},
        {value: LlmEndpointProtocol.Anthropic, label: "Anthropic Messages"},
    ],
}

/**
 * Per-provider credential requirement, declared as alternative sets: a config is valid when at
 * least one set has all its fields filled. Keeps "either/or" auth (e.g. Bedrock: a bearer token
 * OR an access-key pair) in data, not branched in the submit handler. Providers absent here have
 * no cross-field requirement (their individually-required fields still apply).
 */
export const PROVIDER_AUTH_REQUIREMENTS: Record<
    string,
    {alternatives: (keyof LlmProvider)[][]; message: string}
> = {
    bedrock: {
        alternatives: [["bearerToken"], ["accessKeyId", "accessKey"]],
        message:
            "Bedrock needs either a Bedrock API key, or both an access key ID and secret access key.",
    },
}

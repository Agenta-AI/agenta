import LLMIconMap from "@/oss/components/LLMIcons"

export const TOOL_SCHEMA = {
    type: "object",
    properties: {
        type: {type: "string", enum: ["function"]},
        function: {
            type: "object",
            properties: {
                name: {type: "string"},
                description: {type: "string"},
                parameters: {
                    type: "object",
                    properties: {
                        type: {type: "string", enum: ["object"]},
                        properties: {
                            type: "object",
                            additionalProperties: {
                                type: "object",
                                properties: {
                                    type: {type: "string"},
                                    description: {type: "string"},
                                },
                                required: ["type"],
                            },
                        },
                        required: {
                            type: "array",
                            items: {type: "string"},
                        },
                        additionalProperties: {type: "boolean"},
                    },
                    required: ["type", "properties", "required", "additionalProperties"],
                },
            },
            required: ["name", "description", "parameters"],
        },
    },
    required: ["type", "function"],
}

export const TOOL_PROVIDERS_META: Record<
    string,
    {label: string; iconKey?: keyof typeof LLMIconMap}
> = {
    openai: {label: "Open AI", iconKey: "OpenAI"},
    anthropic: {label: "Anthropic", iconKey: "Anthropic"},
    google: {label: "Google Gemini", iconKey: "Google Gemini"},
}

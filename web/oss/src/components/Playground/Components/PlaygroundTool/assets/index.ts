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

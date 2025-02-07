// parser.ts

import {GenericObject, Parameter} from "../Types"

export const getBodySchemaName = (schema: GenericObject): string => {
    // Try v3 structure first
    const v3BodySchemaRef =
        schema?.paths?.["/generate"]?.post?.requestBody?.content?.["application/json"]?.schema
            ?.title

    // Try v2 structure first
    const v2BodySchemaRef =
        schema?.paths?.["/generate"]?.post?.requestBody?.content?.["application/json"]?.schema?.[
            "allOf"
        ]?.[0]?.["$ref"]

    // If v2 structure doesn't exist, fall back to v1 structure
    const v1BodySchemaRef =
        schema?.paths?.["/generate"]?.post?.requestBody?.content?.["application/json"]?.schema?.[
            "$ref"
        ]

    // Determine the body schema reference to use
    const bodySchemaRef = v3BodySchemaRef || v2BodySchemaRef || v1BodySchemaRef

    // Return the last part of the reference or an empty string
    return bodySchemaRef?.split("/")?.pop() || ""
}

export const detectChatVariantFromOpenAISchema = (schema: GenericObject) => {
    const bodySchemaName = getBodySchemaName(schema)
    return (
        schema.components.schemas[bodySchemaName].properties?.inputs?.["x-parameter"] === "messages"
    )
}

export const openAISchemaToParameters = (schema: GenericObject): Parameter[] => {
    const parameters: Parameter[] = []
    const bodySchemaName = getBodySchemaName(schema)

    // get the actual schema for the body parameters
    Object.entries(schema.components.schemas[bodySchemaName].properties || {}).forEach(
        ([name, param]: [string, any]) => {
            let parameter: Parameter = {
                name: name,
                input:
                    !param["x-parameter"] || ["messages", "file_url"].includes(param["x-parameter"])
                        ? true
                        : false,
                type: param["x-parameter"]
                    ? determineType(param["x-parameter"])
                    : param["type"] || "string",
                default: param.default,
                required: !!schema.components.schemas[bodySchemaName]?.required?.includes(name),
            }

            if (parameter.type === "array") {
                parameter.enum = param["enum"]
            }
            if (parameter.type === "integer" || parameter.type === "number") {
                parameter.minimum = param["minimum"]
                parameter.maximum = param["maximum"]
            }
            if (parameter.type === "grouped_choice") {
                parameter.choices = param["choices"]
            }

            parameters.push(parameter)
        },
    )
    return parameters
}

const determineType = (xParam: any): string => {
    switch (xParam) {
        case "text":
            return "string"
        case "choice":
            return "array"
        case "grouped_choice":
            return "grouped_choice"
        case "float":
            return "number"
        case "dict":
            return "object"
        case "bool":
            return "boolean"
        case "int":
            return "integer"
        case "file_url":
            return "file_url"
        default:
            return "string"
    }
}

// parser.ts

import {GenericObject} from "../Types"

export interface Parameter {
    name: string
    type: string
    input: boolean
    required: boolean
    default?: any
    enum?: Array<string>
}

const getBodySchemaName = (schema: GenericObject): string => {
    return (
        schema?.paths?.["/generate"]?.post?.requestBody?.content["application/json"]?.schema["$ref"]
            ?.split("/")
            ?.pop() || ""
    )
}

export const detectChatVariantFromOpenAISchema = (schema: GenericObject) => {
    const bodySchemaName = getBodySchemaName(schema)
    const bodyProperties = schema.components.schemas[bodySchemaName].properties
    const propertiesWithMessages = Object.keys(bodyProperties).filter(property => {
        return bodyProperties[property]["x-parameter"] === "messages"
    })
    return (
        propertiesWithMessages[0] ===
            "messages"
    )
}

export const openAISchemaToParameters = (schema: GenericObject): Parameter[] => {
    const parameters: Parameter[] = []
    const bodySchemaName = getBodySchemaName(schema)

    // get the actual schema for the body parameters
    Object.entries(schema.components.schemas[bodySchemaName].properties || {}).forEach(
        ([name, param]: [string, any]) => {
            const parameter = {
                name: name,
                input: param["x-parameter"] ? false : true,
                type: param["x-parameter"] ? determineType(param["x-parameter"]) : "string",
                default: param.default,
                enum: param["enum"] ? param.enum : [],
                minimum: param["minimum"] ? param.minimum : 0,
                maximum: param["maximum"] ? param.maximum : 1,
                required: !!schema.components.schemas[bodySchemaName]?.required?.includes(name),
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
        case "float":
            return "number"
        case "dict":
            return "object"
        case "int":
            return "integer"
        default:
            return "string"
    }
}

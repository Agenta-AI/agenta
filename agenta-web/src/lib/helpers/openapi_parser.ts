// parser.ts

export interface Parameter {
    name: string
    type: string
    input: boolean
    required: boolean
    default?: any
    enum?: Array<string>
}

export const parseOpenApiSchema = (schema: any): Parameter[] => {
    const parameters: Parameter[] = []

    // check if requestBody exists
    const requestBody = schema?.paths?.["/generate"]?.post?.requestBody
    if (requestBody) {
        const bodySchemaName = requestBody.content["application/json"].schema["$ref"]
            .split("/")
            .pop()

        // get the actual schema for the body parameters
        const bodySchema = schema.components.schemas[bodySchemaName].properties

        Object.entries(bodySchema).forEach(([name, param]: [string, any]) => {
            parameters.push({
                name: name,
                input: param["x-parameter"] ? false : true,
                type: param["x-parameter"] ? determineType(param["x-parameter"]) : "string",
                required: schema.components.schemas[bodySchemaName].required.includes(name),
                default: param.default,
                enum: param["enum"] ? param.enum : [],
                minimum: param["minimum"] ? param.minimum : 0,
                maximum: param["maximum"] ? param.maximum : 1,
            })
        })
    }

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
        case "int":
            return "integer"
        default:
            return "string"
    }
}

// parser.ts

export interface Parameter {
    name: string;
    type: string;
    input: boolean;
    required: boolean;
    default?: any;
}

export const parseOpenApiSchema = (schema: any): Parameter[] => {
    const parameters: Parameter[] = [];

    // check if requestBody exists
    const requestBody = schema?.paths?.['/generate']?.post?.requestBody;
    if (requestBody) {
        const bodySchemaName = requestBody.content['application/json'].schema['$ref'].split('/').pop();

        // get the actual schema for the body parameters
        const bodySchema = schema.components.schemas[bodySchemaName].properties;

        Object.entries(bodySchema).forEach(([name, param]: [string, any]) => {
            parameters.push({
                name: name,
                input: param['x-parameter'] ? false : true,
                type: determineType(param.type),
                required: schema.components.schemas[bodySchemaName].required.includes(name),
                default: param.default
            });
        });
    }

    return parameters;
};

const determineType = (xParam: any): string => {
    switch (xParam) {
        case 'text':
            return 'string';
        case 'float':
            return 'number';
        default:
            return 'string';
    }
};
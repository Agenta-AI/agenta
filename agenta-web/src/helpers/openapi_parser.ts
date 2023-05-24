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

    schema?.paths?.['/generate']?.post?.parameters.forEach((param: any) => {
        if (param.schema['x-parameter']) {
            parameters.push({
                name: param.name,
                input: false,
                type: determineType(param.schema['x-parameter']),
                required: param.required,
                default: param.schema.default
            });
        } else {
            parameters.push({
                name: param.name,
                input: true,
                type: 'string',
                required: param.required,
                default: param.schema.default
            });
        }
    });
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
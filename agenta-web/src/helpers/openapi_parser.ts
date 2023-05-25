// parser.ts
import { Parameter } from '@/services/api';
/**
 * Returns a raw list of parameters from an openapi.json schema.
 * This list of parameters includes both the inputs and the parameters
 * The parameters are discovered from the openapi.json in that they have the
 * x-parameter property set to the type of parameter
 * @param schema 
 * @returns Parameter[]
 */
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
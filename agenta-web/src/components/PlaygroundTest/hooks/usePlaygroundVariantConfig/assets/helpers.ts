import {SchemaObject} from "@/components/PlaygroundTest/types/shared"

/**
 * Type guard function to check if a value is a valid OpenAPI Schema Object
 * @param value - The value to check
 * @returns true if the value is a SchemaObject (has either 'type' or 'anyOf' property)
 */
export function isSchemaObject(value: any): value is SchemaObject {
    return value && typeof value === "object" && ("type" in value || "anyOf" in value)
}

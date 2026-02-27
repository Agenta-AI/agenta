export interface FormFieldDescriptor {
    name: string // dot-path for nested: "parent.child"
    label: string
    type: "string" | "number" | "boolean" | "object" | "array" | "enum"
    required: boolean
    description?: string
    default?: unknown
    enumValues?: string[]
    children?: FormFieldDescriptor[] // nested fields for object type
    /** For arrays: schema of each item (JSON Schema) */
    itemSchema?: Record<string, unknown>
    /** For arrays: parsed children of each item (when items are objects with properties) */
    itemChildren?: FormFieldDescriptor[]
    /** True when object/array has no structured schema — render as JSON editor */
    freeform?: boolean
}

/**
 * Convert a JSON Schema `properties` object into a list of form field descriptors.
 * Objects with their own `properties` are expanded into nested children.
 * Arrays with `items` containing object schemas get itemChildren for dynamic Form.List rendering.
 */
export function buildFormFieldsFromSchema(
    schema: Record<string, unknown> | null | undefined,
    prefix = "",
): FormFieldDescriptor[] {
    if (!schema) return []

    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const requiredSet = new Set((schema.required ?? []) as string[])

    return Object.entries(properties).map(([name, prop]) => {
        const fullName = prefix ? `${prefix}.${name}` : name
        const propType = (prop.type as string) ?? "string"
        let fieldType: FormFieldDescriptor["type"] = "string"

        if (prop.enum) {
            fieldType = "enum"
        } else if (propType === "integer" || propType === "number") {
            fieldType = "number"
        } else if (propType === "boolean") {
            fieldType = "boolean"
        } else if (propType === "object") {
            fieldType = "object"
        } else if (propType === "array") {
            fieldType = "array"
        }

        // Recursively expand object properties
        let children: FormFieldDescriptor[] | undefined
        let freeform = false

        if (fieldType === "object") {
            if (prop.properties) {
                children = buildFormFieldsFromSchema(prop as Record<string, unknown>, fullName)
            } else {
                // Object without properties schema → free-form JSON editor
                freeform = true
            }
        }

        // For arrays, inspect items schema
        let itemSchema: Record<string, unknown> | undefined
        let itemChildren: FormFieldDescriptor[] | undefined

        if (fieldType === "array" && prop.items) {
            const items = prop.items as Record<string, unknown>
            itemSchema = items

            if (items.type === "object" && items.properties) {
                // Array of objects with known properties → structured form list
                itemChildren = buildFormFieldsFromSchema(items)
            } else if (items.type === "object" && !items.properties) {
                // Array of free-form objects
                freeform = true
            }
            // For arrays of primitives (string, number, etc), itemSchema is set
            // but itemChildren is undefined → renders as simple add/remove inputs
        }

        if (fieldType === "array" && !prop.items) {
            // Array without items schema → free-form JSON editor
            freeform = true
        }

        return {
            name: fullName,
            label: (prop.title as string) ?? name,
            type: fieldType,
            required: requiredSet.has(name),
            description: prop.description as string | undefined,
            default: prop.default,
            enumValues: prop.enum as string[] | undefined,
            children,
            itemSchema,
            itemChildren,
            freeform,
        }
    })
}

/**
 * Auto-generate field descriptors from actual data keys (used when schema
 * doesn't match the data, e.g. backend unwraps Composio execution envelope).
 */
export function buildFormFieldsFromData(data: Record<string, unknown>): FormFieldDescriptor[] {
    return Object.entries(data).map(([key, value]) => {
        let fieldType: FormFieldDescriptor["type"] = "string"

        if (value === null || value === undefined) {
            fieldType = "string"
        } else if (typeof value === "number") {
            fieldType = "number"
        } else if (typeof value === "boolean") {
            fieldType = "boolean"
        } else if (Array.isArray(value)) {
            fieldType = "array"
        } else if (typeof value === "object") {
            fieldType = "object"
        }

        return {
            name: key,
            label: key,
            type: fieldType,
            required: false,
        }
    })
}

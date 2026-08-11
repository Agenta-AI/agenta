import {normalizeStringFormat} from "./elicitation"

export interface FormFieldDescriptor {
    name: string // dot-path for nested: "parent.child"
    label: string
    type: "string" | "number" | "boolean" | "object" | "array" | "enum"
    required: boolean
    description?: string
    default?: unknown
    enumValues?: string[]
    /** Known string format (date/date-time/email/uri/multiline) — set only under `{formats: true}` */
    format?: string
    /** Render enum with an "Other…" custom-value escape hatch — set only under `{openEnums: true}`. */
    allowCustomEnum?: boolean
    /** Multi-select (string-items array) — set only under `{openEnums: true}`; options ride enumValues. */
    multiple?: boolean
    /** Context-ful options (JSON Schema oneOf+const) — set only under `{openEnums: true}`; a
     * description on any option upgrades the control to choice cards. */
    enumOptions?: {value: string; label?: string; description?: string}[]
    children?: FormFieldDescriptor[] // nested fields for object type
    /** For arrays: schema of each item (JSON Schema) */
    itemSchema?: Record<string, unknown>
    /** For arrays: parsed children of each item (when items are objects with properties) */
    itemChildren?: FormFieldDescriptor[]
    /** True when object/array has no structured schema — render as JSON editor */
    freeform?: boolean
}

export interface BuildFormFieldsOptions {
    /** Opt-in: surface known string formats so renderers can map them to dedicated controls. */
    formats?: boolean
    /** Opt-in (elicitation): let enum fields accept a custom "Other…" value beyond the listed options. */
    openEnums?: boolean
}

/** Tolerant read of JSON Schema `oneOf` const-options into renderer option descriptors. */
function toEnumOptions(
    raw: unknown,
): {value: string; label?: string; description?: string}[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const options = raw
        .filter(
            (o): o is Record<string, unknown> =>
                !!o && typeof o === "object" && typeof (o as {const?: unknown}).const === "string",
        )
        .map((o) => ({
            value: o.const as string,
            ...(typeof o.title === "string" ? {label: o.title} : {}),
            ...(typeof o.description === "string" ? {description: o.description} : {}),
        }))
    return options.length ? options : undefined
}

/**
 * Convert a JSON Schema `properties` object into a list of form field descriptors.
 * Objects with their own `properties` are expanded into nested children.
 * Arrays with `items` containing object schemas get itemChildren for dynamic Form.List rendering.
 * `format` handling is opt-in so existing callers (gateway tool execution) render unchanged.
 */
export function buildFormFieldsFromSchema(
    schema: Record<string, unknown> | null | undefined,
    prefix = "",
    opts?: BuildFormFieldsOptions,
): FormFieldDescriptor[] {
    if (!schema) return []

    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const requiredSet = new Set((schema.required ?? []) as string[])

    return Object.entries(properties).map(([name, prop]) => {
        const fullName = prefix ? `${prefix}.${name}` : name
        const propType = (prop.type as string) ?? "string"
        let fieldType: FormFieldDescriptor["type"] = "string"

        if (prop.enum || (opts?.openEnums && propType !== "array" && Array.isArray(prop.oneOf))) {
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
                children = buildFormFieldsFromSchema(
                    prop as Record<string, unknown>,
                    fullName,
                    opts,
                )
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
                itemChildren = buildFormFieldsFromSchema(items, "", opts)
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

        // Opt-in only: known formats (aliases normalized) on plain string fields; enum wins.
        const format =
            opts?.formats && fieldType === "string" ? normalizeStringFormat(prop.format) : undefined

        // Opt-in (elicitation): a string-items array renders as a multi-select control instead
        // of the add/remove Form.List; its options ride enumValues (from items.enum).
        const multiple =
            !!opts?.openEnums &&
            fieldType === "array" &&
            (prop.items as Record<string, unknown> | undefined)?.type === "string"

        // Opt-in (elicitation): context-ful oneOf options for the choice-card/labeled rendering.
        const enumOptions = opts?.openEnums
            ? toEnumOptions(multiple ? (prop.items as Record<string, unknown>).oneOf : prop.oneOf)
            : undefined

        return {
            name: fullName,
            label: (prop.title as string) ?? name,
            type: fieldType,
            required: requiredSet.has(name),
            description: prop.description as string | undefined,
            default: prop.default,
            enumValues:
                (prop.enum as string[] | undefined) ??
                (fieldType === "enum" ? enumOptions?.map((o) => o.value) : undefined),
            ...(format !== undefined ? {format} : {}),
            ...(opts?.openEnums && fieldType === "enum" ? {allowCustomEnum: true} : {}),
            ...(multiple
                ? {
                      multiple: true,
                      allowCustomEnum: true,
                      enumValues:
                          (prop.items as {enum?: string[]}).enum ??
                          enumOptions?.map((o) => o.value),
                  }
                : {}),
            ...(enumOptions ? {enumOptions} : {}),
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

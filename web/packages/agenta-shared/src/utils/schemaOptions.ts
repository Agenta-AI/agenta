/**
 * Schema options utilities for grouped and enum-based selections.
 */

export interface OptionGroup {
    label: string
    options: {label: string; value: string}[]
}

export interface SchemaWithOptions {
    enum?: unknown[] // Allow unknown[] to be compatible with SchemaProperty
    choices?: Record<string, string[]>
}

export function getOptionsFromSchema<TSchema extends SchemaWithOptions>(
    schema: TSchema | null | undefined,
): {grouped: Record<string, string[]>; options: OptionGroup[]} | null {
    if (!schema) return null

    const choices = schema.choices as Record<string, string[]> | undefined
    if (choices && typeof choices === "object" && !Array.isArray(choices)) {
        const grouped = choices
        const options = Object.entries(grouped).map(([group, models]) => ({
            label: group.charAt(0).toUpperCase() + group.slice(1).replace(/_/g, " "),
            options: models.map((model) => ({
                label: model,
                value: model,
            })),
        }))
        return {grouped, options}
    }

    const enumValues = schema.enum as string[] | undefined
    if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
        const options: OptionGroup[] = [
            {
                label: "Models",
                options: enumValues.map((value) => ({
                    label: value,
                    value,
                })),
            },
        ]
        return {grouped: {Models: enumValues}, options}
    }

    return null
}

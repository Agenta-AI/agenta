import deepEqual from "fast-deep-equal"
import {GeneratedJSONSchema, SchemaConfig} from "./types"

export function isSchemaCompatibleWithBasicMode(schemaString: string): boolean {
    const config = parseJSONSchema(schemaString)

    if (!config) {
        return false
    }

    try {
        const parsed = JSON.parse(schemaString)
        const normalizedOriginalSchema = parsed.schema || parsed
        const regeneratedSchema = generateJSONSchema(config).schema

        return deepEqual(normalizedOriginalSchema, regeneratedSchema)
    } catch {
        return false
    }
}

export function generateJSONSchema(config: SchemaConfig): GeneratedJSONSchema {
    const {responseFormat, includeReasoning, continuousConfig, categoricalOptions} = config

    const properties: Record<string, any> = {}
    const required: string[] = ["score"]

    // Base description is always "The grade results"
    const baseDescription = "The grade results"

    // Add the main score field based on response format
    switch (responseFormat) {
        case "continuous":
            properties.score = {
                type: "number",
                description: baseDescription,
                minimum: continuousConfig?.minimum ?? 0,
                maximum: continuousConfig?.maximum ?? 10,
            }
            break

        case "boolean":
            properties.score = {
                type: "boolean",
                description: baseDescription,
            }
            break

        case "categorical":
            if (categoricalOptions && categoricalOptions.length > 0) {
                const enumValues = categoricalOptions.map((opt) => opt.name)
                const categoryDescriptions = categoricalOptions
                    .map((opt) => `"${opt.name}": ${opt.description}`)
                    .join("| ")

                properties.score = {
                    type: "string",
                    description: `${baseDescription}. Categories: ${categoryDescriptions}`,
                    enum: enumValues,
                }
            } else {
                // Fallback if no categories defined
                properties.score = {
                    type: "string",
                    description: baseDescription,
                }
            }
            break
    }

    // Add reasoning field if requested
    if (includeReasoning) {
        properties.comment = {
            type: "string",
            description: "Reasoning for the score",
        }
        required.push("comment")
    }

    return {
        name: "schema",
        schema: {
            title: "extract",
            description: "Extract information from the user's response.",
            type: "object",
            properties,
            required,
            strict: true,
        },
    }
}

export function parseJSONSchema(schemaString: string): SchemaConfig | null {
    try {
        const parsed = JSON.parse(schemaString)

        // Handle both old format (direct schema) and new format (with name wrapper)
        const schema = parsed.schema || parsed

        if (!schema.properties || !schema.properties.score) {
            return null
        }

        const score = schema.properties.score
        const hasReasoning = !!schema.properties.comment

        let responseFormat: SchemaConfig["responseFormat"] = "boolean"
        let continuousConfig: SchemaConfig["continuousConfig"]
        let categoricalOptions: SchemaConfig["categoricalOptions"]

        if (score.type === "number") {
            responseFormat = "continuous"
            continuousConfig = {
                minimum: score.minimum ?? 0,
                maximum: score.maximum ?? 10,
            }
        } else if (score.type === "boolean") {
            responseFormat = "boolean"
        } else if (score.type === "string" && score.enum) {
            responseFormat = "categorical"

            // Parse category descriptions from the description field
            const desc = score.description || ""
            const categoriesMatch = desc.match(/Categories: (.+)/)

            if (categoriesMatch) {
                const categoriesStr = categoriesMatch[1]
                const categoryPairs = categoriesStr.split("| ")

                categoricalOptions = score.enum.map((name: string) => {
                    const pair = categoryPairs.find((p: string) => p.startsWith(`"${name}":`))
                    const description = pair ? pair.split(": ")[1] || "" : ""
                    return {name, description}
                })
            } else {
                categoricalOptions = score.enum.map((name: string) => ({
                    name,
                    description: "",
                }))
            }
        }

        return {
            responseFormat,
            includeReasoning: hasReasoning,
            continuousConfig,
            categoricalOptions,
        }
    } catch {
        return null
    }
}

import {$getRoot, $isTabNode, LexicalEditor} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"

export function constructJsonFromSchema(schema: any, valueMap: Record<string, string>): any {
    if (!schema) return null

    if (schema.type === "object") {
        const obj: any = {}
        // Use Object.keys to preserve property order instead of for...in
        const propertyKeys = Object.keys(schema.properties || {})
        for (const key of propertyKeys) {
            const propertySchema = schema.properties[key]
            const isRequired = schema.required && schema.required.includes(key)
            let initialValue = constructJsonFromSchema(propertySchema, valueMap) || valueMap[key]

            if (initialValue === null || initialValue === undefined) {
                if (propertySchema.type === "string") {
                    initialValue = valueMap[key] || (isRequired ? key : "") // Use map value if available, else field name or empty string
                } else if (
                    propertySchema.anyOf &&
                    propertySchema.anyOf.some((item: {type?: string}) => item.type === "string")
                ) {
                    initialValue = valueMap[key] || (isRequired ? key : "") // Use map value if available, else field name or empty string
                } else if (propertySchema.type === "number") {
                    initialValue = 0
                } else if (propertySchema.type === "boolean") {
                    initialValue = false
                } else if (
                    propertySchema.type === "object" ||
                    propertySchema.anyOf?.[0].type === "object"
                ) {
                    initialValue = {} // Provide an empty object
                } else if (propertySchema.type === "array") {
                    if (propertySchema.items?.type === "string") {
                        initialValue = []
                    } else {
                        initialValue = [] // Provide an empty array
                    }
                } else {
                    initialValue = null // Default to null if unknown type
                }
            } else if (
                initialValue === "" &&
                propertySchema.anyOf &&
                propertySchema.anyOf.some((item: {type?: string}) => item.type === "null")
            ) {
                initialValue = null
            }

            obj[key] = initialValue
        }
        return obj
    } else if (schema.type === "array") {
        return [constructJsonFromSchema(schema.items, valueMap)]
    } else if (schema.type === "string") {
        return ""
    } else if (schema.type === "number") {
        return 0
    } else if (schema.type === "boolean") {
        return false
    } else if (schema.type === "null") {
        return null
    } else {
        return null // Default case for unknown types
    }
}

export function removeNewlinesAndTabs(input: string): string {
    return input.replace(/[\n\r\t]/g, "")
}

/**
 * Extracts the text content from the editor as a single string.
 * Processes each line by combining text from CodeHighlightNodes and
 * converting tabs, while filtering out zero-width spaces.
 *
 * @param editor - The Lexical editor instance
 * @returns The editor content as a plain string with newlines
 */
export function $getEditorCodeAsString(editor?: LexicalEditor): string {
    const root = $getRoot()
    let result = ""

    for (const block of root.getChildren()) {
        if (!$isCodeBlockNode(block)) continue

        for (const line of block.getChildren()) {
            if (!$isCodeLineNode(line)) continue

            const parts: string[] = []
            for (const child of line.getChildren()) {
                if ($isTabNode(child)) {
                    // Convert tabs to 2 spaces for YAML compatibility
                    parts.push("  ")
                } else if ($isCodeHighlightNode(child)) {
                    const text = child.getTextContent()
                    if (text !== "\u200B") {
                        parts.push(text)
                    }
                } else {
                    // Handle other node types (LongTextNode, Base64Node, etc.)
                    // by calling getTextContent() which returns the full value
                    const text = child.getTextContent()
                    if (text && text !== "\u200B") {
                        parts.push(text)
                    }
                }
            }

            result += parts.join("") + "\n"
        }
    }

    // For diff editor and YAML support, we need to preserve newlines
    // Only remove zero-width spaces and trim end
    return result.trimEnd()
}

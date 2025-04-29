import {useEffect, useRef, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import Ajv, {ErrorObject} from "ajv"
import yaml from "js-yaml"
import JSON5 from "json5"
import {$getRoot, $isTabNode, LexicalEditor} from "lexical"
import isEqual from "lodash/isEqual"

import {
    $createCodeBlockErrorIndicatorNode,
    $isCodeBlockErrorIndicatorNode,
} from "../nodes/CodeBlockErrorIndicatorNode"
import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const log = createLogger("RealTimeValidationPlugin", {disabled: true})

const ajv = new Ajv()

type ValidationError = ErrorObject<string, Record<string, any>, unknown>

export function constructJsonFromSchema(schema: any, valueMap: Record<string, string>): any {
    if (!schema) return null

    if (schema.type === "object") {
        const obj: any = {}
        for (const key in schema.properties) {
            if (schema.properties.hasOwnProperty(key)) {
                const propertySchema = schema.properties[key]
                const isRequired = schema.required && schema.required.includes(key)
                let initialValue =
                    constructJsonFromSchema(propertySchema, valueMap) || valueMap[key]

                if (initialValue === null || initialValue === undefined) {
                    if (propertySchema.type === "string") {
                        initialValue = valueMap[key] || (isRequired ? key : "") // Use map value if available, else field name or empty string
                    } else if (
                        propertySchema.anyOf &&
                        propertySchema.anyOf.some((item) => item.type === "string")
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
                    propertySchema.anyOf.some((item) => item.type === "null")
                ) {
                    initialValue = null
                }

                obj[key] = initialValue
            }
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
                    parts.push("\t")
                } else if ($isCodeHighlightNode(child)) {
                    const text = child.getTextContent()
                    if (text !== "\u200B") {
                        parts.push(text)
                    }
                }
            }

            result += parts.join("") + "\n"
        }
    }

    return removeNewlinesAndTabs(result.trimEnd())
}

/**
 * Determines the active language mode of the code block.
 * Searches through root children to find the first CodeBlockNode
 * and returns its language setting.
 *
 * @returns The current language mode ('json' or 'yaml')
 */
function $getActiveLanguage(): "json" | "yaml" {
    const root = $getRoot()
    for (const block of root.getChildren()) {
        if ($isCodeBlockNode(block)) {
            return block.getLanguage() as "json" | "yaml"
        }
    }
    return "json"
}

/**
 * Plugin that provides real-time validation of JSON/YAML content.
 *
 * Key features:
 * - Validates content against a predefined schema using Ajv
 * - Handles both JSON and YAML formats
 * - Updates validation state on editor changes
 * - Highlights problematic tokens in the editor
 * - Shows detailed error messages with locations
 *
 * The validation process:
 * 1. Gets editor content as text
 * 2. Parses as JSON/YAML
 * 3. Validates against schema
 * 4. Updates error state
 * 5. Highlights error locations in editor
 */
export function RealTimeValidationPlugin({debug, schema}: {debug?: boolean; schema: any}) {
    const [editor] = useLexicalComposerContext()
    const [validationErrors, setValidationErrors] = useState<ValidationError[] | null>(null)
    const validator = useRef(ajv.compile(schema))
    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const validate = validator.current

                const language = $getActiveLanguage()
                const textContent = $getEditorCodeAsString(editor)

                log("💬 Text content to validate", {language, textContent})

                // Variables to store parsed content and validation results
                let parsed: unknown
                let errorList: ValidationError[] = []

                try {
                    // Parse content based on active language mode
                    parsed = language === "yaml" ? yaml.load(textContent) : JSON5.parse(textContent)

                    // Validate parsed content against schema
                    const valid = validate(parsed)
                    if (!valid) {
                        errorList = validate.errors ?? []
                    }
                } catch (err) {
                    // If parsing fails, create a generic syntax error
                    // This happens when the content is not valid JSON/YAML
                    errorList = [
                        {
                            keyword: "syntax",
                            message: "Invalid syntax",
                            instancePath: "",
                            schemaPath: "#/syntax",
                            params: {},
                        },
                    ]
                }

                setValidationErrors((prevErrors) => {
                    const newVal = errorList.length > 0 ? errorList : null
                    if (!isEqual(prevErrors, newVal)) {
                        return newVal
                    }

                    return prevErrors
                })

                // Set to store text snippets that should be highlighted as errors
                const errorTexts = new Set<string>()

                for (const error of errorList) {
                    // Extract quoted values from error messages
                    // e.g. 'Expected string but got "number"' -> captures 'number'
                    const match = /"(.*?)"/.exec(error.message || "")
                    if (match) {
                        const unquoted = match[1]
                        errorTexts.add(unquoted) // Add without quotes
                        errorTexts.add(`"${unquoted}"`) // Add with quotes
                    }

                    // Extract property names from error paths
                    // e.g. '/user/name' -> captures 'name'
                    const pathParts = error.instancePath?.split("/").filter(Boolean)
                    const lastPart = pathParts?.[pathParts.length - 1]
                    if (lastPart) {
                        errorTexts.add(lastPart) // Add without quotes
                        errorTexts.add(`"${lastPart}"`) // Add with quotes
                    }

                    // Extract type names from error parameters
                    // e.g. {type: "string"} -> captures 'string'
                    if (typeof error.params?.type === "string") {
                        errorTexts.add(error.params.type) // Add without quotes
                        errorTexts.add(`"${error.params.type}"`) // Add with quotes
                    }
                }

                log("ENTER UPDATE", {errorList, errorTexts})

                // Start a mutable editor transaction to update validation UI
                editor.update(
                    () => {
                        const root = $getRoot()

                        // Process each code block to update error indicators
                        for (const block of root.getChildren()) {
                            if (!$isCodeBlockNode(block)) continue

                            let blockHasError = false

                            for (const line of block.getChildren()) {
                                if (!$isCodeLineNode(line)) continue

                                for (const child of line.getChildren()) {
                                    if (!$isCodeHighlightNode(child)) continue
                                    // Check if this text node contains an error token
                                    const text = child.getTextContent().trim()
                                    let shouldHaveError = errorTexts.has(text)

                                    // Add JSON validation for strings not properly quoted
                                    let expectedMessage = shouldHaveError
                                        ? errorList.find((e) => e.message?.includes(text))
                                              ?.message ?? "Invalid"
                                        : null

                                    // Custom JSON validation for string literals
                                    if (!shouldHaveError && block.getLanguage() === "json") {
                                        // Skip validation for punctuation tokens
                                        const highlightType = child.getHighlightType()
                                        const isPunctuation = highlightType === "punctuation"
                                        const isOperataor = highlightType === "operator"
                                        // If it's not punctuation, not a number, and not properly quoted, mark as error
                                        if (
                                            !isPunctuation &&
                                            !isOperataor &&
                                            text !== "" &&
                                            !Number(text) &&
                                            text !== "true" &&
                                            text !== "false" &&
                                            text !== "null" &&
                                            (!text.startsWith('"') || !text.endsWith('"'))
                                        ) {
                                            shouldHaveError = true
                                            expectedMessage =
                                                "String must be wrapped in double quotes"
                                        }
                                    }

                                    // Get current validation message for comparison
                                    const currentMessage = child.getValidationMessage()
                                    if (
                                        child.hasValidationError() !== shouldHaveError ||
                                        currentMessage !== expectedMessage
                                    ) {
                                        child.setValidationError(shouldHaveError)
                                        child.setValidationMessage(expectedMessage)
                                    }
                                }
                            }
                            blockHasError = errorList.length > 0

                            // Manage error indicator node in code block
                            // This shows/hides the warning icon and updates error messages
                            const existingIndicator = block
                                .getChildren()
                                .find($isCodeBlockErrorIndicatorNode)

                            // Collect all error messages to show in tooltip
                            const errorMessages: string[] = errorList.map(
                                (e) => e.message ?? "Unknown error",
                            )

                            // Update error indicator based on validation state:
                            // 1. If block has errors but no indicator -> create new one
                            // 2. If block has errors and indicator exists -> update messages if changed
                            // 3. If block has no errors but indicator exists -> remove it
                            if (blockHasError) {
                                if (!existingIndicator) {
                                    block.append($createCodeBlockErrorIndicatorNode(errorMessages))
                                } else if (
                                    $isCodeBlockErrorIndicatorNode(existingIndicator) &&
                                    JSON.stringify(existingIndicator.__errors) !==
                                        JSON.stringify(errorMessages)
                                ) {
                                    existingIndicator.getWritable().__errors = errorMessages
                                }
                            } else if (existingIndicator) {
                                existingIndicator.remove()
                            }
                        }
                    },
                    {
                        skipTransforms: true,
                    },
                )
            })
        })
    }, [editor, schema])

    return debug && validationErrors ? (
        <div className="validation-errors">
            {validationErrors.map((error, index) => (
                <div key={index}>
                    <strong>{error.keyword}</strong>: {error.message}
                    {error.instancePath && ` at ${error.instancePath}`}
                </div>
            ))}
        </div>
    ) : null
}

import {generateId} from "@agenta/shared/utils"

import {extractTemplateVariables} from "../../runnable/utils"

type TemplateFormat = "curly" | "fstring" | "jinja2"

/** Read template_format from an enhanced prompt object (handles both wrapped and raw values). */
function readTemplateFormat(prompt: Record<string, unknown>): TemplateFormat {
    const raw = (prompt.template_format ?? prompt.templateFormat) as
        | Record<string, unknown>
        | string
        | undefined
    const value = typeof raw === "object" ? (raw?.value as string) : raw
    if (value === "fstring") return "fstring"
    if (value === "jinja2" || value === "jinja") return "jinja2"
    return "curly"
}

/**
 * Extract template variables from an enhanced prompt's messages.
 *
 * Navigates the enhanced wrapper format:
 *   prompt.messages.value[*].content.value → string or ContentPart[]
 *
 * @returns Array of unique variable names found in message content
 */
function extractVariablesFromPrompt(prompt: Record<string, unknown>): string[] {
    const templateFormat = readTemplateFormat(prompt)
    const messagesWrapper = prompt?.messages as Record<string, unknown> | undefined
    const messages = messagesWrapper?.value
    if (!Array.isArray(messages)) return []

    const variables: string[] = []
    const seen = new Set<string>()

    const addVar = (v: string) => {
        if (!seen.has(v)) {
            seen.add(v)
            variables.push(v)
        }
    }

    for (const message of messages) {
        const msgObj = message as Record<string, unknown> | null | undefined
        const contentWrapper = msgObj?.content as Record<string, unknown> | undefined
        const content = contentWrapper?.value
        if (typeof content === "string") {
            for (const v of extractTemplateVariables(content, templateFormat)) addVar(v)
        } else if (Array.isArray(content)) {
            for (const part of content) {
                const partObj = part as Record<string, unknown> | null | undefined
                const text =
                    typeof part === "string"
                        ? part
                        : ((partObj?.text as Record<string, unknown> | undefined)?.value ??
                          partObj?.text)
                if (typeof text === "string") {
                    for (const v of extractTemplateVariables(text, templateFormat)) addVar(v)
                }
            }
        }
    }

    return variables
}

/**
 * Synchronize `input_keys` in each enhanced prompt with the actual template
 * variables found in its message content.
 *
 * Mutates prompts in place — designed to be called inside Immer's `produce`
 * or on a freshly created array before writing to the store.
 *
 * - If `input_keys` already exists on a prompt, preserves its `__id` and
 *   `__metadata` and only updates `.value`.
 * - If `input_keys` doesn't exist, creates it with a new `__id`.
 *
 * @param prompts - Array of enhanced prompt objects (mutated in place)
 */
export function syncInputKeysInPrompts(prompts: unknown[]): void {
    if (!prompts || !Array.isArray(prompts)) return

    for (const prompt of prompts) {
        const promptObj = prompt as Record<string, unknown> | null | undefined
        if (!promptObj) continue

        const variables = extractVariablesFromPrompt(promptObj)

        const existing = promptObj.input_keys as Record<string, unknown> | undefined

        if (existing && typeof existing === "object" && "value" in existing) {
            // Update existing enhanced wrapper — preserve __id and __metadata
            existing.value = variables
        } else if (variables.length > 0) {
            // Create new enhanced wrapper
            promptObj.input_keys = {
                value: variables,
                __id: generateId(),
            }
        }
        // If no variables and no existing input_keys, leave it absent
    }
}

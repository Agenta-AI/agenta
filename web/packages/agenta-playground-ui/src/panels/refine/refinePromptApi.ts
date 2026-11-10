import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {asRecord} from "@agenta/shared/utils"

/** A prompt message as the refine tool reads and returns it: the content is plain text. */
export interface RefineMessage {
    role: string
    content: string
}

/** The prompt sent to the refine tool: the prompt's own fields, with text-only messages. */
export interface PromptTemplate {
    messages: RefineMessage[]
    template_format: string
    [key: string]: unknown
}

interface ToolCallResponse {
    content?: {type: string; text: string}[]
    structuredContent?: {messages?: RefineMessage[]; summary?: string}
    isError?: boolean
}

const TOOL_REFINE_PROMPT = "tools.agenta.api.refine_prompt"

/** The tool takes text: content parts join into one string, an image part drops out. */
const contentText = (content: unknown): string => {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content
            .map((part) => (typeof part === "string" ? part : String(asRecord(part)?.text ?? "")))
            .filter(Boolean)
            .join("\n")
    }
    return content && typeof content === "object" ? JSON.stringify(content) : ""
}

/** The prompt at `config[promptKey]` in the shape the tool takes, or null without messages. */
export const toPromptTemplate = (promptValue: unknown): PromptTemplate | null => {
    const prompt = asRecord(promptValue)
    if (!prompt || !Array.isArray(prompt.messages) || prompt.messages.length === 0) return null
    const messages = prompt.messages.map((message) => {
        const fields = asRecord(message) ?? {}
        return {
            role: typeof fields.role === "string" ? fields.role : "user",
            content: contentText(fields.content),
        }
    })
    return {
        ...prompt,
        messages,
        template_format: typeof prompt.template_format === "string" ? prompt.template_format : "",
    }
}

/**
 * Asks the refine tool to rewrite `template` by `guidelines`. Returns the new messages and the
 * tool's summary of what changed. Throws when the call fails or the tool reports an error.
 */
export async function refinePrompt(
    template: PromptTemplate,
    guidelines: string,
): Promise<{messages: RefineMessage[]; summary: string}> {
    const {data} = await axios.post<ToolCallResponse>(
        `${getAgentaApiUrl()}/ai/services/tools/call`,
        {
            name: TOOL_REFINE_PROMPT,
            arguments: {
                prompt_template_json: JSON.stringify(template),
                guidelines,
                context: "",
            },
        },
        // The dialog shows its own message for a failure.
        {_ignoreError: true},
    )
    if (data.isError) {
        throw new Error(data.content?.[0]?.text || "The refine tool returned an error")
    }
    const messages = data.structuredContent?.messages
    if (!Array.isArray(messages)) throw new Error("The refine tool returned no messages")
    return {messages, summary: data.structuredContent?.summary || "Prompt refined successfully."}
}

/** Message interface matching the schema */
export interface Message {
    role: string
    content: string
    name?: string
    toolCalls?: Array<{
        id: string
        type: string
        function: Record<string, unknown>
    }>
    toolCallId?: string
}

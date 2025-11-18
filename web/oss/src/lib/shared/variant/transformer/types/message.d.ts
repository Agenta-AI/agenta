/** Message interface matching the schema */
export interface ImageURL {
    url: string
    detail?: "auto" | "low" | "high"
}

export interface MessageContentText {
    type: "text"
    text: string
}

export interface MessageContentImage {
    type: "image_url"
    image_url: ImageURL
}

export interface MessageContentFile {
    type: "file"
    file: {
        file_id: string
        name?: string
        mime_type?: string
    }
}

export type MessageContentPart = MessageContentText | MessageContentImage | MessageContentFile

export interface Message {
    role: string
    content: string | MessageContentPart[]
    name?: string
    toolCalls?: {
        id: string
        type: string
        function: Record<string, unknown>
    }[]
    toolCallId?: string
}

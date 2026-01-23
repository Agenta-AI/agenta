/**
 * @module ChatMessage
 *
 * Chat message editing components and utilities.
 * Provides types, schemas, and UI components for editing chat messages
 * in the OpenAI/Anthropic format.
 *
 * @example Basic Usage
 * ```tsx
 * import {ChatMessageEditor, SimpleChatMessage} from '@agenta/ui'
 *
 * const message: SimpleChatMessage = {role: 'user', content: 'Hello!'}
 *
 * <ChatMessageEditor
 *   id="msg-1"
 *   role={message.role}
 *   text={extractTextFromContent(message.content ?? null)}
 *   onChangeRole={(role) => setMessage({...message, role})}
 *   onChangeText={(text) => setMessage({...message, content: text})}
 * />
 * ```
 *
 * @example Message List
 * ```tsx
 * import {ChatMessageList} from '@agenta/ui'
 *
 * <ChatMessageList
 *   messages={messages}
 *   onChange={setMessages}
 *   enableTokens
 *   tokens={['name', 'date']}
 * />
 * ```
 */

// Types - Re-exported from @agenta/shared
export type {
    TextContentPart,
    ImageContentPart,
    FileContentPart,
    MessageContentPart,
    MessageContent,
    ToolCall,
    SimpleChatMessage,
} from "@agenta/shared"

// Schemas - Re-exported from @agenta/shared
export {
    MESSAGE_CONTENT_SCHEMA,
    CHAT_MESSAGE_SCHEMA,
    CHAT_MESSAGES_ARRAY_SCHEMA,
} from "@agenta/shared"

// Utilities - Re-exported from @agenta/shared
export {
    extractTextFromContent,
    extractDisplayTextFromMessage,
    hasAttachments,
    getAttachmentInfo,
    updateTextInContent,
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
} from "@agenta/shared"

// Components
export {
    ChatMessageEditor,
    ChatMessageList,
    MarkdownToggleButton,
    ToolMessageHeader,
    MessageAttachments,
    AttachmentButton,
    SimpleDropdownSelect,
} from "./components"
export type {
    ChatMessageEditorProps,
    ChatMessageListProps,
    SimpleDropdownSelectProps,
} from "./components"

# ChatMessage Module

Chat message editing components and utilities for the OpenAI/Anthropic message format.

## Overview

The ChatMessage module provides:
- Type definitions for chat messages with attachments
- JSON schemas for validation
- Utility functions for content manipulation
- React components for editing messages

## Architecture

```
ChatMessage/
├── index.ts                    # Public exports (re-exports from @agenta/shared)
├── README.md                   # This file
└── components/
    ├── index.ts                # Component exports
    ├── ChatMessageEditor.tsx   # Single message editor
    ├── ChatMessageList.tsx     # List of messages
    ├── MarkdownToggleButton.tsx# Markdown preview toggle
    ├── ToolMessageHeader.tsx   # Tool message header (uses MetadataHeader)
    ├── MessageAttachments.tsx  # Attachment display (uses presentational components)
    ├── AttachmentButton.tsx    # Attachment upload dropdown
    └── SimpleDropdownSelect.tsx# Role selector (re-exports from presentational)
```

> **Note:** Types, schemas, and utilities are re-exported from `@agenta/shared`.
> Components use presentational components from `components/presentational/`.

## Quick Start

### Single Message Editor

```tsx
import {ChatMessageEditor, extractTextFromContent} from '@agenta/ui'

function MessageEditor({message, onChange}) {
  return (
    <ChatMessageEditor
      id="msg-1"
      role={message.role}
      text={extractTextFromContent(message.content ?? null)}
      onChangeRole={(role) => onChange({...message, role})}
      onChangeText={(text) => onChange({...message, content: text})}
      placeholder="Enter your message..."
    />
  )
}
```

### Message List

```tsx
import {ChatMessageList, SimpleChatMessage} from '@agenta/ui'

function ChatEditor() {
  const [messages, setMessages] = useState<SimpleChatMessage[]>([
    {role: 'system', content: 'You are a helpful assistant.'},
    {role: 'user', content: 'Hello!'},
  ])

  return (
    <ChatMessageList
      messages={messages}
      onChange={setMessages}
      showControls
      allowFileUpload
    />
  )
}
```

### With Token/Variable Highlighting

```tsx
<ChatMessageList
  messages={messages}
  onChange={setMessages}
  enableTokens
  templateFormat="curly"
  tokens={['name', 'date', 'context']}
/>
```

## API Reference

### Types

| Type | Description |
|------|-------------|
| `SimpleChatMessage` | Full message with role, content, and tool calling fields |
| `MessageContent` | String or array of content parts |
| `MessageContentPart` | Text, image, or file content part |
| `TextContentPart` | Text content: `{type: 'text', text: string}` |
| `ImageContentPart` | Image content: `{type: 'image_url', image_url: {url, detail?}}` |
| `FileContentPart` | File content: `{type: 'file', file: {...}}` |
| `ToolCall` | Tool/function call: `{id, type: 'function', function: {name, arguments}}` |

### Schemas

| Schema | Description |
|--------|-------------|
| `MESSAGE_CONTENT_SCHEMA` | JSON schema for message content (string or parts array) |
| `CHAT_MESSAGE_SCHEMA` | JSON schema for a single message |
| `CHAT_MESSAGES_ARRAY_SCHEMA` | JSON schema for message array |

### Utilities

| Function | Description |
|----------|-------------|
| `extractTextFromContent(content)` | Extract text from content (string or parts) |
| `extractDisplayTextFromMessage(message)` | Get display text including tool calls |
| `hasAttachments(content)` | Check if content has images/files |
| `getAttachmentInfo(content)` | Get image and file counts |
| `updateTextInContent(content, text)` | Update text while preserving attachments |
| `addImageToContent(content, url, detail?)` | Add image attachment |
| `addFileToContent(content, data, name, format)` | Add file attachment |
| `removeAttachmentFromContent(content, index)` | Remove attachment by index |
| `getAttachments(content)` | Get all attachments |

### Components

#### `ChatMessageEditor`

Single message editor with role selector.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | - | Unique editor ID |
| `role` | `string` | required | Message role |
| `text` | `string` | required | Text content |
| `onChangeRole` | `(role) => void` | - | Role change callback |
| `onChangeText` | `(text) => void` | - | Text change callback |
| `disabled` | `boolean` | `false` | Disable editing |
| `isJSON` | `boolean` | `false` | Enable JSON mode |
| `enableTokens` | `boolean` | `false` | Enable variable highlighting |
| `tokens` | `string[]` | `[]` | Available variables |
| `templateFormat` | `'curly' \| 'fstring' \| 'jinja2'` | - | Variable syntax |
| `roleOptions` | `{label, value}[]` | default roles | Custom role options |
| `headerRight` | `ReactNode` | - | Right side header content |
| `headerBottom` | `ReactNode` | - | Below header content |
| `footer` | `ReactNode` | - | Footer content |

#### `ChatMessageList`

List of editable messages with add/remove controls.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `messages` | `SimpleChatMessage[]` | required | Messages array |
| `onChange` | `(messages) => void` | required | Change callback |
| `disabled` | `boolean` | `false` | Disable all editing |
| `showControls` | `boolean` | `true` | Show add/remove buttons |
| `allowFileUpload` | `boolean` | `true` | Allow attachments |
| `enableTokens` | `boolean` | `false` | Enable variable highlighting |
| `tokens` | `string[]` | `[]` | Available variables |
| `templateFormat` | `'curly' \| 'fstring' \| 'jinja2'` | - | Variable syntax |
| `ImagePreview` | `Component` | - | Custom image preview |

#### `MarkdownToggleButton`

Button to toggle markdown preview in editor.

| Prop | Type | Description |
|------|------|-------------|
| `id` | `string` | Editor ID to control |

#### `ToolMessageHeader`

Header for tool response messages.

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Function/tool name |
| `toolCallId` | `string` | Tool call ID |

## Message Format

Messages follow the OpenAI/Anthropic format:

```typescript
// Simple text message
{role: 'user', content: 'Hello!'}

// Message with image
{
  role: 'user',
  content: [
    {type: 'text', text: 'What is in this image?'},
    {type: 'image_url', image_url: {url: 'data:image/...', detail: 'auto'}}
  ]
}

// Assistant with tool calls
{
  role: 'assistant',
  content: null,
  tool_calls: [{
    id: 'call_123',
    type: 'function',
    function: {name: 'get_weather', arguments: '{"city":"NYC"}'}
  }]
}

// Tool response
{
  role: 'tool',
  content: '{"temp": 72}',
  name: 'get_weather',
  tool_call_id: 'call_123'
}
```

## Peer Dependencies

This module requires the Editor and SharedEditor modules from the same package.

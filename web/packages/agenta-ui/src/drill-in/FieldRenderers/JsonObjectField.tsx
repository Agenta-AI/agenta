/**
 * JsonObjectField
 *
 * Renders a JSON object. Detects chat message objects and renders them
 * with ChatMessageEditor from @agenta/ui, otherwise uses JSON editor.
 */

import {ChatMessageEditor, MarkdownToggleButton} from "@agenta/ui/chat-message"

import {isChatMessageObject} from "./fieldUtils"
import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import type {JsonObjectFieldProps} from "./types"

export function JsonObjectField({
    item,
    stringValue,
    fullPath,
    fieldKey,
    editable,
    setValue,
    valueMode,
    onPropertyClick,
    setCurrentPath,
    rootTitle,
}: JsonObjectFieldProps) {
    const originalWasString = typeof item.value === "string"

    // Check if this is a single chat message object - render as ChatMessageEditor
    // Parse outside of render to avoid try/catch around JSX (ESLint react-hooks/error-boundaries)
    let parsedChatMessage: {role: string; content: string; parsed: Record<string, unknown>} | null =
        null
    try {
        const parsed = JSON.parse(stringValue)
        if (isChatMessageObject(parsed)) {
            parsedChatMessage = {
                role: (parsed.role || parsed.sender || parsed.author || "user") as string,
                content:
                    typeof parsed.content === "string"
                        ? parsed.content
                        : parsed.text || parsed.message || "",
                parsed,
            }
        }
    } catch {
        // Not valid JSON, fall through to default handling
    }

    // Render ChatMessageEditor if we detected a chat message object
    if (parsedChatMessage) {
        const {role, content, parsed} = parsedChatMessage
        const messageEditorId = `drill-msg-${fullPath.join("-")}`

        return (
            <ChatMessageEditor
                id={messageEditorId}
                role={role}
                text={content}
                disabled={!editable}
                enableTokens={true}
                templateFormat="curly"
                onChangeRole={(newRole: string) => {
                    const updated = {...parsed, role: newRole}
                    const shouldStringify = valueMode === "string" || originalWasString
                    setValue(fullPath, shouldStringify ? JSON.stringify(updated) : updated)
                }}
                onChangeText={(newText: string) => {
                    const updated = {...parsed, content: newText}
                    const shouldStringify = valueMode === "string" || originalWasString
                    setValue(fullPath, shouldStringify ? JSON.stringify(updated) : updated)
                }}
                headerRight={
                    <div className="flex items-center gap-1">
                        <MarkdownToggleButton id={messageEditorId} />
                    </div>
                }
            />
        )
    }

    // Default: JSON editor for objects
    return (
        <JsonEditorWithLocalState
            editorKey={`${fullPath.join("-")}-editor`}
            initialValue={stringValue}
            onValidChange={(value) => {
                const shouldStringify = valueMode === "string" || originalWasString
                if (shouldStringify) {
                    setValue(fullPath, value)
                } else {
                    setValue(fullPath, JSON.parse(value))
                }
            }}
            onPropertyClick={(clickedPath) => {
                // Internal navigation
                const pathParts = clickedPath.split(".")
                setCurrentPath([...fullPath, ...pathParts])

                // Also call external handler if provided
                if (onPropertyClick) {
                    const navigationPath = [rootTitle, ...fullPath, ...pathParts].join(".")
                    onPropertyClick(navigationPath)
                }
            }}
        />
    )
}

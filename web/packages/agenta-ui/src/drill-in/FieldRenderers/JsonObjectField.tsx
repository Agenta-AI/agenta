/**
 * JsonObjectField
 *
 * Renders a JSON object. Detects chat message objects and renders them
 * with ChatMessageEditor from @agenta/ui, otherwise uses JSON editor.
 */

import {memo, useCallback} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {useAtomValue} from "jotai"

import {ChatMessageEditor} from "@agenta/ui/chat-message"

import {SET_MARKDOWN_VIEW} from "../../Editor/plugins/markdown/commands"
import {markdownViewAtom} from "../../Editor/state/assets/atoms"
import {useDrillInUI} from "../context/DrillInUIContext"
import {ViewModeDropdown} from "../core/ViewModeDropdown"

import {isChatMessageObject} from "./fieldUtils"
import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import type {JsonObjectFieldProps} from "./types"

type ChatViewMode = "text" | "markdown"

const CHAT_VIEW_OPTIONS: {value: ChatViewMode; label: string}[] = [
    {value: "text", label: "Text"},
    {value: "markdown", label: "Markdown"},
]

// Inline sub-component: runs inside ChatMessageEditor's Lexical context so it
// can read markdownViewAtom and dispatch SET_MARKDOWN_VIEW. Reuses the shared
// ViewModeDropdown so chat-shaped JSON objects use the same affordance as the
// testcase drawer.
const ViewModeButton = memo(({id}: {id: string}) => {
    const [editor] = useLexicalComposerContext()
    const markdownView = useAtomValue(markdownViewAtom(id))
    const onChange = useCallback(
        (mode: ChatViewMode) => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, mode === "markdown")
        },
        [editor],
    )
    return (
        <ViewModeDropdown<ChatViewMode>
            value={markdownView ? "markdown" : "text"}
            options={CHAT_VIEW_OPTIONS}
            onChange={onChange}
        />
    )
})
ViewModeButton.displayName = "JsonObjectFieldViewModeButton"

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
    const {featureFlags} = useDrillInUI()
    const enableFormView = featureFlags?.enableFormView ?? false

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
                        <ViewModeButton id={messageEditorId} />
                    </div>
                }
            />
        )
    }

    // Default: JSON editor for objects
    return (
        <div
            className={
                enableFormView ? "ml-1 border-l-2 border-[rgba(5,23,41,0.10)] pl-4" : undefined
            }
        >
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
        </div>
    )
}

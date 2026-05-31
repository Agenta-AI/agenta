/**
 * JsonObjectField
 *
 * Renders a JSON object. Detects chat message objects and renders them
 * with ChatMessageEditor from @agenta/ui, otherwise uses JSON editor.
 */

import {useMemo, useState} from "react"

import {ChatMessageEditor} from "@agenta/ui/chat-message"

import {useDrillInUI} from "../context/DrillInUIContext"
import {ViewModeDropdown} from "../core/ViewModeDropdown"
import {getViewOptions, type ViewMode} from "../utils/getViewOptions"

import {isChatMessageObject} from "./fieldUtils"
import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import type {JsonObjectFieldProps} from "./types"

type ChatViewMode = Extract<ViewMode, "text" | "markdown" | "json" | "yaml">

/**
 * Extracted so we can host the viewMode state + markdownView atom sync
 * needed by the 4-mode ViewModeDropdown. Mirrors the per-message pattern
 * from ChatMessageList: viewMode lives in parent state, the editor key
 * remounts on switch, and JSON/YAML modes flip ChatMessageEditor into
 * codeOnly via `isJSON` + `language`.
 */
function ChatMessageObjectField({
    messageEditorId,
    role,
    content,
    parsed,
    fullPath,
    editable,
    setValue,
    valueMode,
    originalWasString,
}: {
    messageEditorId: string
    role: string
    content: string
    parsed: Record<string, unknown>
    fullPath: string[]
    editable: boolean
    setValue: JsonObjectFieldProps["setValue"]
    valueMode: JsonObjectFieldProps["valueMode"]
    originalWasString: boolean
}) {
    const [viewMode, setViewMode] = useState<ChatViewMode>("text")
    const isCodeMode = viewMode === "json" || viewMode === "yaml"
    const editorLanguage: "json" | "yaml" = viewMode === "yaml" ? "yaml" : "json"

    const viewOptions = useMemo(
        () => getViewOptions(content) as {value: ChatViewMode; label: string}[],
        [content],
    )

    return (
        <ChatMessageEditor
            id={messageEditorId}
            key={`${messageEditorId}-${viewMode}`}
            role={role}
            text={content}
            disabled={!editable}
            isJSON={isCodeMode}
            language={editorLanguage}
            markdownView={viewMode === "markdown"}
            enableTokens={!isCodeMode}
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
                    <ViewModeDropdown<ChatViewMode>
                        value={viewMode}
                        options={viewOptions}
                        onChange={setViewMode}
                    />
                </div>
            }
        />
    )
}

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
            <ChatMessageObjectField
                messageEditorId={messageEditorId}
                role={role}
                content={content}
                parsed={parsed}
                fullPath={fullPath}
                editable={!!editable}
                setValue={setValue}
                valueMode={valueMode}
                originalWasString={originalWasString}
            />
        )
    }

    // Default: JSON editor for objects
    return (
        <div
            className={
                enableFormView
                    ? "ml-1 border-l-2 border-[var(--ag-rgba-051729-10)] pl-4"
                    : undefined
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
